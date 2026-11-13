const express = require('express');
const path = require('path');
const store = require('./lib/store');
const { quality } = require('./lib/ranking');
const semantic = require('./lib/semantic');
const gen = require('./lib/generator');
const fs = require('fs');
const vision = require('./lib/vision');

const UPLOAD_DIR = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'db.json')), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function loadUpload(uploadId) {
  if (!/^[a-f0-9]{12}$/.test(String(uploadId || ''))) return null;
  for (const [mediaType, ext] of Object.entries(EXT)) {
    const f = path.join(UPLOAD_DIR, `${uploadId}.${ext}`);
    if (fs.existsSync(f)) return { mediaType, data: fs.readFileSync(f).toString('base64'), url: `/uploads/${uploadId}.${ext}` };
  }
  return null;
}

const COST = { video: 30, explainer: 10 };
const WEEKLY_TOKENS = 100;
const WEEK_MS = 7 * 86400000;
const DEMO_USERS = ['Maya', 'Leo', 'Priya'];

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));

// ---------- helpers ----------
function weekStart(now = Date.now()) {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
function getUser(name) {
  const db = store.load();
  const key = String(name || 'Maya').trim().slice(0, 24) || 'Maya';
  let u = db.users[key];
  if (!u) u = db.users[key] = { name: key, balance: WEEKLY_TOKENS, weekStart: weekStart(), spent: 0, saved: 0, viewed: {}, reactions: {}, quizzed: {} };
  if (Date.now() >= u.weekStart + WEEK_MS) { u.balance = WEEKLY_TOKENS; u.weekStart = weekStart(); }
  return u;
}
function userView(u) {
  return { name: u.name, balance: u.balance, weekly: WEEKLY_TOKENS, resetsAt: u.weekStart + WEEK_MS, spent: u.spent, saved: u.saved };
}
function spend(u, amount) {
  if (u.balance < amount) {
    const e = new Error(`Not enough tokens: this costs ${amount} and you have ${u.balance} left this week.`);
    e.status = 402;
    throw e;
  }
  u.balance -= amount;
  u.spent += amount;
}
function card(v) {
  return {
    id: v.id, title: v.title, subject: v.subject, grade: v.grade, style: v.style, summary: v.summary, source: v.source,
    createdBy: v.createdBy, createdAt: v.createdAt, sceneCount: v.scenes.length,
    emoji: (v.scenes.find((s) => s.visual && s.visual.kind === 'title' && s.visual.emoji) || {}).visual?.emoji || null,
    duration: v.scenes.reduce((s, sc) => s + sceneSeconds(sc), 0),
    sourceImage: v.sourceImage || null, stats: v.stats, quality: quality(v.stats),
  };
}
const sceneSeconds = (sc) => Math.max(4, Math.round(sc.narration.split(/\s+/).length / 2.6 + 1.2));
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong generating that. Try again.' });
});

// ---------- routes ----------
app.get('/api/state', (req, res) => {
  const db = store.load();
  const u = getUser(req.query.user);
  store.save();
  const roots = db.videos.filter((v) => !v.parentId);
  res.json({
    user: userView(u), demoUsers: DEMO_USERS, mode: gen.mode(), cost: COST,
    metrics: { ...db.metrics, videos: roots.length, explainers: db.videos.length - roots.length },
  });
});

app.get('/api/trending', (req, res) => {
  const db = store.load();
  const list = db.videos.filter((v) => !v.parentId).map(card).sort((a, b) => b.quality.score - a.quality.score);
  res.json({ videos: list.slice(0, 8) });
});

// One search result: the card plus both relevance signals, the RRF score and which concepts matched.
function hit(r) {
  return {
    ...card(r.video),
    similarity: Math.round(Math.max(r.meaning, r.graph) * 100),
    meaning: Math.round(r.meaning * 100),
    graph: Math.round(r.graph * 100),
    rrf: Math.round(r.rrf * 10000) / 10000,
    ranks: r.ranks,
    strong: r.strong,
    matched: r.matches.filter((m) => m[2] >= 0.6).slice(0, 4),
  };
}

