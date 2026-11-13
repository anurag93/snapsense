// Storyboard generator. A "video" here is a storyboard: scenes with narration,
// on-screen visuals and a quick check-for-understanding quiz. The browser renders it
// as an animated, narrated video. That keeps generation to one cheap LLM call
// instead of expensive pixel-level video generation.
//
// If ANTHROPIC_API_KEY is set, Claude writes the storyboard. Otherwise an offline
// generator builds one from the text the learner pasted, so the demo runs with no keys.

const { z } = require('zod');
const { tokenize } = require('./match');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
let client = null;
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
  const Anthropic = require('@anthropic-ai/sdk');
  client = new (Anthropic.default || Anthropic)();
}
const mode = () => (client ? 'claude' : 'offline');

// ---------- Schema shared by both generators ----------
const Visual = z.object({
  kind: z.enum(['title', 'icons', 'flow', 'equation', 'compare', 'timeline', 'keywords']),
  emoji: z.string().nullable(),
  caption: z.string().nullable(),
  items: z.array(z.object({ e: z.string(), t: z.string() })).nullable(),
  steps: z.array(z.string()).nullable(),
  text: z.string().nullable(),
  note: z.string().nullable(),
  left: z.object({ h: z.string(), items: z.array(z.string()) }).nullable(),
  right: z.object({ h: z.string(), items: z.array(z.string()) }).nullable(),
  events: z.array(z.object({ y: z.string(), t: z.string() })).nullable(),
  words: z.array(z.string()).nullable(),
});
const Scene = z.object({ heading: z.string(), narration: z.string(), visual: Visual });
const Storyboard = z.object({
  title: z.string(),
  subject: z.string(),
  grade: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  scenes: z.array(Scene),
  quiz: z.array(z.object({ q: z.string(), options: z.array(z.string()), answer: z.number().int() })),
});
const Explainer = z.object({ title: z.string(), scenes: z.array(Scene), quiz: z.array(z.object({ q: z.string(), options: z.array(z.string()), answer: z.number().int() })) });

const VISUAL_GUIDE = `Each scene has a visual. Pick the kind that best shows the idea and fill only its fields (others null):
- title: emoji + caption (an opening hook)
- icons: items [{e: emoji, t: short label}] (2-4 items)
- flow: steps [short strings] (3-4 steps, a process or cause→effect chain)
- equation: text (formula) + note
- compare: left {h, items[]} and right {h, items[]}
- timeline: events [{y: date, t: event}] (2-4)
- keywords: words [] (3-6 key terms)
Labels must be short (under 5 words).`;

async function claudeStoryboard({ topic, sourceText, image }) {
  const text = `Concept: ${topic || '(work it out from the photo)'}\n${sourceText ? `\nThe student gave us this text${image ? ' (read from their photo)' : ' from their textbook'}. Base the video on it:\n<source>\n${sourceText}\n</source>` : ''}${image ? '\nThe attached photo is what the student snapped (a textbook page, diagram or their handwritten notes). Use it, including any diagram, to shape the scenes.' : ''}`;
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Storyboard) },
    system: `You write short explainer videos for high school students. Each video is a storyboard of 4-6 scenes. Narration is spoken aloud: 1-3 plain sentences per scene, concrete, with one vivid analogy or example. Be factually accurate. End with 2 multiple-choice quiz questions (3 options, answer = index of correct option) that test understanding, not recall of wording.\n\n${VISUAL_GUIDE}`,
    messages: [{
      role: 'user',
      content: image
        ? [{ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }, { type: 'text', text }]
        : text,
    }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error('Generation failed');
  return res.parsed_output;
}

async function claudeExplainer({ video, scene, question }) {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Explainer) },
    system: `A high school student watching an explainer video got stuck on one part. Make a short follow-up video (3 scenes) that slows down and explains only that part: break it into smaller steps, use a different analogy than the original, and finish with a one-line recap. Add 1 quiz question (3 options).\n\n${VISUAL_GUIDE}`,
    messages: [{
      role: 'user',
      content: `Video: ${video.title}\nThe part they got stuck on, "${scene.heading}":\n${scene.narration}\n${question ? `\nTheir question: ${question}` : ''}`,
    }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error('Generation failed');
  return res.parsed_output;
}

