// Semantic search = two independent rankings fused with Reciprocal Rank Fusion (RRF).
//
//   1. Meaning:  embedding similarity between the query and each video (title/summary vector and
//                every scene of the transcript; best of the two).
//   2. Graph:    knowledge-graph match between the query's graph and the video's graph (lib/kg.js),
//                with query concepts linked to concepts the library already knows.
//   3. Learners: the interaction ranking (quiz accuracy, finish rate, likes, clarity), at half weight,
//                so among relevant videos the ones that helped people rise.
//
// RRF(v) = Σ_lists  w_list / (k + rank_list(v)),  k = 60.  Only videos that pass a relevance floor on
// meaning (or graph backed by some meaning) are ranked, so a popular but unrelated video can't ride in on the learner list.

const kg = require('./kg');
const E = require('./embed');
const { quality } = require('./ranking');
const lexical = require('./match');

const RRF_K = 60;
const LIST_WEIGHTS = { meaning: 1, graph: 1, learners: 0.5 };
const FLOOR = { meaning: 0.3, graph: 0.25, graphWithMeaning: 0.2 };
const STRONG = { meaning: 0.55, graph: 0.6 };

const index = new Map(); // video id → { graph, header, scenes }
let library = { labels: new Set(), df: {}, n: 0 };

const sceneText = (s) => `${s.heading}. ${s.narration}`;
const headerText = (v) => `${v.title}. ${v.summary || ''} ${(v.tags || []).join(', ')}`;

async function indexVideo(v, { rebuildLibrary = true } = {}) {
  const graph = kg.graphForVideo(v);
  v.graph = kg.summarizeGraph(graph, 14); // a compact concept map is stored with the video
  const entry = { graph, header: null, scenes: [] };
  if (E.available()) {
    const vecs = await E.embed([headerText(v), ...(v.scenes || []).map(sceneText)]);
    entry.header = vecs[0];
    entry.scenes = vecs.slice(1);
    await E.embed(Object.keys(graph.nodes)); // warm label vectors for soft concept matching
  }
  index.set(v.id, entry);
  if (rebuildLibrary) rebuild();
  return entry;
}

function rebuild() {
  const labels = new Set();
  const df = {};
  for (const { graph } of index.values()) {
    for (const l of Object.keys(graph.nodes)) { labels.add(l); df[l] = (df[l] || 0) + 1; }
  }
  library = { labels, df, n: index.size };
}

async function indexAll(videos) {
  const t0 = Date.now();
  for (const v of videos) await indexVideo(v, { rebuildLibrary: false });
  rebuild();
  return { videos: videos.length, concepts: library.labels.size, ms: Date.now() - t0, embeddings: E.available() };
}

// Query graph: POS-tagged graph of the query, plus any 1–3 word spans that name a concept the
// library's graph already contains (entity linking), e.g. "how do plants make food" → plant, food.
function queryGraph(text) {
  const g = kg.buildGraph(text);
  const words = String(text).toLowerCase().replace(/[^a-z0-9' -]/g, ' ').split(/\s+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const label = kg.normNoun(words.slice(i, i + n).join(' '));
      if (library.labels.has(label) && !kg.GENERIC.has(label) && !g.nodes[label]) g.nodes[label] = 1;
    }
  }
  return g;
}

const idf = (label) => Math.log(1 + library.n / (1 + (library.df[label] || 0)));

async function search(query, videos, { limit = 6, exclude = null } = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [], queryGraph: { nodes: {}, edges: [] } };
  const pool = videos.filter((v) => !v.parentId && v.id !== exclude && index.has(v.id));
  const Q = queryGraph(q);
  const useEmb = E.available();
  let qvec = null;
  if (useEmb) {
    [qvec] = await E.embed([q.slice(0, 1200)]);
    await E.embed(Object.keys(Q.nodes));
  }
  const labelVec = (l) => (useEmb ? E.cached(l) : null);
  const lex = useEmb ? null : new Map(lexical.search(q, pool, { limit: 100 }).map((r) => [r.video.id, r.similarity]));

  const scored = pool.map((v) => {
    const ix = index.get(v.id);
    let meaning;
    if (useEmb) {
      const h = E.cosine(qvec, ix.header);
      const sc = Math.max(0, ...ix.scenes.map((s) => E.cosine(qvec, s)));
      meaning = Math.max(h, sc * 0.92);
    } else meaning = lex.get(v.id) || 0; // fallback when the model files aren't present
    const gm = kg.matchGraphs(Q, ix.graph, { labelVec, cosine: E.cosine, idf });
    return { video: v, meaning, graph: gm.score, graphParts: gm.parts, matches: gm.matches, quality: quality(v.stats) };
  }).filter((r) => r.meaning >= FLOOR.meaning || (r.graph >= FLOOR.graph && r.meaning >= FLOOR.graphWithMeaning));

  const rankBy = (key) => {
    const sorted = [...scored].sort((a, b) => key(b) - key(a));
    const ranks = new Map();
    sorted.forEach((r, i) => ranks.set(r.video.id, i + 1));
    return ranks;
  };
  const rMeaning = rankBy((r) => r.meaning);
  const rGraph = rankBy((r) => r.graph);
  const rLearners = rankBy((r) => r.quality.score);
  for (const r of scored) {
    r.ranks = { meaning: rMeaning.get(r.video.id), graph: rGraph.get(r.video.id), learners: rLearners.get(r.video.id) };
    r.rrf = LIST_WEIGHTS.meaning / (RRF_K + r.ranks.meaning)
      + LIST_WEIGHTS.graph / (RRF_K + r.ranks.graph)
      + LIST_WEIGHTS.learners / (RRF_K + r.ranks.learners);
    r.strong = r.meaning >= STRONG.meaning || r.graph >= STRONG.graph;
  }
  scored.sort((a, b) => b.rrf - a.rrf);
  return { results: scored.slice(0, limit), queryGraph: kg.summarizeGraph(Q, 12) };
}

function conceptMap(id) {
  const ix = index.get(id);
  return ix ? kg.summarizeGraph(ix.graph, 12) : null;
}

module.exports = { indexVideo, indexAll, search, conceptMap, RRF_K, LIST_WEIGHTS, FLOOR, STRONG };
