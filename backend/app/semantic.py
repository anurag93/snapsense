"""Semantic search = independent rankings fused with Reciprocal Rank Fusion (RRF).

  1. Meaning:  embedding similarity between the query and each video (title/summary vector and every
               scene of the transcript; the best of the two).
  2. Graph:    knowledge-graph match between the query's graph and the video's graph (kg.py), with
               query phrases linked to concepts the library already knows.
  3. Learners: the interaction ranking (quiz accuracy, finish rate, likes, clarity) at half weight, so
               among relevant videos the ones that helped people rise.

RRF(v) = Σ_lists w_list / (k + rank_list(v)), k = 60. Only videos above a relevance floor on meaning
(or graph backed by some meaning) are ranked, so popularity can't pull in an unrelated video.
"""
from __future__ import annotations

import hashlib
import math
import re
import time
from collections import Counter

from . import embed as E
from . import grades
from . import kg
from . import store
from . import vectors as VS
from .ranking import quality

RRF_K = 60
LIST_WEIGHTS = {"meaning": 1.0, "graph": 1.0, "learners": 0.5}
GRADE_WEIGHT = 0.5  # 4th list when the learner's grade band is known: lessons made for their band rank first
FLOOR = {"meaning": 0.3, "graph": 0.25, "graph_with_meaning": 0.2}
STRONG = {"meaning": 0.55, "graph": 0.6}

_index: dict[str, dict] = {}  # video id → {graph, header, scenes}; header/scenes stay None when Weaviate holds them
_library = {"labels": set(), "df": Counter(), "n": 0}


def _scene_text(s):
    return f"{s['heading']}. {s['narration']}"


def _header_text(v):
    return f"{v['title']}. {v.get('summary') or ''} {', '.join(v.get('tags') or [])}"


def _content_hash(header: str, scenes: list[str]) -> str:
    return hashlib.sha1("\x1f".join([E.MODEL_DIR.name, header, *scenes]).encode()).hexdigest()


def _graph(v: dict, stored: dict | None):
    """The video's knowledge graph: reuse the copy saved in MongoDB if the transcript is unchanged."""
    h = kg.graph_hash(v)
    if stored and stored.get("hash") == h:
        return stored["graph"], False
    graph = kg.graph_for_video(v)
    store.save_graph(v["id"], h, graph)
    return graph, True


def index_video(v: dict, rebuild: bool = True, stored_hash: str | None = None, stored_graph: dict | None = None) -> bool:
    graph, parsed = _graph(v, stored_graph)
    v["graph"] = kg.summarize_graph(graph, 14)  # compact concept map stored with the video
    entry = {"graph": graph, "header": None, "scenes": []}
    if E.available():
        header, scenes = _header_text(v), [_scene_text(s) for s in v.get("scenes", [])]
        if VS.enabled():
            h = _content_hash(header, scenes)
            if stored_hash != h:  # new or edited video: embed and write to Weaviate; otherwise reuse what's stored
                vecs = E.embed([header, *scenes])
                VS.upsert(v["id"], h, header, vecs[0], scenes, vecs[1:])
        else:
            vecs = E.embed([header, *scenes])
            entry["header"], entry["scenes"] = vecs[0], vecs[1:]
        E.embed(list(graph["nodes"]))  # warm label vectors for soft concept matching
    _index[v["id"]] = entry
    if rebuild:
        _rebuild()
    return parsed


def _rebuild():
    df = Counter()
    for e in _index.values():
        df.update(e["graph"]["nodes"].keys())
    _library.update(labels=set(df), df=df, n=len(_index))


def index_all(videos) -> dict:
    t0 = time.time()
    _index.clear()
    stored, embedded = {}, len(videos)
    store.remove_graphs_except(v["id"] for v in videos)
    graphs, parsed = store.load_graphs(), 0
    if VS.enabled() and E.available():
        VS.remove_missing(v["id"] for v in videos)
        stored = VS.stored_hashes()
        embedded = 0
    for v in videos:
        if VS.enabled() and E.available():
            h = _content_hash(_header_text(v), [_scene_text(s) for s in v.get("scenes", [])])
            embedded += stored.get(v["id"]) != h
        parsed += index_video(v, rebuild=False, stored_hash=stored.get(v["id"]), stored_graph=graphs.get(v["id"]))
    _rebuild()
    return {"videos": len(videos), "concepts": len(_library["labels"]), "ms": int((time.time() - t0) * 1000),
            "embeddings": E.available(), "vectors": "weaviate" if VS.enabled() else "memory", "embedded": embedded, "parsed": parsed}


def query_graph(text: str) -> dict:
    """POS/dependency graph of the query + entity linking: any 1–3 word span naming a known concept."""
    g = kg.build_graph(text)
    words = [w for w in re.sub(r"[^a-z0-9' -]", " ", text.lower()).split() if w]
    for n in (3, 2, 1):
        for i in range(len(words) - n + 1):
            label = kg.normalize(" ".join(words[i:i + n]))
            if label in _library["labels"] and label not in kg.GENERIC and label not in g["nodes"]:
                g["nodes"][label] = 1.0
    return g