function zodOutputFormat(schema) {
  return require('@anthropic-ai/sdk/helpers/zod').zodOutputFormat(schema);
}

// ---------- Offline generator ----------
const EMOJI = {
  war: '⚔️', king: '👑', queen: '👑', money: '💰', tax: '💰', trade: '🚢', ship: '🚢', water: '💧', sun: '☀️', light: '💡',
  energy: '⚡', cell: '🧫', dna: '🧬', gene: '🧬', heart: '❤️', blood: '🩸', brain: '🧠', plant: '🌱', tree: '🌳', animal: '🐾',
  earth: '🌍', planet: '🪐', star: '⭐', atom: '⚛️', electron: '⚛️', acid: '🧪', reaction: '🧪', heat: '🔥', fire: '🔥',
  force: '💪', speed: '🏎️', time: '⏳', number: '🔢', equation: '🟰', graph: '📈', growth: '📈', city: '🏙️', farm: '🌾',
  people: '👥', law: '⚖️', vote: '🗳️', government: '🏛️', empire: '🏛️', book: '📖', idea: '💡', machine: '⚙️', factory: '🏭',
  ocean: '🌊', mitochondria: '🔋', glucose: '🍬', sugar: '🍬', oxygen: '🫧', carbon: '⚫', molecule: '🧪', protein: '🥩', enzyme: '✂️', bacteria: '🦠', volcano: '🌋', rock: '🪨', magnet: '🧲', wave: '〰️', sound: '🔊', electricity: '⚡', current: '⚡', battery: '🔋', revolution: '✊', colony: '🏴', treaty: '📜', slavery: '⛓️', religion: '⛪', church: '⛪', army: '🪖', soldier: '🪖', poem: '📝', poetry: '📝', story: '📚', character: '🎭', fraction: '➗', angle: '📐', circle: '⭕', function: '📈', probability: '🎲', population: '👥', river: '🏞️', rain: '🌧️', climate: '🌡️', food: '🍎', disease: '🦠', virus: '🦠', computer: '💻', map: '🗺️',
};
const emojiFor = (w) => EMOJI[w] || EMOJI[w.replace(/s$/, '')] || '🔹';

function sentences(text) {
  return String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter((s) => s.split(' ').length > 3) || [];
}
function keywords(text, n = 4) {
  const words = String(text).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  const counts = new Map();
  for (const w of words) {
    if (!tokenize(w).length || COMMON.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, n).map(([w]) => w);
}
const COMMON = new Set('also very much many more most other some such than then there these those this that with from have has had were will would could should into over under after before because while which where when what about their them they being been only just like made make makes using used each between both through during against among within without'.split(' '));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nullVisual = { emoji: null, caption: null, items: null, steps: null, text: null, note: null, left: null, right: null, events: null, words: null };

function visualFor(sentence, i) {
  const kws = keywords(sentence, 4);
  const years = sentence.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g);
  if (/[=+×÷]|\^|\bequals\b/.test(sentence)) return { ...nullVisual, kind: 'equation', text: (sentence.match(/[^,.;:]*[=][^,.;:]*/) || [sentence])[0].trim().slice(0, 60), note: kws.slice(0, 2).join(' · ') };
  if (years && years.length) return { ...nullVisual, kind: 'timeline', events: years.slice(0, 3).map((y) => ({ y, t: cap(kws[0] || 'event') })) };
  if (/\b(leads? to|causes?|then|results? in|because|so that)\b/i.test(sentence) && kws.length >= 3) return { ...nullVisual, kind: 'flow', steps: kws.slice(0, 3).map(cap) };
  if (i === 0) return { ...nullVisual, kind: 'title', emoji: emojiFor(kws[0] || ''), caption: cap(kws.slice(0, 2).join(' & ') || 'Let\'s begin') };
  if (kws.length >= 3) return { ...nullVisual, kind: 'icons', items: kws.slice(0, 3).map((w) => ({ e: emojiFor(w), t: cap(w) })) };
  return { ...nullVisual, kind: 'keywords', words: kws.map(cap) };
}