app.get('/api/search', wrap(async (req, res) => {
  const db = store.load();
  const q = String(req.query.q || '').slice(0, 300);
  const { results, queryGraph } = await semantic.search(q, db.videos);
  res.json({
    query: q,
    strongMatch: results.some((r) => r.strong),
    queryConcepts: queryGraph.nodes,
    fusion: { k: semantic.RRF_K, weights: semantic.LIST_WEIGHTS },
    results: results.map(hit),
  });
}));

app.get('/api/videos/:id', wrap(async (req, res) => {
  const db = store.load();
  const v = db.videos.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const explainers = db.videos.filter((x) => x.parentId === v.id).map((x) => ({ ...card(x), parentScene: x.parentScene }));
  // Other versions of the same concept, ranked by learner interaction.
  const rootId = v.parentId || v.id;
  const root = db.videos.find((x) => x.id === rootId);
  const { results } = await semantic.search(`${root.title}. ${root.summary || ''}`, db.videos, { exclude: root.id });
  const alternatives = results.filter((r) => r.meaning >= 0.5 || r.graph >= 0.5).map(hit);
  const parent = v.parentId ? card(root) : null;
  res.json({
    video: { ...v, quality: quality(v.stats), sceneSeconds: v.scenes.map(sceneSeconds), conceptMap: semantic.conceptMap(v.id) },
    explainers, alternatives, parent,
  });
}));

app.post('/api/videos/:id/event', (req, res) => {
  const db = store.load();
  const v = db.videos.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const u = getUser(req.body.user);
  const s = v.stats;
  const { type } = req.body;
  if (type === 'view') {
    s.views++;
    if (!u.viewed[v.id]) {
      u.viewed[v.id] = Date.now();
      // Every reuse of a saved video is a generation nobody had to pay for.
      const saved = v.parentId ? COST.explainer : COST.video;
      if (v.createdBy !== u.name) {
        u.saved += saved;
        db.metrics.tokensSaved += saved;
        db.metrics.reuseCount++;
      }
    }
  } else if (type === 'complete') {
    s.completions++;
  } else if (type === 'like' || type === 'dislike') {
    const prev = u.reactions[v.id];
    if (prev) s[prev + 's']--;
    if (prev === type) delete u.reactions[v.id];
    else { u.reactions[v.id] = type; s[type + 's']++; }
  } else if (type === 'quiz') {
    if (!u.quizzed[v.id]) {
      u.quizzed[v.id] = true;
      const total = Math.max(0, Number(req.body.total) || 0);
      const correct = Math.min(total, Math.max(0, Number(req.body.correct) || 0));
      s.quizAttempts += total;
      s.quizCorrect += correct;
    }
  } else {
    return res.status(400).json({ error: 'Unknown event' });
  }
  db.events.push({ t: Date.now(), user: u.name, video: v.id, type });
  if (db.events.length > 5000) db.events.splice(0, db.events.length - 5000);
  store.save();
  res.json({ stats: s, quality: quality(s), reaction: u.reactions[v.id] || null, user: userView(u) });
});

// A learner's photo: read it, then look for saved videos on that concept before generating anything.
app.post('/api/read-image', wrap(async (req, res) => {
  const db = store.load();
  const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(String(req.body.image || ''));
  if (!m || !vision.MEDIA_TYPES.includes(m[1])) return res.status(400).json({ error: 'Please upload a JPG, PNG, WebP or GIF image.' });
  const [, mediaType, data] = m;
  if (data.length > 11 * 1024 * 1024) return res.status(413).json({ error: 'That image is too large. Try a smaller photo.' });
  const reading = await vision.readImage({ data, mediaType });
  if (!reading.readable) {
    return res.status(422).json({
      error: gen.mode() === 'offline'
        ? "Couldn't make out any text in that photo. Offline mode reads printed text; handwriting and diagrams need the Claude API key. Try a sharper, well-lit photo."
        : "Couldn't find a concept in that photo. Try a sharper, well-lit photo of the page or notes.",
    });
  }
  const uploadId = store.id();
  fs.writeFileSync(path.join(UPLOAD_DIR, `${uploadId}.${EXT[mediaType]}`), Buffer.from(data, 'base64'));
  const { results } = await semantic.search(`${reading.topic}. ${reading.text.slice(0, 1000)}`, db.videos);
  res.json({
    uploadId, imageUrl: `/uploads/${uploadId}.${EXT[mediaType]}`,
    kind: reading.kind, topic: reading.topic, text: reading.text, mode: reading.mode,
    strongMatch: results.some((r) => r.strong),
  });
}));

