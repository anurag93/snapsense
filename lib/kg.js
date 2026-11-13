// Knowledge graph built from POS tagging.
//
// Every sentence is POS-tagged (compromise). Noun phrases become concept nodes; verbs (plus a trailing
// preposition) and bare prepositions become typed relations between neighbouring concepts. A multi-word
// concept also gets an "is a" edge to its head noun ("green pigment" → "pigment"), so a query that
// only says "pigment" can still land on it.
//
// Matching a query graph against a video graph scores three things:
//   concepts  – each query concept aligned to its best video concept (exact lemma, word overlap, or
//               embedding similarity of the two labels), weighted by how central that concept is in the video
//   relations – query triples (a, r, b) that also appear in the video graph, with soft node alignment
//   paths     – query concept pairs that the video connects within two hops even if no single edge does

const nlp = require('compromise');

// Terms the tagger tends to miss in school subjects: taught to it as nouns, plus the library's own tags.
const LEXICON = {};
function teach(terms) {
  const add = {};
  for (const t of terms) {
    const k = String(t).toLowerCase().trim();
    if (k && !LEXICON[k] && /^[a-z0-9' -]+$/.test(k)) { LEXICON[k] = 'Noun'; add[k] = 'Noun'; }
  }
  if (Object.keys(add).length) nlp.addWords(add);
}
teach(['krebs cycle', 'calvin cycle', 'pyruvate', 'glucose', 'chlorophyll', 'chloroplast', 'mitochondria', 'photosynthesis',
  'atp', 'nadph', 'nadh', 'stomata', 'xylem', 'phloem', 'hypotenuse', 'chromatid', 'chromatids', 'spindle fibres', 'equilibrium',
  'inertia', 'acceleration', 'velocity', 'momentum', 'resistance', 'voltage', 'current', 'electron', 'electrons', 'molecule',
  'third estate', 'estates-general', 'bastille', 'enlightenment', 'glycolysis', 'electron transport chain', 'citric acid']);

const GENERIC = new Set(['less', 'more', 'much', 'many', 'lot', 'most', 'few', 'same', 'other', 'own', 'thing', 'things', 'way', 'part', 'kind', 'type', 'lot', 'something', 'everything', 'one', 'it', 'this', 'that',
  'what', 'which', 'who', 'people', 'time', 'example', 'idea', 'step', 'recap', 'question', 'answer', 'video', 'scene', 'look']);
const SKIP_VERBS = new Set(['be', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will',
  'would', 'should', 'may', 'might', 'must', 'get', 'let', 'say', 'see', 'remember', 'think', 'mean', 'go', 'put', 'call']);
const REL_PREPS = new Set(['of', 'in', 'into', 'from', 'to', 'by', 'with', 'through', 'for', 'on', 'as', 'at', 'inside']);

const LEADING = /^(the|a|an|its|their|his|her|our|your|my|this|that|these|those|each|every|some|all|own|any|many|more|most|such|other|another|both)\s+/;
const NO_SINGULAR = new Set(['mitochondria', 'bacteria', 'species', 'series', 'physics', 'economics', 'mathematics', 'genetics', 'gas', 'lens', 'news', 'stomata', 'data', 'criteria', 'phenomena', 'estates']);
function singular(w) {
  if (w.length <= 3 || NO_SINGULAR.has(w)) return w;
  const IRREG = { leaves: 'leaf', halves: 'half', lives: 'life', wolves: 'wolf', shelves: 'shelf', knives: 'knife', wives: 'wife', children: 'child', people: 'people', men: 'man', women: 'woman', teeth: 'tooth', feet: 'foot', mice: 'mouse', nuclei: 'nucleus', fungi: 'fungus', axes: 'axis', analyses: 'analysis', hypotheses: 'hypothesis' };
  if (IRREG[w]) return IRREG[w];
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(sses|ches|shes|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is|ics|ous)$/.test(w)) return w.slice(0, -1);
  return w;
}
const singularCache = new Map();
function normNoun(text) {
  if (singularCache.has(text)) return singularCache.get(text);
  let out = String(text).toLowerCase().replace(/[^a-z0-9₀-₉²' -]/g, ' ').replace(/'s\b/g, '').replace(/\s+/g, ' ').trim();
  while (LEADING.test(out)) out = out.replace(LEADING, '');
  const words = out.split(' ');
  words[words.length - 1] = singular(words[words.length - 1]);
  out = words.join(' ');
  singularCache.set(text, out);
  return out;
}
const verbCache = new Map();
function normVerb(text) {
  if (verbCache.has(text)) return verbCache.get(text);
  const inf = nlp(text).verbs().toInfinitive().text('normal') || text.toLowerCase();
  const out = inf.replace(/[^a-z' ]/g, '').trim();
  verbCache.set(text, out);
  return out;
}

const isNounish = (tags) => tags.includes('Noun') && !tags.includes('Pronoun') && !tags.includes('Determiner');
const isVerb = (tags) => tags.includes('Verb') && !tags.includes('Auxiliary');

// Turn one sentence into a sequence of chunks: NP (noun phrase), VP (verb), P (preposition).
function chunk(sentence) {
  const terms = nlp(sentence).json()[0]?.terms || [];
  const items = [];
  let np = [];
  const flush = () => {
    // Drop leading adjectives that aren't followed by a noun inside the phrase.
    while (np.length && !isNounish(np[np.length - 1].tags)) np.pop();
    if (np.length) {
      const text = np.map((t) => t.normal || t.text).join(' ');
      const head = np[np.length - 1].normal || np[np.length - 1].text;
      const adjMod = np.length > 1 && np.slice(0, -1).every((t) => (t.tags || []).includes('Adjective'));
      items.push({ type: 'NP', text, head, adjMod });
    }
    np = [];
  };
  for (const t of terms) {
    const tags = t.tags || [];
    const pre = t.pre || '', post = t.post || '';
    if (isNounish(tags) || tags.includes('Adjective')) {
      np.push(t);
    } else {
      flush();
      if (isVerb(tags)) items.push({ type: 'VP', text: t.normal || t.text });
      else if (tags.includes('Preposition')) items.push({ type: 'P', text: (t.normal || t.text).toLowerCase() });
      else if (tags.includes('Conjunction') || /[,;:]/.test(post)) items.push({ type: 'SEP' });
    }
    if (/[,;:()]/.test(post) || /[(]/.test(pre)) { flush(); items.push({ type: 'SEP' }); }
  }
  flush();
  return items;
}

function sentencesOf(text) {
  return nlp(String(text || '')).sentences().out('array').map((s) => s.trim()).filter(Boolean);
}

// Build a graph from free text. Returns { nodes: {label: weight}, edges: [{s, r, o, w}] }.
function buildGraph(text) {
  const nodes = {};
  const edges = new Map();
  const addNode = (label, w = 1) => {
    if (!label || label.length < 3 || GENERIC.has(label) || /^\d+$/.test(label)) return null;
    nodes[label] = (nodes[label] || 0) + w;
    return label;
  };
  const addEdge = (s, r, o, w) => {
    if (!s || !o || s === o) return;
    const k = `${s}|${r}|${o}`;
    edges.set(k, (edges.get(k) || 0) + w);
  };

  for (const sent of sentencesOf(text)) {
    const items = chunk(sent);
    const nps = [];
    items.forEach((it, i) => {
      if (it.type !== 'NP') return;
      const label = addNode(normNoun(it.text));
      if (!label) return;
      it.label = label;
      nps.push(i);
      const head = normNoun(it.head);
      if (it.adjMod && head !== label && head.length >= 3 && !GENERIC.has(head)) { addNode(head, 0.5); addEdge(label, 'is a', head, 1); }
    });
    // Subject–verb–object and preposition relations between neighbouring concepts.
    let lastSubj = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type === 'NP' && it.label) {
        // NP prep NP  ("energy of light", "glucose into pyruvate")
        if (items[i + 1]?.type === 'P' && items[i + 2]?.type === 'NP' && items[i + 2].label && REL_PREPS.has(items[i + 1].text)) {
          addEdge(it.label, items[i + 1].text, items[i + 2].label, 1);
        }
        lastSubj = it.label;
      } else if (it.type === 'VP') {
        const verb = normVerb(it.text);
        if (SKIP_VERBS.has(verb)) continue;
        let j = i + 1, prep = '';
        while (items[j] && (items[j].type === 'VP' || items[j].type === 'P')) { if (items[j].type === 'P' && !prep) prep = items[j].text; j++; }
        const obj = items[j]?.type === 'NP' ? items[j].label : null;
        if (lastSubj && obj) addEdge(lastSubj, prep ? `${verb} ${prep}` : verb, obj, 1.5);
      } else if (it.type === 'SEP') {
        // keep the subject across "and"/commas: "plants take in CO2 and release oxygen"
      }
    }
    // Weak co-occurrence links so concepts in the same sentence stay connected.
    for (let a = 0; a < nps.length; a++) for (let b = a + 1; b < nps.length; b++) {
      const x = items[nps[a]].label, y = items[nps[b]].label;
      if (x && y) addEdge(x, 'related to', y, 0.3);
    }
  }
  return { nodes, edges: [...edges.entries()].map(([k, w]) => { const [s, r, o] = k.split('|'); return { s, r, o, w: Math.round(w * 100) / 100 }; }) };
}

// The text a video's graph is built from: title, summary, tags and the full narration transcript.
function videoText(v) {
  return [
    v.title + '.',
    v.summary || '',
    (v.tags || []).length ? `Key ideas: ${(v.tags || []).join(', ')}.` : '',
    ...(v.scenes || []).map((s) => `${s.heading}. ${s.narration}`),
  ].join(' ');
}

function graphForVideo(v) {
  teach(v.tags || []);
  return buildGraph(videoText(v));
}

// ---------- matching ----------
function degreeMap(g) {
  const d = {};
  for (const e of g.edges) {
    if (e.r === 'related to') continue;
    d[e.s] = (d[e.s] || 0) + e.w;
    d[e.o] = (d[e.o] || 0) + e.w;
  }
  return d;
}

function wordOverlap(a, b) {
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.max(A.size, B.size);
}

// sim(q, n): exact → 1, shared words → 0.85·overlap, otherwise embedding cosine of the labels (if ≥ 0.6).
function makeNodeSim(labelVec, cosine) {
  return (a, b) => {
    if (a === b) return 1;
    const w = wordOverlap(a, b);
    const ws = w > 0 ? 0.85 * w : 0;
    const c = cosine(labelVec(a), labelVec(b));
    const es = c >= 0.6 ? c * 0.9 : 0;
    return Math.max(ws, es);
  };
}

function adjacency(g) {
  const adj = {};
  for (const e of g.edges) {
    (adj[e.s] ||= new Set()).add(e.o);
    (adj[e.o] ||= new Set()).add(e.s);
  }
  return adj;
}
function withinTwoHops(adj, a, b) {
  if (a === b) return true;
  const n1 = adj[a];
  if (!n1) return false;
  if (n1.has(b)) return true;
  for (const x of n1) if (adj[x]?.has(b)) return true;
  return false;
}

// Score how well video graph V covers query graph Q. Returns { score 0..1, matches: [[q, v, sim]] }.
function matchGraphs(Q, V, { labelVec, cosine, idf }) {
  const qNodes = Object.keys(Q.nodes).filter((l) => !GENERIC.has(l));
  const vNodes = Object.keys(V.nodes);
  if (!qNodes.length || !vNodes.length) return { score: 0, matches: [], parts: { concepts: 0, relations: 0, paths: 0 } };
  const sim = makeNodeSim(labelVec, cosine);
  const deg = degreeMap(V);
  const maxDeg = Math.max(1, ...Object.values(deg));

  // 1) concept alignment
  const align = {};
  let num = 0, den = 0;
  for (const q of qNodes) {
    let best = null, bestS = 0;
    for (const n of vNodes) {
      const s = sim(q, n);
      if (s > bestS) { bestS = s; best = n; }
    }
    const w = idf(best || q) * (Q.nodes[q] >= 1 ? 1 : 0.6);
    den += w;
    if (best && bestS >= 0.5) {
      align[q] = { node: best, s: bestS };
      const centrality = 0.6 + 0.4 * ((deg[best] || 0) / maxDeg);
      num += w * bestS * centrality;
    }
  }
  const concepts = den ? num / den : 0;

  // 2) relation (triple) alignment, ignoring weak co-occurrence links in the query
  const qEdges = Q.edges.filter((e) => e.r !== 'related to' && e.r !== 'is a');
  let relations = null;
  if (qEdges.length) {
    let tot = 0;
    for (const qe of qEdges) {
      let best = 0;
      for (const ve of V.edges) {
        const fwd = Math.min(sim(qe.s, ve.s), sim(qe.o, ve.o));
        const rev = Math.min(sim(qe.s, ve.o), sim(qe.o, ve.s)) * 0.8;
        let s = Math.max(fwd, rev);
        if (s < 0.5) continue;
        s *= ve.r === qe.r ? 1 : ve.r === 'related to' ? 0.6 : 0.85;
        if (s > best) best = s;
      }
      tot += best;
    }
    relations = tot / qEdges.length;
  }

  // 3) paths: pairs of aligned query concepts that the video connects within two hops
  const aligned = Object.values(align).map((a) => a.node);
  let paths = null;
  if (aligned.length >= 2) {
    const adj = adjacency(V);
    let pairs = 0, linked = 0;
    for (let i = 0; i < aligned.length; i++) for (let j = i + 1; j < aligned.length; j++) {
      pairs++;
      if (withinTwoHops(adj, aligned[i], aligned[j])) linked++;
    }
    paths = linked / pairs;
  }

  // Weighted blend; parts that don't apply to this query are left out and the rest re-normalised.
  const parts = [[concepts, 0.55], [relations, 0.3], [paths, 0.15]].filter(([v]) => v !== null);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const score = parts.reduce((a, [v, w]) => a + v * w, 0) / wsum;
  const matches = Object.entries(align).sort((a, b) => b[1].s - a[1].s).map(([q, a]) => [q, a.node, Math.round(a.s * 100) / 100]);
  return { score, matches, parts: { concepts, relations, paths } };
}

// Top concepts and relations for drawing a concept map.
function summarizeGraph(g, maxNodes = 10) {
  const deg = degreeMap(g);
  const ranked = Object.keys(g.nodes)
    .map((l) => ({ label: l, deg: deg[l] || 0, score: (deg[l] || 0) + g.nodes[l] * 0.5 }))
    .sort((a, b) => b.score - a.score);
  // Prefer concepts that take part in a typed relation; top up with frequent ones if there are few.
  let nodes = ranked.filter((n) => n.deg > 0).slice(0, maxNodes);
  if (nodes.length < 5) nodes = nodes.concat(ranked.filter((n) => n.deg === 0).slice(0, 5 - nodes.length));
  nodes = nodes.map((n) => n.label);
  const keep = new Set(nodes);
  const seen = new Set();
  const byStrength = (a, b) => (a.r === 'related to') - (b.r === 'related to') || b.w - a.w;
  const edges = g.edges
    .filter((e) => keep.has(e.s) && keep.has(e.o))
    .sort(byStrength)
    .filter((e) => { const k = [e.s, e.o].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 16);
  return { nodes, edges };
}

module.exports = { normNoun, buildGraph, graphForVideo, matchGraphs, summarizeGraph, chunk, teach, GENERIC };
