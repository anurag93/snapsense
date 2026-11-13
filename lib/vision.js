// Reading a photo the learner snapped: a textbook page, a diagram, a screenshot or handwritten notes.
// With an API key, Claude reads it (handwriting and diagrams included).
// Offline, built-in OCR (tesseract.js, English data bundled in /tessdata) reads printed text.
// Either way the result is a topic + transcription, which we use to look for saved videos
// before spending tokens on a new one.

const path = require('path');
const { z } = require('zod');
const { tokenize } = require('./match');
const gen = require('./generator');

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const ImageReading = z.object({
  kind: z.enum(['textbook', 'diagram', 'handwriting', 'screenshot', 'other']),
  topic: z.string(),
  text: z.string(),
  readable: z.boolean(),
});

async function claudeRead({ data, mediaType }) {
  const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
  const res = await gen.client().messages.parse({
    model: gen.MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(ImageReading) },
    system: 'A high school student photographed something they want explained: a textbook page, a diagram, a screenshot or their own handwritten notes. Identify the single main concept (topic, 2-6 words, the way a student would search for it). Transcribe the text faithfully, including handwriting; for a diagram, describe what it shows in plain sentences (labels, arrows, what connects to what). Set readable=false if the image has no educational content you can make out.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: 'Read this and tell me the concept.' },
      ],
    }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error('Could not read the image');
  return res.parsed_output;
}

let workerPromise = null;
function ocrWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker('eng', 1, {
      langPath: path.join(__dirname, '..', 'tessdata'),
      gzip: true,
      cachePath: path.join(__dirname, '..', 'data', 'tesscache'),
    });
  }
  return workerPromise;
}

function cleanOcr(raw) {
  const lines = raw.split('\n').map((l) => l.trim());
  // Re-join wrapped lines into paragraphs, and fix hyphenated line breaks.
  const paras = [];
  let cur = '';
  for (const l of lines) {
    if (!l) { if (cur) paras.push(cur); cur = ''; continue; }
    cur = cur ? (cur.endsWith('-') ? cur.slice(0, -1) + l : cur + ' ' + l) : l;
  }
  if (cur) paras.push(cur);
  return paras;
}

function guessTopic(paras) {
  // A heading is a short line near the top that isn't a chapter label or a sentence.
  for (const p of paras.slice(0, 5)) {
    const t = p.replace(/^[\d.\s]+/, '').trim();
    const words = t.split(/\s+/);
    if (words.length >= 1 && words.length <= 6 && !/chapter|unit|page|lesson/i.test(t) && !/[.!?]$/.test(t) && /[a-z]/i.test(t)) return t;
  }
  const words = tokenize(paras.join(' '));
  const counts = {};
  for (const w of words) if (w.length > 4) counts[w] = (counts[w] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w).join(' ') || 'My notes';
}

async function offlineRead({ buffer }) {
  const worker = await ocrWorker();
  const { data } = await worker.recognize(buffer);
  const paras = cleanOcr(data.text || '');
  const text = paras.join('\n\n');
  const readable = data.confidence > 45 && text.replace(/\s/g, '').length > 25;
  const topic = guessTopic(paras);
  // Drop the heading line from the body so the video doesn't read the title twice.
  const body = paras.filter((p) => p.replace(/^[\d.\s]+/, '').trim() !== topic && !/^chapter\b/i.test(p)).join('\n\n');
  return { kind: 'textbook', topic, text: body || text, readable, confidence: Math.round(data.confidence) };
}

async function readImage({ data, mediaType }) {
  const buffer = Buffer.from(data, 'base64');
  if (gen.mode() === 'claude') return { ...(await claudeRead({ data, mediaType })), mode: 'claude' };
  const r = await offlineRead({ buffer });
  return { ...r, mode: 'offline' };
}

module.exports = { readImage, MEDIA_TYPES };