function clozeQuiz(sents, n = 2) {
  const all = keywords(sents.join(' '), 12);
  const out = [];
  for (const s of sents) {
    if (out.length >= n) break;
    const k = keywords(s, 1)[0];
    if (!k) continue;
    const distractors = all.filter((w) => w !== k).slice(out.length * 2, out.length * 2 + 2);
    if (distractors.length < 2) continue;
    const options = [k, ...distractors].map(cap);
    const answerIdx = (s.length + out.length) % 3;
    [options[0], options[answerIdx]] = [options[answerIdx], options[0]];
    out.push({ q: `Fill the gap: "${s.replace(new RegExp(`\\b${k}\\b`, 'i'), '_____')}"`, options, answer: answerIdx });
  }
  return out;
}

function offlineStoryboard({ topic, sourceText }) {
  const sents = sentences(sourceText);
  if (sents.length < 2) {
    const err = new Error('Offline mode needs some text to work from. Paste a few sentences or add a photo of the page, or set ANTHROPIC_API_KEY to generate from the topic alone.');
    err.status = 400;
    throw err;
  }
  // Group sentences into 3-6 scenes.
  const nScenes = Math.max(3, Math.min(6, Math.ceil(sents.length / 2)));
  const per = Math.ceil(sents.length / nScenes);
  const scenes = [];
  for (let i = 0; i < sents.length; i += per) {
    const chunk = sents.slice(i, i + per);
    const text = chunk.join(' ');
    const kws = keywords(text, 3);
    scenes.push({ heading: cap(kws.slice(0, 2).join(' and ') || `Part ${scenes.length + 1}`), narration: text, visual: visualFor(text, scenes.length) });
  }
  scenes.push({ heading: 'Recap', narration: `To recap ${topic}: ${keywords(sourceText, 4).join(', ')}. Now check yourself with a quick question.`, visual: { ...nullVisual, kind: 'keywords', words: keywords(sourceText, 5).map(cap) } });
  return {
    title: cap(topic),
    subject: 'General', grade: '9-12',
    summary: sents[0].slice(0, 140),
    tags: [...new Set([...tokenize(topic), ...keywords(sourceText, 6)])],
    scenes,
    quiz: clozeQuiz(sents),
  };
}

function offlineExplainer({ video, scene }) {
  if (scene.deeper && scene.deeper.length) {
    return { title: `Zoom in: ${scene.heading}`, scenes: scene.deeper.map((s) => ({ ...s, visual: { ...nullVisual, ...s.visual } })), quiz: [] };
  }
  const parts = scene.narration.split(/(?<=[.!?])\s+|,\s+(?=and |but |so |which )/).filter((p) => p.split(' ').length > 2);
  const scenes = parts.map((p, i) => ({ heading: i === 0 ? `Step back: ${scene.heading}` : `Step ${i + 1}`, narration: p, visual: visualFor(p, i + 1) }));
  scenes.push({ heading: 'In one line', narration: `So the key idea of "${scene.heading}" is: ${parts[0]}`, visual: { ...nullVisual, kind: 'title', emoji: '💡', caption: scene.heading } });
  return { title: `Zoom in: ${scene.heading}`, scenes, quiz: [] };
}

// ---------- Public API ----------
async function generateVideo(args) {
  return client ? claudeStoryboard(args) : offlineStoryboard(args);
}
async function generateExplainer(args) {
  if (client) return claudeExplainer(args);
  return offlineExplainer(args);
}

module.exports = { generateVideo, generateExplainer, mode, client: () => client, MODEL };
