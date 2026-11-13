"""Knowledge graph from POS tagging and dependency parsing (spaCy).

Every sentence is tagged and parsed. Noun phrases become concept nodes (normalised: no determiners
or possessives, head noun lemmatised). Relations come from the parse:
  subject —verb→ object      nsubj / dobj / attr of a verb, with conjunctions shared
  subject —verb prep→ object a verb's prepositional object ("released into the air")
  agent —verb→ subject       passive voice ("glucose is made by the plant")
  noun —prep→ noun           "energy of light", "glucose into pyruvate"
  X —is a→ Y                 copula ("X is a Y"), "a pigment called chlorophyll", and
                             adjective-modified concepts → their head ("green pigment" → "pigment")
Concepts in the same sentence also get a weak "related to" link so they stay connected.

Matching a query graph against a video graph scores three things:
  concepts  – each query concept aligned to its best video concept (exact lemma, word overlap, or
              embedding similarity of the two labels), weighted by IDF and by centrality in the video
  relations – query triples (a, r, b) also present in the video graph, with soft node alignment
  paths     – query concept pairs the video links within two hops even if no single edge does
"""
from __future__ import annotations

import re
from functools import lru_cache
from itertools import combinations

import spacy

_nlp = spacy.load("en_core_web_sm", disable=["ner"])

GENERIC = {"less", "more", "much", "many", "lot", "most", "few", "same", "other", "own", "thing", "way", "part",
           "kind", "type", "something", "everything", "one", "it", "this", "that", "what", "which", "who", "people",
           "time", "example", "idea", "step", "recap", "question", "answer", "video", "scene", "look", "you", "we",
           "they", "i", "he", "she", "them", "us", "line", "word", "sense", "bit", "number", "lot", "fact"}
SKIP_VERBS = {"be", "do", "have", "can", "could", "will", "would", "should", "may", "might", "must", "get", "let",
              "say", "see", "remember", "think", "mean", "go", "put", "become", "seem", "make sure", "know", "want", "need"}
REL_PREPS = {"of", "in", "into", "from", "to", "by", "with", "through", "for", "on", "as", "at", "inside"}
DROP_DEPS = {"det", "poss", "predet", "case", "punct", "nummod", "quantmod"}
SUBJ = {"nsubj", "nsubjpass", "csubj"}
OBJ = {"dobj", "attr", "oprd", "obj", "acomp"}