def _idf(label):
    return math.log(1 + _library["n"] / (1 + _library["df"].get(label, 0)))


def _lexical(query, pool):
    """Fallback 'meaning' when the embedding model isn't installed: TF-IDF cosine."""
    tok = lambda s: [w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2]
    docs = [Counter(tok(_header_text(v) * 3 + " " + " ".join(_scene_text(s) for s in v.get("scenes", [])))) for v in pool]
    df = Counter(t for d in docs for t in d)
    n = len(docs)
    idf = lambda t: math.log((n + 1) / (df.get(t, 0) + 1)) + 1
    vec = lambda c: {t: (1 + math.log(k)) * idf(t) for t, k in c.items()}
    q = vec(Counter(tok(query)))
    qn = math.sqrt(sum(x * x for x in q.values())) or 1
    out = {}
    for v, d in zip(pool, docs):
        dv = vec(d)
        dn = math.sqrt(sum(x * x for x in dv.values())) or 1
        out[v["id"]] = min(1.0, sum(w * dv.get(t, 0) for t, w in q.items()) / (qn * dn) * 1.6)
    return out


def search(query: str, videos: list, limit: int = 6, exclude: str | None = None, band: str | None = None) -> dict:
    q = (query or "").strip()
    if not q:
        return {"results": [], "query_graph": {"nodes": [], "edges": []}}
    pool = [v for v in videos if not v.get("parentId") and v["id"] != exclude and v["id"] in _index]
    Q = query_graph(q)
    use_emb = E.available()
    qvec = None
    if use_emb:
        qvec = E.embed([q[:1200]])[0]
        E.embed(list(Q["nodes"]))
    label_vec = (lambda l: E.cached(l)) if use_emb else (lambda l: None)
    lex = None if use_emb else _lexical(q, pool)
    near = None
    if use_emb and VS.enabled():
        # Candidate retrieval from Weaviate: best header and best scene similarity per video.
        near = {}
        for vid, kind, sim in VS.search(qvec, limit=max(200, 10 * len(pool))):
            d = near.setdefault(vid, {"header": 0.0, "scene": 0.0})
            d[kind] = max(d[kind], sim)

    scored = []
    for v in pool:
        ix = _index[v["id"]]
        if near is not None:
            d = near.get(v["id"], {"header": 0.0, "scene": 0.0})
            meaning = max(d["header"], d["scene"] * 0.92)
        elif use_emb:
            h = E.cosine(qvec, ix["header"])
            sc = max([0.0, *(E.cosine(qvec, s) for s in ix["scenes"])])
            meaning = max(h, sc * 0.92)
        else:
            meaning = lex.get(v["id"], 0.0)
        gm = kg.match_graphs(Q, ix["graph"], label_vec, E.cosine, _idf)
        r = {"video": v, "meaning": meaning, "graph": gm["score"], "parts": gm["parts"], "matches": gm["matches"],
             "quality": quality(v["stats"])}
        if meaning >= FLOOR["meaning"] or (r["graph"] >= FLOOR["graph"] and meaning >= FLOOR["graph_with_meaning"]):
            scored.append(r)

    def ranks(key):
        return {r["video"]["id"]: i + 1 for i, r in enumerate(sorted(scored, key=key, reverse=True))}

    r_m, r_g, r_l = ranks(lambda r: r["meaning"]), ranks(lambda r: r["graph"]), ranks(lambda r: r["quality"]["score"])
    r_b = {r["video"]["id"]: 1 + grades.distance(grades.band_for_video(r["video"]), band) for r in scored} if band else {}
    for r in scored:
        vid = r["video"]["id"]
        r["ranks"] = {"meaning": r_m[vid], "graph": r_g[vid], "learners": r_l[vid]}
        r["rrf"] = (LIST_WEIGHTS["meaning"] / (RRF_K + r_m[vid]) + LIST_WEIGHTS["graph"] / (RRF_K + r_g[vid])
                    + LIST_WEIGHTS["learners"] / (RRF_K + r_l[vid]))
        if band:
            r["ranks"]["grade"] = r_b[vid]
            r["rrf"] += GRADE_WEIGHT / (RRF_K + r_b[vid])
        r["strong"] = r["meaning"] >= STRONG["meaning"] or r["graph"] >= STRONG["graph"]
    scored.sort(key=lambda r: r["rrf"], reverse=True)
    return {"results": scored[:limit], "query_graph": kg.summarize_graph(Q, 12)}


def concept_map(video_id: str):
    ix = _index.get(video_id)
    return kg.summarize_graph(ix["graph"], 12) if ix else None
