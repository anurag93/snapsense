"""Data store: MongoDB when MONGODB_URI is set, otherwise a JSON file (zero setup for a quick demo).

MongoDB collections (database MONGODB_DB, default "conceptreel"):
  videos   one document per video or deep dive (_id = video id): storyboard, stats, concept-map summary
  users    one document per learner (_id = name): token balance, week, viewed / reactions / quizzed
  events   append-only interaction log (view, complete, like, dislike, quiz)
  meta     {_id: "metrics"}: reuse and generation counters
  knowledge_graphs  one document per video (_id = video id): the full concept graph built from its transcript
                    (nodes with weights, typed relation edges) plus a hash of the text it was built from

The API keeps a write-through in-memory copy of videos/users/metrics (loaded at startup) so search and
ranking don't hit the database per request; every change is written to MongoDB straight away.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import time
from pathlib import Path

log = logging.getLogger("conceptreel")

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("DB_PATH", ROOT / "data" / "db.json"))
SEED = json.loads((Path(__file__).parent / "seed.json").read_text())
MONGODB_URI = os.environ.get("MONGODB_URI", "").strip()
MONGODB_DB = os.environ.get("MONGODB_DB", "conceptreel")
MAX_JSON_EVENTS = 5000

_db = None
_mongo = None


def new_id() -> str:
    return secrets.token_hex(6)


def empty_stats() -> dict:
    return {"views": 0, "completions": 0, "likes": 0, "dislikes": 0, "quizAttempts": 0,
            "quizCorrect": 0, "explainRequests": 0, "confusedScenes": {}}


def empty_metrics() -> dict:
    return {"reuseCount": 0, "generatedCount": 0, "explainersGenerated": 0, "explainersReused": 0, "tokensSaved": 0,
            "blockedCount": 0}


def backend() -> str:
    return "mongodb" if MONGODB_URI else "json"


def _fresh() -> dict:
    now = int(time.time() * 1000)
    videos = []
    for i, v in enumerate(SEED):
        videos.append({
            "id": new_id(), "source": "library", "createdBy": "community",
            "createdAt": now - (i + 1) * 86400000 * 3, "parentId": None, "parentScene": None,
            **v, "stats": {**empty_stats(), **v.get("stats", {})},
        })
    return {"videos": videos, "users": {}, "events": [], "metrics": empty_metrics()}


# ---------------- MongoDB ----------------
def _mdb():
    global _mongo
    if _mongo is None:
        from pymongo import MongoClient
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000, appname="conceptreel")
        try:
            client.admin.command("ping")
        except Exception as e:
            raise RuntimeError(f"Could not reach MongoDB at {MONGODB_URI} ({e}). Start it with `docker compose up -d`, "
                               "or unset MONGODB_URI to use the JSON file store.") from e
        _mongo = client[MONGODB_DB]
        _mongo.videos.create_index("parentId")
        _mongo.events.create_index([("video", 1), ("t", -1)])
        log.info("Data: MongoDB %s/%s", MONGODB_URI.split("@")[-1], MONGODB_DB)
    return _mongo


def _to_doc(d: dict, key: str) -> dict:
    return {"_id": d[key], **d}


def _from_doc(d: dict) -> dict:
    d.pop("_id", None)
    return d


def _mongo_load() -> dict:
    m = _mdb()
    if m.videos.estimated_document_count() == 0:
        # First run against an empty database: carry over an existing JSON store, else seed the library.
        try:
            start = json.loads(DB_PATH.read_text())
            log.info("Importing %s into MongoDB", DB_PATH)
        except (FileNotFoundError, json.JSONDecodeError):
            start = _fresh()
        _mongo_write_all(start)
    return {
        "videos": [_from_doc(d) for d in m.videos.find().sort([("createdAt", 1)])],
        "users": {d["name"]: _from_doc(d) for d in m.users.find()},
        "events": [],  # the log stays in MongoDB; nothing reads it back per request
        "metrics": {**empty_metrics(), **_from_doc(m.meta.find_one({"_id": "metrics"}) or {})},
    }


def _mongo_write_all(db: dict) -> None:
    m = _mdb()
    for name in ("videos", "users", "events", "meta", "knowledge_graphs"):
        m[name].delete_many({})
    if db["videos"]:
        m.videos.insert_many([_to_doc(v, "id") for v in db["videos"]])
    if db["users"]:
        m.users.insert_many([_to_doc(u, "name") for u in db["users"].values()])
    if db.get("events"):
        m.events.insert_many([dict(e) for e in db["events"]])
    m.meta.replace_one({"_id": "metrics"}, {"_id": "metrics", **db["metrics"]}, upsert=True)


# ---------------- JSON file ----------------
def _json_write() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = DB_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(_db, ensure_ascii=False))
    tmp.replace(DB_PATH)


# ---------------- public API ----------------
def _backfill_checkpoints(db: dict) -> None:
    """Library videos saved before checkpoints existed pick up the hand-written ones (matched by title)."""
    cps = json.loads((Path(__file__).parent / "seed_checkpoints.json").read_text())
    for v in db["videos"]:
        extra = cps.get(v.get("title")) if v.get("source") == "library" else None
        if extra and not any(sc.get("checkpoint") for sc in v["scenes"]):
            for i, sc in enumerate(v["scenes"]):
                sc["checkpoint"] = extra.get(str(i))


def load() -> dict:
    global _db
    if _db is None:
        if MONGODB_URI:
            _db = _mongo_load()
        else:
            try:
                _db = json.loads(DB_PATH.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                _db = _fresh()
                _json_write()
        _backfill_checkpoints(_db)
    return _db


def save_video(v: dict) -> None:
    if MONGODB_URI:
        _mdb().videos.replace_one({"_id": v["id"]}, _to_doc(v, "id"), upsert=True)
    else:
        _json_write()


def save_user(u: dict) -> None:
    if MONGODB_URI:
        _mdb().users.replace_one({"_id": u["name"]}, _to_doc(u, "name"), upsert=True)
    else:
        _json_write()


def save_metrics() -> None:
    if MONGODB_URI:
        _mdb().meta.replace_one({"_id": "metrics"}, {"_id": "metrics", **load()["metrics"]}, upsert=True)
    else:
        _json_write()


def log_event(e: dict) -> None:
    if MONGODB_URI:
        _mdb().events.insert_one(dict(e))
    else:
        ev = load()["events"]
        ev.append(e)
        del ev[:-MAX_JSON_EVENTS]
        _json_write()


# ---------------- knowledge graphs (MongoDB only; the JSON store rebuilds them at startup) ----------------
def load_graphs() -> dict[str, dict]:
    """video id → {"hash", "graph": {"nodes": {label: weight}, "edges": [...]}}"""
    if not MONGODB_URI:
        return {}
    return {d["_id"]: {"hash": d.get("hash"), "graph": {"nodes": {n["label"]: n["w"] for n in d.get("nodes", [])},
                                                        "edges": d.get("edges", [])}}
            for d in _mdb().knowledge_graphs.find()}


def save_graph(video_id: str, content_hash: str, graph: dict) -> None:
    if not MONGODB_URI:
        return
    # Labels can contain dots, so nodes are stored as a list rather than as field names.
    _mdb().knowledge_graphs.replace_one({"_id": video_id}, {
        "_id": video_id, "hash": content_hash, "builtAt": int(time.time() * 1000),
        "nodes": [{"label": l, "w": w} for l, w in graph["nodes"].items()], "edges": graph["edges"],
        "nodeCount": len(graph["nodes"]), "edgeCount": len(graph["edges"]),
    }, upsert=True)


def remove_graphs_except(video_ids) -> None:
    if MONGODB_URI:
        _mdb().knowledge_graphs.delete_many({"_id": {"$nin": list(video_ids)}})


def save_all() -> None:
    """Write every video (used after re-indexing refreshes their concept maps)."""
    if MONGODB_URI:
        from pymongo import ReplaceOne
        vids = load()["videos"]
        if vids:
            _mdb().videos.bulk_write([ReplaceOne({"_id": v["id"]}, _to_doc(v, "id"), upsert=True) for v in vids])
        save_metrics()
    else:
        _json_write()


def reset() -> dict:
    global _db
    _db = _fresh()
    if MONGODB_URI:
        _mongo_write_all(_db)
    else:
        _json_write()
    return _db