def _clean(s: str) -> str:
    s = re.sub(r"[^a-z0-9₀-₉²' -]", " ", s.lower())
    s = re.sub(r"'s\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _label_from_tokens(tokens) -> str | None:
    """Concept label for a noun phrase: modifiers as written (lower-case) + lemma of the head noun."""
    toks = [t for t in tokens if t.dep_ not in DROP_DEPS and t.pos_ not in ("DET", "PRON", "PUNCT", "CCONJ")]
    while toks and toks[-1].pos_ not in ("NOUN", "PROPN", "NUM", "X"):
        toks.pop()
    while toks and toks[0].pos_ in ("ADV", "ADP", "PART"):
        toks.pop(0)
    if not toks:
        return None
    head = toks[-1]
    words = [t.text for t in toks[:-1]] + [head.lemma_ if head.pos_ == "NOUN" else head.text]
    label = _clean(" ".join(words))
    if len(label) < 3 or label in GENERIC or re.fullmatch(r"[\d ]+", label):
        return None
    return label


def _span_for(token):
    """The compound/adjective span ending in this noun token (its left modifiers)."""
    left = [c for c in token.lefts if c.dep_ in ("compound", "amod", "nmod", "npadvmod") and c.i >= token.i - 4]
    start = min([c.i for c in left] + [token.i])
    return token.doc[start:token.i + 1]


@lru_cache(maxsize=20000)
def normalize(text: str) -> str:
    """Normalise a free-text phrase the same way concept labels are built (used for entity linking)."""
    doc = _nlp(text)
    return _label_from_tokens(list(doc)) or _clean(text)


def build_graph(text: str) -> dict:
    nodes: dict[str, float] = {}
    edges: dict[tuple, float] = {}

    def add_node(label, w=1.0):
        if not label:
            return None
        nodes[label] = nodes.get(label, 0) + w
        return label

    def add_edge(s, r, o, w):
        if s and o and s != o:
            edges[(s, r, o)] = edges.get((s, r, o), 0) + w

    doc = _nlp(str(text or ""))
    for sent in doc.sents:
        label_of = {}  # token index of a noun → concept label
        sent_labels = []
        for chunk in sent.noun_chunks:
            label = add_node(_label_from_tokens(list(chunk)))
            if not label:
                continue
            label_of[chunk.root.i] = label
            sent_labels.append(label)
            # adjective-modified concept → its head ("green pigment" is a "pigment")
            if any(t.dep_ == "amod" for t in chunk) and chunk.root.pos_ == "NOUN":
                head = _clean(chunk.root.lemma_)
                if head != label and len(head) >= 3 and head not in GENERIC:
                    add_node(head, 0.5)
                    add_edge(label, "is a", head, 1.0)

        def concept(tok):
            if tok is None:
                return None
            if tok.i in label_of:
                return label_of[tok.i]
            if tok.pos_ in ("NOUN", "PROPN"):
                lab = add_node(_label_from_tokens(list(_span_for(tok))), 0.5)
                if lab:
                    label_of[tok.i] = lab
                return lab
            return None

        def with_conj(tok):
            out = [tok]
            for c in tok.children:
                if c.dep_ == "conj":
                    out.extend(with_conj(c))
            return out

        def subjects(verb):
            subs = [c for c in verb.children if c.dep_ in SUBJ]
            if not subs and verb.dep_ == "conj" and verb.head.pos_ in ("VERB", "AUX"):
                return subjects(verb.head)  # "plants take in CO2 and release oxygen"
            if not subs and verb.dep_ in ("acl", "relcl") and verb.head.pos_ in ("NOUN", "PROPN"):
                return [verb.head]  # "a pigment called chlorophyll", "carriers that power the chain"
            return [s for x in subs for s in with_conj(x)]

        for tok in sent:
            if tok.pos_ not in ("VERB", "AUX"):
                # noun —prep→ noun
                if tok.i in label_of or tok.pos_ in ("NOUN", "PROPN"):
                    for prep in tok.children:
                        if prep.dep_ == "prep" and prep.lower_ in REL_PREPS:
                            for pobj in prep.children:
                                if pobj.dep_ == "pobj":
                                    for o in with_conj(pobj):
                                        add_edge(concept(tok), prep.lower_, concept(o), 1.0)
                continue
            lemma = tok.lemma_.lower()
            subs = subjects(tok)
            objs = [o for c in tok.children if c.dep_ in OBJ for o in with_conj(c)]
            is_copula = lemma == "be" or (lemma in ("call", "name", "know") and any(c.dep_ == "oprd" for c in tok.children))
            if is_copula:
                for s in subs:
                    for o in objs:
                        if o.pos_ in ("NOUN", "PROPN"):
                            # "X is a Y" → X is a Y ; "a pigment called chlorophyll" → chlorophyll is a pigment
                            a, b = (concept(o), concept(s)) if tok.dep_ in ("acl", "relcl") else (concept(s), concept(o))
                            add_edge(a, "is a", b, 1.5)
                continue
            if lemma in SKIP_VERBS:
                continue
            particle = next((c.lower_ for c in tok.children if c.dep_ == "prt"), "")
            verb = f"{lemma} {particle}".strip()
            passive = any(c.dep_ == "nsubjpass" for c in tok.children)
            agents = [p for c in tok.children if c.dep_ == "agent" for p in c.children if p.dep_ == "pobj"]
            for s in subs:
                for o in objs:
                    add_edge(concept(s), verb, concept(o), 1.5)
                for prep in (c for c in tok.children if c.dep_ == "prep"):
                    for pobj in (p for p in prep.children if p.dep_ == "pobj"):
                        for o in with_conj(pobj):
                            add_edge(concept(s), f"{verb} {prep.lower_}", concept(o), 1.2)
                if passive:
                    for a in agents:
                        add_edge(concept(a), verb, concept(s), 1.5)

        for a, b in combinations(dict.fromkeys(sent_labels), 2):
            add_edge(a, "related to", b, 0.3)

    return {"nodes": nodes, "edges": [{"s": s, "r": r, "o": o, "w": round(w, 2)} for (s, r, o), w in edges.items()]}


def video_text(v: dict) -> str:
    """Title, summary, tags and the full narration transcript."""
    parts = [v.get("title", "") + ".", v.get("summary") or ""]
    if v.get("tags"):
        parts.append("Key ideas: " + ", ".join(v["tags"]) + ".")
    for s in v.get("scenes", []):
        parts.append(f"{s['heading']}. {s['narration']}")
    return " ".join(parts)


# Bump when extraction rules change, so graphs saved in MongoDB are rebuilt.
KG_VERSION = "1"


def graph_hash(v: dict) -> str:
    import hashlib
    return hashlib.sha1(f"{KG_VERSION}|{_nlp.meta['name']}-{_nlp.meta['version']}|{video_text(v)}".encode()).hexdigest()


def graph_for_video(v: dict) -> dict:
    return build_graph(video_text(v))


# ---------------- matching ----------------
def degree_map(g):
    d = {}
    for e in g["edges"]:
        if e["r"] == "related to":
            continue
        d[e["s"]] = d.get(e["s"], 0) + e["w"]
        d[e["o"]] = d.get(e["o"], 0) + e["w"]
    return d


def _word_overlap(a, b):
    A, B = set(a.split()), set(b.split())
    return len(A & B) / max(len(A), len(B))


def make_node_sim(label_vec, cosine):
    def sim(a, b):
        if a == b:
            return 1.0
        w = _word_overlap(a, b)
        ws = 0.85 * w if w > 0 else 0.0
        c = cosine(label_vec(a), label_vec(b))
        es = c * 0.9 if c >= 0.6 else 0.0
        return max(ws, es)
    return sim


def _adjacency(g):
    adj = {}
    for e in g["edges"]:
        adj.setdefault(e["s"], set()).add(e["o"])
        adj.setdefault(e["o"], set()).add(e["s"])
    return adj


def _within_two_hops(adj, a, b):
    if a == b:
        return True
    n1 = adj.get(a)
    if not n1:
        return False
    return b in n1 or any(b in adj.get(x, ()) for x in n1)


def match_graphs(Q, V, label_vec, cosine, idf):
    q_nodes = [l for l in Q["nodes"] if l not in GENERIC]
    v_nodes = list(V["nodes"])
    empty = {"score": 0.0, "matches": [], "parts": {"concepts": 0, "relations": None, "paths": None}}
    if not q_nodes or not v_nodes:
        return empty
    sim = make_node_sim(label_vec, cosine)
    deg = degree_map(V)
    max_deg = max([1.0, *deg.values()])

    # 1) concept alignment
    align, num, den = {}, 0.0, 0.0
    for q in q_nodes:
        best, best_s = None, 0.0
        for n in v_nodes:
            s = sim(q, n)
            if s > best_s:
                best, best_s = n, s
        w = idf(best or q) * (1.0 if Q["nodes"][q] >= 1 else 0.6)
        den += w
        if best and best_s >= 0.5:
            align[q] = (best, best_s)
            num += w * best_s * (0.6 + 0.4 * deg.get(best, 0) / max_deg)
    concepts = num / den if den else 0.0

    # 2) relation (triple) alignment
    q_edges = [e for e in Q["edges"] if e["r"] not in ("related to", "is a")]
    relations = None
    if q_edges:
        tot = 0.0
        for qe in q_edges:
            best = 0.0
            for ve in V["edges"]:
                fwd = min(sim(qe["s"], ve["s"]), sim(qe["o"], ve["o"]))
                rev = min(sim(qe["s"], ve["o"]), sim(qe["o"], ve["s"])) * 0.8
                s = max(fwd, rev)
                if s < 0.5:
                    continue
                s *= 1.0 if ve["r"] == qe["r"] else 0.6 if ve["r"] == "related to" else 0.85
                best = max(best, s)
            tot += best
        relations = tot / len(q_edges)

    # 3) paths between aligned concepts
    aligned = [n for n, _ in align.values()]
    paths = None
    if len(aligned) >= 2:
        adj = _adjacency(V)
        pairs = list(combinations(aligned, 2))
        paths = sum(_within_two_hops(adj, a, b) for a, b in pairs) / len(pairs)

    parts = [(v, w) for v, w in ((concepts, 0.55), (relations, 0.3), (paths, 0.15)) if v is not None]
    score = sum(v * w for v, w in parts) / sum(w for _, w in parts)
    matches = sorted(([q, n, round(s, 2)] for q, (n, s) in align.items()), key=lambda m: -m[2])
    return {"score": score, "matches": matches, "parts": {"concepts": concepts, "relations": relations, "paths": paths}}


def summarize_graph(g, max_nodes=10):
    """Top concepts and relations, for drawing a concept map."""
    deg = degree_map(g)
    ranked = sorted(({"label": l, "deg": deg.get(l, 0), "score": deg.get(l, 0) + g["nodes"][l] * 0.5}
                     for l in g["nodes"]), key=lambda n: -n["score"])
    nodes = [n for n in ranked if n["deg"] > 0][:max_nodes]
    if len(nodes) < 5:
        nodes += [n for n in ranked if n["deg"] == 0][:5 - len(nodes)]
    labels = [n["label"] for n in nodes]
    keep = set(labels)
    seen, edges = set(), []
    for e in sorted((e for e in g["edges"] if e["s"] in keep and e["o"] in keep),
                    key=lambda e: (e["r"] == "related to", -e["w"])):
        k = tuple(sorted((e["s"], e["o"])))
        if k in seen:
            continue
        seen.add(k)
        edges.append(e)
        if len(edges) >= 16:
            break
    return {"nodes": labels, "edges": edges}
