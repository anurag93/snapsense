// Tiny JSON-file store. Good enough for a hackathon demo; swap for Postgres/Snowflake later.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const seed = require('./seed');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');

const id = () => crypto.randomBytes(6).toString('hex');
const emptyStats = () => ({ views: 0, completions: 0, likes: 0, dislikes: 0, quizAttempts: 0, quizCorrect: 0, explainRequests: 0, confusedScenes: {} });

function freshDb() {
  const now = Date.now();
  const videos = seed.map((v, i) => ({
    id: id(),
    source: 'library',
    createdBy: 'community',
    createdAt: now - (i + 1) * 86400000 * 3,
    parentId: null,
    parentScene: null,
    ...v,
    stats: { ...emptyStats(), ...v.stats },
  }));
  return {
    videos,
    users: {},
    events: [],
    metrics: { reuseCount: 0, generatedCount: 0, explainersGenerated: 0, explainersReused: 0, tokensSaved: 0 },
  };
}

let db;
function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    db = freshDb();
    save();
  }
  return db;
}
function save() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 1));
}
function reset() {
  db = freshDb();
  save();
  return db;
}

module.exports = { load, save, reset, id, emptyStats };
