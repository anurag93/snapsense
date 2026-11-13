"""Vector store: Weaviate when WEAVIATE_URL is set, otherwise vectors live in process memory.

Weaviate holds one object per video header (title + summary + tags) and one per transcript scene, each with
our own all-MiniLM-L6-v2 vector (no Weaviate vectorizer) and a content hash, so a restart only re-embeds
videos whose text changed. Search is a cosine near-vector query; semantic.py turns the hits into the
"meaning" ranking.

  WEAVIATE_URL=http://localhost:8080          (docker compose)  WEAVIATE_GRPC_PORT=50051
  WEAVIATE_URL=https://xyz.weaviate.cloud  WEAVIATE_API_KEY=... (Weaviate Cloud)
"""
from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

log = logging.getLogger("conceptreel")

URL = os.environ.get("WEAVIATE_URL", "").strip()
COLLECTION = os.environ.get("WEAVIATE_COLLECTION", "VideoChunk")
_client = None
_coll = None


def enabled() -> bool:
    return bool(URL)


def _connect():
    import weaviate
    from weaviate.classes.init import Auth
    u = urlparse(URL)
    key = os.environ.get("WEAVIATE_API_KEY")
    if key and u.hostname and u.hostname not in ("localhost", "127.0.0.1"):
        return weaviate.connect_to_weaviate_cloud(cluster_url=URL, auth_credentials=Auth.api_key(key), skip_init_checks=True)
    return weaviate.connect_to_custom(
        http_host=u.hostname or "localhost", http_port=u.port or (443 if u.scheme == "https" else 8080),
        http_secure=u.scheme == "https", grpc_host=u.hostname or "localhost",
        grpc_port=int(os.environ.get("WEAVIATE_GRPC_PORT", "50051")), grpc_secure=u.scheme == "https",
        auth_credentials=Auth.api_key(key) if key else None, skip_init_checks=True)


def _ensure_collection():
    from weaviate.classes.config import Configure, DataType, Property, VectorDistances
    if not _client.collections.exists(COLLECTION):
        _client.collections.create(
            COLLECTION,
            properties=[
                Property(name="video_id", data_type=DataType.TEXT, skip_vectorization=True),
                Property(name="kind", data_type=DataType.TEXT, skip_vectorization=True),  # header | scene
                Property(name="scene", data_type=DataType.INT),
                Property(name="text", data_type=DataType.TEXT, skip_vectorization=True),
                Property(name="hash", data_type=DataType.TEXT, skip_vectorization=True),
            ],
            vector_config=Configure.Vectors.self_provided(
                vector_index_config=Configure.VectorIndex.hnsw(distance_metric=VectorDistances.COSINE)),
        )
    return _client.collections.get(COLLECTION)


def connect() -> None:
    global _client, _coll
    if not enabled() or _client is not None:
        return
    try:
        _client = _connect()
        if not _client.is_ready():  # init checks are skipped (they also phone PyPI for a version check)
            raise RuntimeError("not ready")
        _coll = _ensure_collection()
    except Exception as e:
        raise RuntimeError(f"Could not reach Weaviate at {URL} ({e}). Start it with `docker compose up -d`, "
                           "or unset WEAVIATE_URL to keep vectors in memory.") from e
    log.info("Vectors: Weaviate %s, collection %s", URL, COLLECTION)


def close() -> None:
    global _client, _coll
    if _client is not None:
        _client.close()
    _client = _coll = None


def stored_hashes() -> dict[str, str]:
    """video id → content hash of the vectors already in Weaviate (header objects only)."""
    out = {}
    for o in _coll.iterator(return_properties=["video_id", "kind", "hash"]):
        if o.properties.get("kind") == "header":
            out[o.properties["video_id"]] = o.properties.get("hash")
    return out


def upsert(video_id: str, content_hash: str, header_text: str, header_vec, scene_texts, scene_vecs) -> None:
    from weaviate.classes.data import DataObject
    from weaviate.classes.query import Filter
    from weaviate.util import generate_uuid5
    _coll.data.delete_many(where=Filter.by_property("video_id").equal(video_id))
    objs = [DataObject(uuid=generate_uuid5(f"{video_id}:header"), vector=[float(x) for x in header_vec],
                       properties={"video_id": video_id, "kind": "header", "scene": -1, "text": header_text, "hash": content_hash})]
    for i, (t, v) in enumerate(zip(scene_texts, scene_vecs)):
        objs.append(DataObject(uuid=generate_uuid5(f"{video_id}:scene:{i}"), vector=[float(x) for x in v],
                               properties={"video_id": video_id, "kind": "scene", "scene": i, "text": t, "hash": content_hash}))
    res = _coll.data.insert_many(objs)
    if res.has_errors:
        raise RuntimeError(f"Weaviate insert failed for {video_id}: {list(res.errors.values())[:1]}")


def remove_missing(keep_ids) -> int:
    """Drop vectors for videos that no longer exist (e.g. after a reset)."""
    from weaviate.classes.query import Filter
    keep = set(keep_ids)
    stale = [vid for vid in stored_hashes() if vid not in keep]
    for vid in stale:
        _coll.data.delete_many(where=Filter.by_property("video_id").equal(vid))
    return len(stale)


def search(qvec, limit: int) -> list[tuple[str, str, float]]:
    """Nearest headers/scenes to the query: [(video_id, kind, cosine similarity)]."""
    from weaviate.classes.query import MetadataQuery
    res = _coll.query.near_vector(near_vector=[float(x) for x in qvec], limit=limit,
                                  return_metadata=MetadataQuery(distance=True), return_properties=["video_id", "kind"])
    return [(o.properties["video_id"], o.properties["kind"], 1.0 - float(o.metadata.distance)) for o in res.objects]


def count() -> int:
    return _coll.aggregate.over_all(total_count=True).total_count
