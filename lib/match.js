// Concept matching: TF-IDF cosine similarity over title, tags, summary and narration,
// with a small synonym map so "how plants make food" finds photosynthesis.
// Runs locally with zero token cost. A production version would use embeddings.

const STOP = new Set('a an the of to in on for and or is are was were be been it its this that how what why when where who which do does did can could would should i me my you your we our they their them he she his her with as at by from into about explain explained understand learn tell show please video videos work works working happen happens happened between vs versus'.split(' '));

const SYNONYMS = {
  food: ['photosynthesis', 'glucose'], plants: ['photosynthesis'], plant: ['photosynthesis'], sunlight: ['photosynthesis'], leaves: ['leaf', 'photosynthesis'],
  motion: ['newton', 'force'], gravity: ['force', 'newton'], inertia: ['newton'], forces: ['force'],
  divide: ['mitosis', 'cell'], division: ['mitosis'], cells: ['cell', 'mitosis'], dna: ['chromosomes'],
  triangle: ['pythagorean', 'hypotenuse'], triangles: ['triangle', 'pythagorean'], hypotenuse: ['pythagorean'],
  bastille: ['french', 'revolution'], napoleon: ['french', 'revolution'], france: ['french'], louis: ['french'],
  prices: ['price', 'supply', 'demand'], market: ['supply', 'demand'], markets: ['market'],
  rain: ['water', 'precipitation'], clouds: ['condensation', 'water'],
  bonds: ['bond', 'bonding'], bonding: ['bond'], electrons: ['bond'], salt: ['ionic'],
  factories: ['industrial'], steam: ['industrial'],
};

function stem(w) {
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('is') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9²\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

function expandQuery(tokens) {
  const out = [...tokens];
  for (const t of tokens) for (const s of SYNONYMS[t] || []) out.push(...tokenize(s));
  return out;
}

function docText(v) {
  // Weight fields by repetition: title and tags matter most.
  const tags = (v.tags || []).join(' ');
  const narr = (v.scenes || []).map((s) => s.heading + ' ' + s.narration).join(' ');
  return [v.title, v.title, v.title, tags, tags, tags, v.summary, v.summary, v.subject, narr].join(' ');
}

function tf(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function search(query, videos, { limit = 6 } = {}) {
  const pool = videos.filter((v) => !v.parentId); // explainers are found via their parent
  const docs = pool.map((v) => tf(tokenize(docText(v))));
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;

  const qTokens = expandQuery(tokenize(query));
  if (!qTokens.length) return [];
  const q = tf(qTokens);
  const vec = (m) => {
    const v = new Map();
    let norm = 0;
    for (const [t, c] of m) {
      const w = (1 + Math.log(c)) * idf(t);
      v.set(t, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  };
  const qv = vec(q);
  const rawTokens = new Set(tokenize(query));

  return pool
    .map((video, i) => {
      const dv = vec(docs[i]);
      let dot = 0;
      for (const [t, w] of qv.v) if (dv.v.has(t)) dot += w * dv.v.get(t);
      let sim = dot / (qv.norm * dv.norm);
      // Boost when the user's literal words hit the title or tags.
      const titleTags = new Set(tokenize(video.title + ' ' + (video.tags || []).join(' ')));
      let hits = 0;
      for (const t of rawTokens) if (titleTags.has(t)) hits++;
      const coverage = rawTokens.size ? hits / rawTokens.size : 0;
      const score = Math.min(1, sim * 1.6 + coverage * 0.5);
      return { video, similarity: score };
    })
    .filter((r) => r.similarity > 0.08)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// Two queries describe the "same concept" when their top match is strong.
const STRONG_MATCH = 0.55;

module.exports = { search, tokenize, STRONG_MATCH };