app.post('/api/generate', wrap(async (req, res) => {
  const db = store.load();
  const u = getUser(req.body.user);
  let topic = String(req.body.topic || '').trim().slice(0, 200);
  const sourceText = String(req.body.sourceText || '').trim().slice(0, 6000);
  const image = req.body.uploadId ? loadUpload(req.body.uploadId) : null;
  if (req.body.uploadId && !image) return res.status(400).json({ error: 'That photo has expired. Please add it again.' });
  if (!topic && !image) return res.status(400).json({ error: 'Tell us which concept you want explained.' });
  if (!topic) topic = 'My notes';
  if (u.balance < COST.video) spend(u, COST.video); // throws a friendly 402
  const sb = await gen.generateVideo({ topic, sourceText, image });
  spend(u, COST.video);
  const v = {
    id: store.id(), source: 'generated', createdBy: u.name, createdAt: Date.now(), parentId: null, parentScene: null,
    style: image ? 'From a photo' : sourceText ? 'From your notes' : 'Story', ...sb,
    sourceImage: image ? image.url : null, stats: store.emptyStats(),
  };
  db.videos.push(v);
  await semantic.indexVideo(v); // build its knowledge graph + embeddings from the new transcript
  db.metrics.generatedCount++;
  u.viewed[v.id] = Date.now();
  store.save();
  res.json({ video: card(v), user: userView(u) });
}));

app.post('/api/videos/:id/explain', wrap(async (req, res) => {
  const db = store.load();
  const v = db.videos.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const u = getUser(req.body.user);
  const idx = Math.max(0, Math.min(v.scenes.length - 1, Number(req.body.sceneIndex) || 0));
  const question = String(req.body.question || '').trim().slice(0, 300);
  v.stats.explainRequests++;
  v.stats.confusedScenes = v.stats.confusedScenes || {};
  v.stats.confusedScenes[idx] = (v.stats.confusedScenes[idx] || 0) + 1;

  // Someone already asked about this exact part? Reuse it for free.
  const existing = !req.body.forceNew && db.videos.find((x) => x.parentId === v.id && x.parentScene === idx);
  if (existing) {
    db.metrics.explainersReused++;
    store.save();
    return res.json({ video: card(existing), reused: true, user: userView(u) });
  }
  if (u.balance < COST.explainer) spend(u, COST.explainer);
  const ex = await gen.generateExplainer({ video: v, scene: v.scenes[idx], question });
  spend(u, COST.explainer);
  const child = {
    id: store.id(), source: 'explainer', createdBy: u.name, createdAt: Date.now(), parentId: v.id, parentScene: idx,
    subject: v.subject, grade: v.grade, style: 'Deep dive', summary: `A slower look at "${v.scenes[idx].heading}"`, tags: v.tags,
    ...ex, stats: store.emptyStats(),
  };
  db.videos.push(child);
  await semantic.indexVideo(child);
  db.metrics.explainersGenerated++;
  u.viewed[child.id] = Date.now();
  store.save();
  res.json({ video: card(child), reused: false, user: userView(u) });
}));

app.post('/api/reset', wrap(async (req, res) => {
  const db = store.reset();
  await semantic.indexAll(db.videos);
  store.save();
  res.json({ ok: true });
}));

const PORT = process.env.PORT || 3000;
semantic.indexAll(store.load().videos).then((info) => {
  store.save();
  console.log(`Indexed ${info.videos} videos: ${info.concepts} concepts in the knowledge graph, embeddings ${info.embeddings ? 'on' : 'OFF (run npm run fetch-model)'} (${info.ms} ms)`);
  app.listen(PORT, () => console.log(`ConceptReel running on http://localhost:${PORT} (generator: ${gen.mode()})`));
});
