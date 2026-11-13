// Local sentence embeddings: all-MiniLM-L6-v2 (384-dim, mean pooled, L2-normalised), run on CPU with
// ONNX Runtime via transformers.js. No network and no paid API at query time.
// Model files live in /models/all-MiniLM-L6-v2 (run `npm run fetch-model` to download them).

const path = require('path');
const fs = require('fs');

const MODEL_DIR = path.join(__dirname, '..', 'models');
const MODEL_NAME = 'all-MiniLM-L6-v2';
let extractorPromise = null;
const cache = new Map();

function available() {
  return fs.existsSync(path.join(MODEL_DIR, MODEL_NAME, 'onnx', 'model.onnx'));
}

function extractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowRemoteModels = false;
      env.localModelPath = MODEL_DIR + path.sep;
      return pipeline('feature-extraction', MODEL_NAME, { dtype: 'fp32' });
    })();
  }
  return extractorPromise;
}

const round = (v) => v.map((x) => Math.round(x * 1e4) / 1e4);

// Embed a list of strings; returns arrays of numbers. Cached per string.
async function embed(texts) {
  const todo = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (todo.length) {
    const fe = await extractor();
    for (let i = 0; i < todo.length; i += 32) {
      const batch = todo.slice(i, i + 32);
      const out = (await fe(batch, { pooling: 'mean', normalize: true })).tolist();
      batch.forEach((t, j) => cache.set(t, round(out[j])));
    }
  }
  return texts.map((t) => cache.get(t));
}

function cosine(a, b) {
  if (!a || !b) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // vectors are normalised
}

const cached = (t) => cache.get(t) || null;

module.exports = { embed, cosine, available, cached };
