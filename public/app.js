/* ConceptReel front end: vanilla JS, hash routing. */
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// In-video checkpoint questions are off: understanding is measured by the same quiz before and after the video.
const IN_VIDEO_CHECKPOINTS = false;
const SUBJECT_EMOJI = { Biology: '🧬', Physics: '🛹', History: '🏛️', Math: '📐', Economics: '📈', 'Earth Science': '🌍', Chemistry: '⚗️', General: '💡' };

let state = { user: localStorage.getItem('cr-user') || 'Maya', info: null };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify({ user: state.user, ...opts.body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, code: data.code });
  return data;
}

function toast(msg, ms = 4200) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}
// Guardrail messages: a distress signal gets a calm card with support info, never a passing toast.
function showError(e, ms = 6000) {
  if (e.code === 'distress') {
    modal(`<div style="font-size:40px">💛</div><h3>We're here for you</h3><p>${esc(e.message)}</p><button class="btn" id="m-close">OK</button>`);
    $('#m-close').addEventListener('click', () => modal());
    return;
  }
  toast(`${e.code && !['hold', 'illegible', 'review_failed'].includes(e.code) ? '🛡️ ' : ''}${esc(e.message)}`, ms);
}
const U = () => `user=${encodeURIComponent(state.user)}`;
function modal(html) {
  const m = $('#modal');
  if (!html) { m.hidden = true; return; }
  $('#modal-card').innerHTML = html;
  m.hidden = false;
}

// ---------- header ----------
async function refreshState() {
  state.info = await api(`/api/state?user=${encodeURIComponent(state.user)}`);
  renderTokens(state.info.user);
  const sel = $('#user-select');
  const names = [...new Set([...state.info.demoUsers, state.user])];
  sel.innerHTML = names.map((n) => `<option ${n === state.user ? 'selected' : ''}>${esc(n)}</option>`).join('') + '<option value="__new">+ New learner…</option>';
  if (!state.info.user.grade) await onboardGrade();
  renderGradeBar();
}
// Grade picker under the header: always visible, saved per learner.
function renderGradeBar() {
  const bar = $('#gradebar');
  const u = state.info.user;
  bar.hidden = !u.grade;
  if (!u.grade) return;
  const label = (g) => (g === 'K' ? 'Kindergarten' : `Grade ${g}`);
  bar.innerHTML = `<div class="gb-inner">
    <div class="gb-head"><h2 id="gradebar-h">What grade are you in?</h2><span class="hint">Saved for ${esc(state.user)} · Change anytime</span></div>
    <div class="gb-grades" role="radiogroup" aria-labelledby="gradebar-h">${state.info.grades.map((g) => `<button type="button" role="radio" aria-checked="${g === u.grade}" aria-label="${label(g)}" class="gb-g ${g === u.grade ? 'on' : ''}" data-setgrade="${g}">${g}</button>`).join('')}</div>
    <div class="gb-foot"><span>${esc(label(u.grade))}: videos, search results and new explanations are tailored to your level.</span><span>K = Kindergarten</span></div></div>`;
  bar.querySelectorAll('[data-setgrade]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.setgrade === u.grade) return;
    try {
      const r = await api('/api/user/grade', { body: { grade: b.dataset.setgrade } });
      state.info.user = r.user;
      renderTokens(r.user);
      toast(`Saved. Lessons are now tailored to ${esc(label(r.user.grade))}.`);
      await route();
      const nb = $(`[data-setgrade="${b.dataset.setgrade}"]`); if (nb) nb.focus();
    } catch (e) { showError(e); }
  }));
}
$('#nav-how').addEventListener('click', () => {
  modal(`<h3>How Snapsense works</h3><ol class="how">
    <li><b>Explore a topic.</b> Search, tap a topic or upload a page. If another learner already made a lesson for it, you watch it free.</li>
    <li><b>Watch a short explanation.</b> Checkpoints along the way check that it clicked.</li>
    <li><b>Ask about the tricky part.</b> Pick the seconds you didn't get and get a deep dive just for that part. It joins the library for the next learner.</li></ol>
    <p class="hint">You get ${state.info ? state.info.user.weekly : 100} tokens a week. New lessons cost tokens; reusing saved ones is free.</p>
    <button class="btn" id="m-close">Got it</button>`);
  $('#m-close').addEventListener('click', () => modal());
  $('#m-close').focus();
});
// Onboarding: every learner gets a grade (in production the school or teacher account assigns it).
function onboardGrade() {
  return new Promise((resolve) => {
    modal(`<h3>Welcome, ${esc(state.user)}!</h3><p class="hint">Which grade are you in? Your school sets this when you join, and it decides how
      lessons are explained and which videos you see.</p><div class="grade-grid">${state.info.grades.map((g) => `<button class="btn soft" data-grade="${g}">${g === 'K' ? 'K' : `Grade ${g}`}</button>`).join('')}</div>`);
    document.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', async () => {
      const r = await api('/api/user/grade', { body: { grade: b.dataset.grade } });
      state.info.user = r.user;
      renderTokens(r.user);
      modal();
      resolve();
    }));
  });
}
function renderTokens(u) {
  if (!u) return;
  if (state.info) state.info.user = u;
  $('#tokens-num').textContent = `${u.balance} / ${u.weekly}`;
  $('#tokens-bar').style.width = `${(u.balance / u.weekly) * 100}%`;
  const days = Math.max(0, Math.ceil((u.resetsAt - Date.now()) / 86400000));
  $('#tokens-sub').textContent = `Refills in ${days} day${days === 1 ? '' : 's'}${u.saved ? ` · ${u.saved} saved by reusing` : ''}`;
  $('#tokens').setAttribute('aria-label', `${u.balance} of ${u.weekly} weekly tokens left`);
}
function askLearnerName() {
  return new Promise((resolve) => {
    modal(`<h3>Add a learner</h3><form id="nl-form" class="nl-form"><label for="nl-name">First name or nickname</label>
      <input id="nl-name" maxlength="24" autocomplete="off" required />
      <p class="hint">Avoid full names. Each learner gets their own grade, tokens and progress.</p>
      <div class="gen-row" style="justify-content:center"><button class="btn primary">Add learner</button><button class="btn outline" type="button" id="nl-cancel">Cancel</button></div></form>`);
    $('#nl-name').focus();
    $('#nl-cancel').addEventListener('click', () => { modal(); resolve(''); });
    $('#nl-form').addEventListener('submit', (ev) => { ev.preventDefault(); const n = $('#nl-name').value.trim().slice(0, 24); modal(); resolve(n); });
  });
}
$('#user-select').addEventListener('change', async (e) => {
  let name = e.target.value;
  if (name === '__new') {
    name = await askLearnerName();
    if (!name) { e.target.value = state.user; return; }
  }
  state.user = name;
  localStorage.setItem('cr-user', state.user);
  await refreshState();
  route();
  toast(`Switched to ${esc(state.user)}. Each learner has their own weekly tokens.`);
});

// ---------- shared bits ----------
function qPill(q) {
  return q.confident ? `<span class="qpill ${qClass(q.score)}">Helpfulness ${q.score}</span>` : '<span class="qpill new">New · not rated yet</span>';
}
function qClass(score) { return score >= 75 ? '' : score >= 60 ? 'mid' : 'low'; }
function thumb(v) { return posterHtml(v, true); }
// Poster art for lesson cards: a big word and a tagline on the subject colour.
const SUBJECT_TONE = { Biology: 'peach', Math: 'lilac', 'Earth Science': 'mint', Economics: 'butter', Physics: 'sky', History: 'rose', Chemistry: 'lime', General: 'stone' };
const POSTERS = [
  [/water cycle/i, 'WATER', 'Evaporate. Condense. Repeat.', 'mint'],
  [/pythagor/i, 'a² + b² = c²', 'Three sides. One big idea.', 'lilac'],
  [/mitosis/i, '1 → 2', 'One cell. Two new beginnings.', 'peach'],
  [/photosynthesis in 60/i, '6CO₂ + 6H₂O', 'The whole recipe in one line.', 'mint'],
  [/photosynthesis/i, 'LIGHT → LIFE', 'A little sunlight goes a long way.', 'lime'],
  [/supply and demand/i, 'SUPPLY + DEMAND', 'What makes a price change?', 'butter'],
  [/newton/i, 'F = ma', "Let's get things moving.", 'sky'],
  [/french revolution/i, '1789', 'The ideas that changed France.', 'rose'],
  [/industrial revolution/i, 'A NEW ERA', 'From hand tools to machines.', 'stone'],
  [/krebs/i, 'CYCLE', 'Where your energy comes from.', 'peach'],
];
function poster(v) {
  const hit = POSTERS.find(([re]) => re.test(v.title));
  if (hit) return { big: hit[1], tag: hit[2], tone: hit[3] };
  const words = v.title.replace(/[:(].*$/, '').trim().split(/\s+/);
  return { big: words.slice(0, 2).join(' ').toUpperCase(), tag: (v.summary || '').split(/(?<=\.)\s/)[0].slice(0, 60), tone: v.source === 'explainer' ? 'lime' : SUBJECT_TONE[v.subject] || 'stone' };
}
function posterHtml(v, small = false) {
  const p = poster(v);
  return `<div class="poster tone-${p.tone}${small ? ' small' : ''}" aria-hidden="true">
    <div class="p-sub">${esc(v.source === 'explainer' ? 'Deep dive' : v.subject)}</div>
    <div class="p-big">${esc(p.big)}</div>
    ${small ? '' : `<div class="p-tag">${esc(p.tag)}</div>`}
    <span class="p-dur">${fmt(v.duration)}</span>
    ${v.source === 'generated' ? `<span class="p-badge">${v.sourceImage ? 'From a photo' : 'New'}</span>` : ''}
  </div>`;
}
const gradeRange = (b) => String(b || '').replace('-', '–');
function videoCard(v) {
  return `<article class="vcard">
    ${posterHtml(v)}
    <h3 class="vtitle">${esc(v.title)}</h3>
    <div class="vmeta">${esc(v.subject)} · Grades ${esc(gradeRange(v.gradeBand))}</div>
    <div class="vmeta small">${v.stats.views} views · Helpfulness ${v.quality.score}/100</div>
    <a class="btn dark full" href="#/watch/${v.id}">Watch lesson <span aria-hidden="true">→</span><span class="sr"> : ${esc(v.title)}</span></a>
  </article>`;
}
// The learning companion. Decorative, so screen readers skip it.
function mascot(cls = '') {
  return `<svg class="mascot ${cls}" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <path d="M150 34l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#f08a4b"/>
    <g transform="rotate(-14 46 92)"><rect x="38" y="52" width="13" height="58" rx="3" fill="#f08a4b" stroke="#1a1a1a" stroke-width="4"/><path d="M38 52l6.5-14 6.5 14z" fill="#fff6e8" stroke="#1a1a1a" stroke-width="4" stroke-linejoin="round"/></g>
    <path d="M52 112c-8-4-14 4-8 10" fill="none" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round"/>
    <path d="M70 58c20-8 52-8 72 0 10 4 12 14 10 30 2 20 0 40-6 52-18 8-56 8-74 0-8-14-10-34-8-52-2-16-4-26 6-30z" fill="#b9d63a" stroke="#1a1a1a" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="94" cy="88" r="11" fill="#fff" stroke="#1a1a1a" stroke-width="4"/><circle cx="96" cy="90" r="5" fill="#1a1a1a"/>
    <circle cx="124" cy="88" r="11" fill="#fff" stroke="#1a1a1a" stroke-width="4"/><circle cx="126" cy="90" r="5" fill="#1a1a1a"/>
    <path d="M88 70q6-5 12 0M118 70q6-5 12 0" fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round"/>
    <path d="M100 106q9 7 18 0" fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round"/>
    <path d="M104 116v22l18-11z" fill="#fff6e8" stroke="#1a1a1a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M152 100c8-6 14-14 14-24M166 76l6-10M160 70l2-12M154 74l-4-10" fill="none" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round"/>
    <path d="M90 148l-8 22M128 148l6 22" stroke="#1a1a1a" stroke-width="5" stroke-linecap="round"/>
    <path d="M64 170h26l2 9H62z" fill="#f08a4b" stroke="#1a1a1a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M126 170h26l2 9h-30z" fill="#f08a4b" stroke="#1a1a1a" stroke-width="4" stroke-linejoin="round"/>
  </svg>`;
}
function bindGo(root = app) {
  root.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => (location.hash = `#/watch/${el.dataset.go}`)));
}

// ---------- Photos (textbook page, diagram, screenshot, handwriting) ----------
const KIND_LABEL = { textbook: 'a textbook page', diagram: 'a diagram', handwriting: 'handwritten notes', screenshot: 'a screenshot', other: 'your photo' };
function downscale(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      // Keep screenshots lossless (sharper text); compress camera photos.
      resolve(file.type === 'image/png' && file.size < 4e6 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open that image.")); };
    img.src = url;
  });
}
async function handlePhoto(file) {
  if (!file || !/^image\//.test(file.type)) return toast("That file isn't an image.");
  modal(`<div class="spinner"></div><h3>Reading your photo…</h3><p class="hint">Finding the concept, then checking the library for videos other learners already made.</p>`);
  try {
    const image = await downscale(file);
    const r = await api('/api/read-image', { body: { image } });
    sessionStorage.setItem('cr-photo', JSON.stringify(r));
    modal();
    location.hash = `#/search?q=${encodeURIComponent(r.topic)}&photo=${r.uploadId}`;
  } catch (e) {
    modal();
    showError(e, 8000);
  }
}
function photoPicker() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.addEventListener('change', () => handlePhoto(inp.files[0]));
  inp.click();
}
// Paste a screenshot or drop an image anywhere on the home or search page.
const photoRoute = () => !/^#\/watch\//.test(location.hash);
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type));
  if (f && photoRoute()) { e.preventDefault(); handlePhoto(f); }
});
document.addEventListener('dragover', (e) => { if (photoRoute()) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const f = [...(e.dataTransfer?.files || [])].find((x) => /^image\//.test(x.type));
  if (f && photoRoute()) { e.preventDefault(); handlePhoto(f); }
});

// ---------- Home ----------
async function renderHome() {
  const [{ videos }] = await Promise.all([api(`/api/trending?${U()}`), refreshState()]);
  const m = state.info.metrics;
  const g = state.info.user.grade;
  const sorters = {
    helpful: (a, b) => b.quality.score - a.quality.score,
    views: (a, b) => b.stats.views - a.stats.views,
    short: (a, b) => a.duration - b.duration,
  };
  const sortKey = sessionStorage.getItem('cr-sort') || 'helpful';
  app.innerHTML = `
    <section class="hero" aria-labelledby="hero-h">
      <div class="hero-main">
        <span class="badge-pill">Big questions. Small videos.</span>
        <h1 id="hero-h">Your next “I get it!” starts here.</h1>
        <p class="lede">Explore a topic, watch an explanation, and ask about the part that’s tricky.</p>
        <form class="searchbar" id="search-form" role="search">
          <label for="q" class="field-label">What would you like to understand?</label>
          <div class="search-row">
            <input id="q" placeholder="Try “How do plants make food from sunlight?”" autocomplete="off" />
            <button class="btn primary big">Find videos</button>
          </div>
        </form>
        <div class="photo-row">
          <span class="field-label">Have a question on paper?</span>
          <button class="btn outline" id="photo-btn" type="button">Upload a page</button>
        </div>
        <p class="hint">Textbook, diagram or notes · You can also paste an image.</p>
      </div>
      <div class="hero-art">
        <div class="mascot-disc">${mascot()}</div>
        <div class="tagline-card">Small videos. Big lightbulb energy.</div>
      </div>
    </section>
    <section aria-labelledby="topics-h">
      <h2 id="topics-h" class="label-h">Try a topic</h2>
      <div class="chips">
        ${[['Photosynthesis', 'Photosynthesis'], ["Newton's laws", "Newton's laws"], ['French Revolution', 'Why the French Revolution started'], ['Mitosis', 'Mitosis phases'], ['Pythagoras', 'Pythagoras theorem'], ['Supply and demand', 'Supply and demand'], ['Krebs cycle', 'The Krebs cycle']]
          .map(([l, q]) => `<button class="chip" data-q="${esc(q)}">${esc(l)}</button>`).join('')}
      </div>
    </section>
    <section aria-labelledby="lib-h">
      <div class="lib-head">
        <div><h2 id="lib-h">Find your next lightbulb moment</h2>
        <p class="sub">${g ? `For ${g === 'K' ? 'Kindergarten' : `Grade ${esc(g)}`} · ` : ''}Includes earlier-grade refreshers · Free to watch</p></div>
        <label class="sort"><span class="sr">Sort lessons</span><select id="sort">
          <option value="helpful" ${sortKey === 'helpful' ? 'selected' : ''}>Most helpful first</option>
          <option value="views" ${sortKey === 'views' ? 'selected' : ''}>Most watched</option>
          <option value="short" ${sortKey === 'short' ? 'selected' : ''}>Shortest first</option></select></label>
      </div>
      <div class="grid" id="lib">${[...videos].sort(sorters[sortKey]).map(videoCard).join('')}</div>
    </section>
    <section class="together" aria-labelledby="tog-h">
      <h2 id="tog-h">Better when we learn together</h2>
      <div class="tog-stats">
        <div><b>${m.videos}</b><span>concept videos</span></div>
        <div><b>${m.reuseCount}</b><span>saved videos reused</span></div>
        <div><b>${m.tokensSaved}</b><span>tokens saved by reusing</span></div>
        <div><b>${m.explainers}</b><span>“explain this part” deep dives</span></div>
      </div>
    </section>`;
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`; });
  app.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/search?q=${encodeURIComponent(b.dataset.q)}`)));
  $('#photo-btn').addEventListener('click', photoPicker);
  $('#sort').addEventListener('change', (e) => {
    sessionStorage.setItem('cr-sort', e.target.value);
    $('#lib').innerHTML = [...videos].sort(sorters[e.target.value]).map(videoCard).join('');
  });
}

// ---------- Search ----------
async function renderSearch(q, photoId) {
  const data = await api(`/api/search?q=${encodeURIComponent(q)}&${U()}`);
  let photo = null;
  try { photo = JSON.parse(sessionStorage.getItem('cr-photo') || 'null'); } catch {}
  if (!photoId || !photo || photo.uploadId !== photoId) photo = null;
  const u = state.info.user;
  const cost = state.info.cost.video;
  const offline = state.info.mode === 'offline';
  const rs = data.results;
  if (data.blocked) {
    app.innerHTML = `
    <form class="searchbar" id="search-form" style="margin:0 0 6px;max-width:none">
      <input id="q" value="" placeholder="Try another concept" aria-label="Search for a concept" /><button class="btn">Search</button>
    </form>
    <div class="banner warn">🛡️ ${esc(data.blocked)}</div>`;
    $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); const nq = $('#q').value.trim(); if (nq) location.hash = `#/search?q=${encodeURIComponent(nq)}`; });
    return;
  }
  app.innerHTML = `
    <form class="searchbar" id="search-form" style="margin:0 0 6px;max-width:none">
      <input id="q" value="${esc(q)}" aria-label="Search for a concept" /><button class="btn">Search</button>
    </form>
    ${photo ? `<div class="photo-card">
      <img src="${esc(photo.imageUrl)}" alt="Your photo" />
      <div>
        <div class="hint">From ${esc(KIND_LABEL[photo.kind] || 'your photo')}${photo.mode === 'offline' ? ' (read with offline text recognition)' : ''}, we found the concept:</div>
        <div class="photo-topic">${esc(photo.topic)}</div>
        <details><summary>What we read</summary><div class="photo-text">${esc(photo.text)}</div></details>
        ${(photo.notices || []).map((n) => `<div class="banner warn" style="margin:8px 0 0">🛡️ ${esc(n)}</div>`).join('')}
      </div>
    </div>` : ''}
    <div class="results-head"><h2>${rs.length ? `Closest videos for “${esc(q)}”` : `No saved videos for “${esc(q)}” yet`}</h2></div>
    ${data.hiddenForOlderGrades ? `<div class="hint" style="margin:4px 0">🔒 ${data.hiddenForOlderGrades} video${data.hiddenForOlderGrades === 1 ? ' is' : 's are'} made for older grades, so ${data.hiddenForOlderGrades === 1 ? "it's" : "they're"} hidden. A new video will be written for grades ${esc(data.gradeBand)}.</div>` : ''}
    ${(data.queryConcepts || []).length ? `<div class="qconcepts">Concepts in your question: ${data.queryConcepts.map((c) => `<span class="cchip">${esc(c)}</span>`).join('')}</div>` : ''}
    ${rs.length ? `<p class="sub" style="margin-top:6px">Ranked by fusing ${data.fusion.weights.grade ? 'four' : 'three'} rankings with RRF (k = ${data.fusion.k}): meaning (sentence embeddings), concept-graph match (knowledge graph from each video's transcript), how much the video helped other learners${data.fusion.weights.grade ? `, and fit for your grade band (${esc(data.gradeBand)})` : ''}.</p>` : ''}
    ${rs.length ? (data.strongMatch
      ? `<div class="banner ok">✅ Other learners already made videos for this concept. Watching one is <b>free</b>, no tokens needed.</div>`
      : `<div class="banner info">We couldn't find an exact match, but these are the closest saved videos. Watch one free, or generate a brand-new one below.</div>`)
      : `<div class="banner info">Be the first to create a video for this concept. Once you do, everyone else can watch it free.</div>`}
    <div id="results">${rs.map((v, i) => `
      <div class="result" data-go="${v.id}">
        ${thumb(v)}
        <div>
          <div class="rank-no">#${i + 1} · <span class="match" title="Embedding similarity">Meaning ${v.meaning}%</span> · <span class="match" title="Knowledge-graph match">Concept graph ${v.graph}%</span> · ${qPill(v.quality)}</div>
          <div class="vtitle">${esc(v.title)}</div>
          <div class="why">${esc(v.summary)}</div>
          ${v.matched && v.matched.length ? `<div class="matched">Shared concepts: ${v.matched.map(([a, b]) => `<span class="cchip">${esc(a === b ? a : `${a} ≈ ${b}`)}</span>`).join('')}</div>` : ''}
          <div class="vmeta" style="margin-top:4px"><span>${esc(v.subject)} · Grades ${esc(v.gradeBand)}</span>${IN_VIDEO_CHECKPOINTS && v.checkpoints ? `<span>✅ ${v.checkpoints} checkpoint${v.checkpoints === 1 ? '' : 's'}</span>` : ''}<span>${v.stats.views} views</span><span>${v.quality.breakdown.quiz}% quiz accuracy</span><span>${v.quality.breakdown.completion}% finish it</span></div>
        </div>
        <div class="go"><button class="btn soft">Watch · <span class="free">free</span></button></div>
      </div>`).join('')}
    </div>
    <div class="gen-panel">
      <h3>${photo ? (rs.length ? 'None of these fit? Make a video from your photo' : 'Make a video from your photo') : rs.length ? 'None of these fit? Generate a new video' : 'Generate a video for this concept'}</h3>
      <div class="hint">Costs <b>${cost} tokens</b> (you have ${u.balance}). Your video joins the shared library so the next learner gets it free.</div>
      <input id="g-topic" value="${esc(q)}" placeholder="Concept" />
      ${photo ? `<div class="hint">Text from your photo (fix anything we misread):</div>` : ''}
      <textarea id="g-src" placeholder="${offline ? 'Paste the paragraph from your textbook or notes, or add a photo (needed in offline demo mode)' : 'Optional: paste the paragraph from your textbook or notes so the video follows it'}">${photo ? esc(photo.text) : ''}</textarea>
      <div class="gen-row">
        <button class="btn" id="g-btn" ${u.balance < cost ? 'disabled' : ''}>${photo ? 'Make video from photo' : 'Generate new video'} · ${cost} tokens</button>
        ${photo ? '' : '<button class="btn ghost" id="g-photo" type="button">📷 Use a photo instead</button>'}
        <span class="hint">${u.balance < cost ? 'Not enough tokens this week. Saved videos are still free.' : offline ? (photo ? 'Offline mode: builds the video from the text in your photo.' : 'Offline mode: builds the video from your pasted text or photo. Add an API key to generate from the topic alone.') : 'Generated with Claude.'}</span>
      </div>
    </div>`;
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/search?q=${encodeURIComponent($('#q').value.trim())}`; });
  $('#g-btn').addEventListener('click', async () => {
    const topic = $('#g-topic').value.trim();
    const sourceText = $('#g-src').value.trim();
    modal(`<div class="spinner"></div><h3>Creating your video…</h3><p class="hint">Writing the storyboard, narration and a quick check-in quiz.</p>`);
    try {
      const r = await api('/api/generate', { body: { topic, sourceText, uploadId: photo ? photo.uploadId : undefined } });
      renderTokens(r.user);
      modal();
      toast(`New video created for ${cost} tokens. It's now in the shared library.`);
      location.hash = `#/watch/${r.video.id}`;
    } catch (e) {
      modal();
      showError(e);
    }
  });
  if ($('#g-photo')) $('#g-photo').addEventListener('click', photoPicker);
  bindGo();
}

// ---------- Concept map (knowledge graph) ----------
function conceptMapSvg(cm) {
  const W = 296, H = 250, cx = W / 2, cy = H / 2 + 4;
  const nodes = cm.nodes.slice(0, 10);
  const pos = {};
  nodes.forEach((n, i) => {
    if (i === 0) { pos[n] = [cx, cy]; return; } // most central concept in the middle
    const a = ((i - 1) / (nodes.length - 1)) * Math.PI * 2 - Math.PI / 2;
    pos[n] = [cx + Math.cos(a) * 96, cy + Math.sin(a) * 94];
  });
  const edges = cm.edges.filter((e) => pos[e.s] && pos[e.o]);
  const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  return `<svg class="cmap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Concept map">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#b9b2dc"/></marker></defs>
    ${edges.map((e) => {
      const [x1, y1] = pos[e.s], [x2, y2] = pos[e.o];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const k = 0.82, ex = x1 + (x2 - x1) * k, ey = y1 + (y2 - y1) * k;
      if (e.r === 'related to') return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e2ddf5" stroke-width="1" stroke-dasharray="3 3"><title>${esc(e.s)} and ${esc(e.o)} appear together</title></line>`;
      return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="#bdb4e6" stroke-width="1.4" marker-end="url(#arr)"><title>${esc(e.s)} → ${esc(e.r)} → ${esc(e.o)}</title></line>${e.r !== 'is a' ? `<text x="${mx}" y="${my - 2}" class="elabel">${esc(trunc(e.r, 14))}</text>` : ''}`;
    }).join('')}
    ${nodes.map((n, i) => { const [x, y] = pos[n]; const t = trunc(n, 14); const w = t.length * 6.2 + 14; return `<g><rect x="${x - w / 2}" y="${y - 11}" width="${w}" height="22" rx="11" class="${i === 0 ? 'cnode main' : 'cnode'}"/><text x="${x}" y="${y + 4}" class="nlabel">${esc(t)}</text></g>`; }).join('')}
  </svg>`;
}

// ---------- Player ----------
let player = null;
function stopPlayer() {
  if (!player) return;
  player.playing = false;
  cancelAnimationFrame(player.raf);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  player = null;
}

function renderVisual(v) {
  const stagger = (i, base = 0.25) => `style="animation-delay:${(i * base + 0.2).toFixed(2)}s"`;
  switch (v.kind) {
    case 'title': return `<div class="v-title">${esc(v.emoji || '💡')}<small>${esc(v.caption || '')}</small></div>`;
    case 'icons': return `<div class="v-icons">${(v.items || []).map((it, i) => `<div class="it" ${stagger(i, 0.6)}><div class="e">${esc(it.e)}</div><div class="t">${esc(it.t)}</div></div>`).join('')}</div>`;
    case 'flow': return `<div class="v-flow">${(v.steps || []).map((s, i) => `${i ? `<span class="arrow" ${stagger(i, 0.8)}>→</span>` : ''}<span class="step" ${stagger(i, 0.8)}>${esc(s)}</span>`).join('')}</div>`;
    case 'equation': return `<div class="v-eq"><div class="f">${esc(v.text)}</div>${v.note ? `<div class="n">${esc(v.note)}</div>` : ''}</div>`;
    case 'compare': return `<div class="v-cmp">${[v.left, v.right].filter(Boolean).map((c, ci) => `<div class="col" ${stagger(ci, 1)}><h4>${esc(c.h)}</h4>${(c.items || []).map((x, i) => `<div ${stagger(ci * 2 + i, 0.4)}>• ${esc(x)}</div>`).join('')}</div>`).join('')}</div>`;
    case 'timeline': return `<div class="v-tl">${(v.events || []).map((e, i) => `<div class="ev" ${stagger(i, 0.7)}><div class="dot"></div><div class="y">${esc(e.y)}</div><div class="t">${esc(e.t)}</div></div>`).join('')}</div>`;
    default: return `<div class="v-kw">${(v.words || []).map((w, i) => `<span ${stagger(i, 0.35)}>${esc(w)}</span>`).join('')}</div>`;
  }
}

async function renderWatch(id) {
  stopPlayer();
  const data = await api(`/api/videos/${id}?${U()}`);
  const v = data.video;
  const durs = v.sceneSeconds;
  const starts = durs.reduce((a, d, i) => (a.push(i ? a[i - 1] + durs[i - 1] : 0), a), []);
  const total = durs.reduce((a, b) => a + b, 0);
  const confused = v.stats.confusedScenes || {};
  const maxConf = Math.max(1, ...Object.values(confused));

  const u0 = state.info.user;
  const userBand = u0.gradeBand || '';
  const refresher = userBand && v.gradeBand && v.gradeBand !== userBand && v.gradeBand < userBand ? ` refresher for Grade ${esc(u0.grade)}` : '';
  const nCp = IN_VIDEO_CHECKPOINTS ? v.scenes.filter((s) => s.checkpoint).length : 0;
  // One question set, used for the warm-up before the video and the quiz after it.
  const QS = (v.quiz || []).length ? v.quiz : v.scenes.filter((s) => s.checkpoint).map((s) => s.checkpoint);
  const savedKey = `cr-saved-${state.user}`;
  const isSaved = () => (JSON.parse(localStorage.getItem(savedKey) || '[]')).includes(id);
  const short = (h) => (h.length > 16 ? h.split(/[\s:,]+/).slice(0, 2).join(' ') : h);
  const ideas = (v.conceptMap?.edges || []).filter((e) => e.r !== 'related to' && e.r !== 'is a').slice(0, 3);
  app.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Explore</a> / ${data.parent ? `<a href="#/watch/${data.parent.id}">${esc(data.parent.title)}</a> / <span aria-current="page">Deep dive</span>` : `<span>${esc(v.subject)}</span> / <span aria-current="page">${esc(v.title)}</span>`}</nav>
    <div class="lesson-head">
      <div>
        <h1>${esc(v.title)}</h1>
        <div class="lesson-meta">${esc(v.subject)} · Grades ${esc(gradeRange(v.gradeBand))}${refresher} · ${Math.round(total)} seconds${nCp ? ` · ${nCp} checkpoint${nCp === 1 ? '' : 's'}` : ''}</div>
      </div>
      <div class="lesson-actions">${mascot('small')}<button class="btn lime" id="save-btn" aria-pressed="${isSaved()}">${isSaved() ? 'Saved ✓' : 'Save lesson'}</button></div>
    </div>
    <div class="watch">
      <div class="watch-main">
        <div id="pre-slot"></div>
        <section class="player" aria-label="Lesson video">
          <div class="stage" id="stage">
            <div class="scene-num" id="scene-num"></div>
            <div class="heading" id="heading" aria-live="polite"></div>
            <div class="visual" id="visual"></div>
            <div class="caption" id="caption"></div>
            <div class="overlay" id="overlay"><button class="playbig" id="playbig" aria-label="Play lesson">▶</button></div>
            <div class="checkpoint" id="cp" role="dialog" aria-label="Checkpoint question" hidden></div>
          </div>
          <div class="timeline" id="timeline" role="slider" tabindex="0" aria-label="Lesson position" aria-valuemin="0" aria-valuemax="${Math.round(total)}" aria-valuenow="0" aria-valuetext="0:00 of ${fmt(total)}">
            <div class="segs">${durs.map((d, i) => `<div class="seg" style="flex:${d}" title="${esc(v.scenes[i].heading)}"><div class="heat" style="opacity:${((confused[i] || 0) / maxConf) * 0.85}"></div></div>`).join('')}</div>
            <div class="played" id="played"></div>
            <div class="sel" id="sel" hidden></div>
            <div class="head" id="head"></div>
          </div>
          <div class="controls">
            <button class="ctl" id="pp" aria-label="Play">▶ Play</button>
            <span class="time" id="time">0:00 / ${fmt(total)}</span>
            <button class="ctl" id="cc" aria-pressed="true">CC on</button>
            <button class="ctl" id="speed" aria-label="Playback speed 1×">Speed 1×</button>
            <button class="ctl" id="mute" aria-pressed="true">🔊 Sound on</button>
            <button class="ctl" id="fs">Full screen</button>
          </div>
        </section>
        <div class="tl-legend"><span>Drag across the bar to select the part you didn't get.</span><span><i></i>where other learners got stuck</span></div>
        <section class="card jump" aria-labelledby="jump-h">
          <h2 id="jump-h">Jump to a scene</h2>
          <div class="jump-row">${v.scenes.map((s, i) => `<button class="jbtn" data-jump="${i}">${i + 1} · ${esc(short(s.heading))} <span>${fmt(starts[i])}</span></button>`).join('')}</div>
        </section>
        <section class="explain-box" id="explain-box" aria-labelledby="ex-h">
          <h2 id="ex-h">A tricky part? Let’s work through it.</h2>
          <p class="hint">Choose a time range. You can use these fields instead of dragging. <span class="ex-now">Now: <b id="ex-label">this part</b></span></p>
          <div class="ex-fields">
            <label>From<input id="ex-from" inputmode="numeric" value="0:00" /></label>
            <label>To<input id="ex-to" inputmode="numeric" value="0:00" /></label>
            ${data.freeTextQuestions ? '<label class="grow">What confused you? (optional)<input id="ex-q" placeholder="e.g. Which part is the hardest?" /></label>' : '<input id="ex-q" type="hidden" value="" />'}
          </div>
          <div class="ex-row">
            <button class="btn primary" id="ex-btn">Explain this part · ${state.info.cost.explainer} tokens</button>
            <span class="ex-cost" id="ex-cost" aria-live="polite"></span>
          </div>
          <p class="hint" id="ex-hint">Your explanation joins the library so other learners can use it too.</p>
        </section>
        ${data.canGoDeeper ? '' : `<div class="banner info">🧭 ${v.depth ? "You've gone as deep as this lesson goes! Want to try a related topic?" : ''}</div>`}
        <div class="alt-row">
          <button class="btn outline wide" id="tr-btn" aria-expanded="false" aria-controls="transcript">Read transcript</button>
          <button class="btn outline wide" id="ad-btn" aria-pressed="false">Audio description</button>
          <span class="hint">Learn your way. Pause or replay anytime.</span>
        </div>
        <section class="card transcript" id="transcript" hidden aria-label="Transcript">
          ${v.scenes.map((s, i) => `<p><b>${fmt(starts[i])} · ${esc(s.heading)}.</b> ${esc(s.narration)}</p>`).join('')}
        </section>
        <div id="quiz-slot"></div>
        <div class="lesson-foot">
          <div><div>${v.stats.views} views · Made by ${v.createdBy === 'community' ? 'the community' : esc(v.createdBy)}</div><div class="hint">${state.info.cost.video} tokens saved by reusing this lesson</div></div>
          <div class="reactions">
            <button class="btn outline" id="like" aria-pressed="false">Helpful · <span>${v.stats.likes}</span></button>
            <button class="btn outline" id="dislike" aria-pressed="false">Not helpful · <span>${v.stats.dislikes}</span></button>
          </div>
        </div>
      </div>
      <aside class="side" aria-label="About this lesson">
        <section class="panel">
          <h2>Your learning path</h2>
          <p class="hint">One idea. ${['', 'One small step', 'Two small steps', 'Three small steps', 'Four small steps', 'Five small steps', 'Six small steps'][v.scenes.length] || `${v.scenes.length} small steps`}.</p>
          <ol class="path" id="path">${v.scenes.map((s, i) => `<li><button data-jump="${i}"><span class="pn">${String(i + 1).padStart(2, '0')}</span><span><span class="pt">${esc(s.heading)}</span><span class="pm" data-pm="${i}">${fmt(starts[i])}–${fmt(starts[i] + durs[i])}</span></span></button></li>`).join('')}</ol>
        </section>
        ${v.sourceImage ? `<section class="panel"><h2>Made from a learner's photo</h2><a href="${esc(v.sourceImage)}" target="_blank" rel="noopener"><img class="src-img" src="${esc(v.sourceImage)}" alt="The photo this video was made from" /></a></section>` : ''}
        ${v.conceptMap && v.conceptMap.nodes.length >= 3 ? `<section class="panel mint">
          <h2>Connect the ideas</h2>
          <p class="hint">A text-first concept map</p>
          ${ideas.length ? `<ul class="ideas">${ideas.map((e) => `<li><b>${esc(e.s)}</b> ${esc(e.r)} <b>${esc(e.o)}</b>.</li>`).join('')}</ul>` : ''}
          <p class="ideas-key">Key ideas: ${v.conceptMap.nodes.slice(0, 6).map(esc).join(', ')}.</p>
          <details><summary>Show as a map</summary>${conceptMapSvg(v.conceptMap)}</details>
        </section>` : ''}
        <section class="panel">
          <h2>How this helped learners</h2>
          <p class="score">${v.quality.confident ? `Helpfulness score: ${v.quality.score} / 100` : 'New lesson: the score firms up as learners watch and answer.'}</p>
          <dl class="breakdown">
            ${[['Quiz accuracy', v.quality.breakdown.quiz], ['Finish rate', v.quality.breakdown.completion], ['Liked', v.quality.breakdown.likes], ['Clarity', v.quality.breakdown.clarity]]
              .map(([k, n]) => `<dt>${k}</dt><dd>${n}</dd>`).join('')}
          </dl>
        </section>
        <section class="panel">
          <h2>More explanations</h2>
          ${data.explainers.length ? data.explainers.map((x) => `<a class="mini" href="#/watch/${x.id}">${thumb(x)}<span><span class="t">${esc(v.scenes[x.parentScene]?.heading || x.title)}</span><span class="m">Deep dive at ${fmt(starts[x.parentScene] || 0)} · ${x.stats.views} views</span></span></a>`).join('') : '<p class="empty">No deep dives yet. Yours could help someone!</p>'}
          ${data.alternatives.length ? data.alternatives.map((x) => `<a class="mini" href="#/watch/${x.id}">${thumb(x)}<span><span class="t">${esc(x.title)}</span><span class="m">Helpfulness ${x.quality.score}/100 · ${fmt(x.duration)}</span></span></a>`).join('') : '<p class="empty">This is the only version so far.</p>'}
        </section>
      </aside>
    </div>`;
  bindGo();
  $('#save-btn').addEventListener('click', () => {
    const list = JSON.parse(localStorage.getItem(savedKey) || '[]');
    const next = isSaved() ? list.filter((x) => x !== id) : [...list, id];
    localStorage.setItem(savedKey, JSON.stringify(next));
    $('#save-btn').textContent = isSaved() ? 'Saved ✓' : 'Save lesson';
    $('#save-btn').setAttribute('aria-pressed', isSaved());
    toast(isSaved() ? 'Lesson saved.' : 'Removed from saved lessons.');
  });
  $('#tr-btn').addEventListener('click', () => {
    const t = $('#transcript'); t.hidden = !t.hidden;
    $('#tr-btn').setAttribute('aria-expanded', !t.hidden);
    $('#tr-btn').textContent = t.hidden ? 'Read transcript' : 'Hide transcript';
  });

  api(`/api/videos/${id}/event`, { body: { type: 'view' } }).then((r) => renderTokens(r.user)).catch(() => {});

  const p = (player = { t: 0, playing: false, scene: -1, muted: localStorage.getItem('cr-muted') === '1', sel: null, completed: false, last: 0, speaking: false, cpDone: {}, speed: 1, cc: true, ad: false });
  const setMute = () => { $('#mute').textContent = p.muted ? '🔇 Sound off' : '🔊 Sound on'; $('#mute').setAttribute('aria-pressed', String(!p.muted)); };
  setMute();
  // Audio description: also read out what is on screen.
  const describe = (vis) => {
    if (!vis) return '';
    if (vis.kind === 'icons') return `On screen: ${(vis.items || []).map((x) => x.t).join(', ')}.`;
    if (vis.kind === 'flow') return `On screen, a flow: ${(vis.steps || []).join(', then ')}.`;
    if (vis.kind === 'equation') return `On screen, the equation ${vis.text}.`;
    if (vis.kind === 'compare') return `On screen, a comparison of ${vis.left?.h || ''} and ${vis.right?.h || ''}.`;
    if (vis.kind === 'timeline') return `On screen, a timeline: ${(vis.events || []).map((e) => `${e.y}, ${e.t}`).join('; ')}.`;
    if (vis.kind === 'keywords') return `On screen: ${(vis.words || []).join(', ')}.`;
    return vis.caption ? `On screen: ${vis.caption}.` : '';
  };

  const tl = $('#timeline');
  const sceneAt = (t) => { let i = 0; while (i < starts.length - 1 && t >= starts[i + 1]) i++; return i; };
  function speak(text) {
    if (p.muted || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.0 * p.speed;
    u.volume = 1;
    const voices = synth.getVoices();
    const voice = voices.find((vv) => /^en/i.test(vv.lang) && /Google|Natural|Samantha|Daniel|Aria|Jenny/i.test(vv.name)) || voices.find((vv) => /^en/i.test(vv.lang));
    if (voice) u.voice = voice;
    p.speaking = true;
    const token = (p.speakToken = (p.speakToken || 0) + 1);
    u.onend = u.onerror = () => { if (p.speakToken === token) p.speaking = false; };
    // Chrome drops an utterance queued in the same tick as cancel(), and can stay paused after a tab switch.
    setTimeout(() => { if (p.speakToken !== token || p.muted) return; synth.resume(); synth.speak(u); }, 60);
    // Safety net: never hold the video forever if the browser never reports the end of speech.
    setTimeout(() => { if (p.speakToken === token) p.speaking = false; }, Math.max(4000, text.length * 90 / p.speed));
  }
  function showScene(i, narrate) {
    p.scene = i;
    const s = v.scenes[i];
    $('#scene-num').textContent = `Scene ${i + 1} of ${v.scenes.length}`;
    $('#heading').textContent = s.heading;
    $('#heading').style.animation = 'none'; void $('#heading').offsetWidth; $('#heading').style.animation = '';
    $('#visual').innerHTML = renderVisual(s.visual);
    $('#caption').textContent = s.narration;
    if (!p.sel) setSelection(starts[i], starts[i] + durs[i], false);
    if (narrate) speak(p.ad ? `${describe(s.visual)} ${s.narration}` : s.narration);
    document.querySelectorAll('#path li').forEach((li, k) => {
      li.classList.toggle('now', k === i);
      const pm = li.querySelector('.pm');
      pm.textContent = `${k === i ? 'Now · ' : k === i + 1 ? 'Next · ' : ''}${fmt(starts[k])}–${fmt(starts[k] + durs[k])}`;
      li.querySelector('button').setAttribute('aria-current', k === i ? 'step' : 'false');
    });
    document.querySelectorAll('.jbtn').forEach((b, k) => b.classList.toggle('on', k === i));
  }
  function draw() {
    const pct = (p.t / total) * 100;
    $('#played').style.width = `${pct}%`;
    $('#head').style.left = `calc(${pct}% - 1px)`;
    $('#time').textContent = `${fmt(p.t)} / ${fmt(total)}`;
    tl.setAttribute('aria-valuenow', Math.round(p.t));
    tl.setAttribute('aria-valuetext', `${fmt(p.t)} of ${fmt(total)}, scene ${sceneAt(p.t) + 1}`);
  }
  function tick(now) {
    if (!p.playing) return;
    const dt = Math.min(0.25, (now - p.last) / 1000) * p.speed;
    p.last = now;
    const i = sceneAt(p.t);
    const end = starts[i] + durs[i];
    // Hold at the end of a scene until narration finishes so voice and visuals stay in sync.
    if (p.t + dt >= end && p.speaking && i < v.scenes.length) p.t = Math.max(p.t, end - 0.05);
    else p.t += dt;
    if (p.t >= total) {
      const last = v.scenes.length - 1;
      if (IN_VIDEO_CHECKPOINTS && v.scenes[last].checkpoint && !p.cpDone[last]) { p.t = total - 0.01; draw(); return checkpoint(last); }
      p.t = total; draw(); return finish();
    }
    const ni = sceneAt(p.t);
    if (IN_VIDEO_CHECKPOINTS && ni !== p.scene && v.scenes[p.scene] && v.scenes[p.scene].checkpoint && !p.cpDone[p.scene] && ni === p.scene + 1) {
      p.t = starts[ni] - 0.01; draw(); return checkpoint(p.scene);
    }
    if (ni !== p.scene) showScene(ni, true);
    draw();
    p.raf = requestAnimationFrame(tick);
  }
  function play() {
    if (p.t >= total) p.t = 0;
    if (p.muted) toast('Narration is off. Tap “🔇 Sound off” to turn it on.');
    p.playing = true;
    $('#overlay').hidden = true;
    $('#pp').textContent = '❚❚ Pause'; $('#pp').setAttribute('aria-label', 'Pause');
    const i = sceneAt(p.t);
    p.t = starts[i]; // resume from the start of the scene so narration lines up
    showScene(i, true);
    p.last = performance.now();
    p.raf = requestAnimationFrame(tick);
  }
  function pause() {
    p.playing = false;
    cancelAnimationFrame(p.raf);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    p.speaking = false;
    $('#pp').textContent = '▶ Play'; $('#pp').setAttribute('aria-label', 'Play');
  }
  function finish() {
    pause();
    if (!p.completed) {
      p.completed = true;
      api(`/api/videos/${id}/event`, { body: { type: 'complete' } }).catch(() => {});
      renderQuiz();
    }
    $('#overlay').hidden = false;
    $('#playbig').textContent = '↻';
  }
  function seek(t, narrate) {
    p.t = Math.max(0, Math.min(total - 0.01, t));
    const i = sceneAt(p.t);
    if (p.playing) { p.t = starts[i]; showScene(i, narrate); } else showScene(i, false);
    draw();
  }

  // Selecting a span on the timeline
  function setSelection(a, b, user = true) {
    const lo = Math.max(0, Math.min(a, b)), hi = Math.min(total, Math.max(a, b));
    const first = sceneAt(lo), last = sceneAt(Math.max(lo, hi - 0.01));
    // Pick the scene with the biggest overlap with the selection.
    let best = first, bestOverlap = -1;
    for (let i = first; i <= last; i++) {
      const ov = Math.min(hi, starts[i] + durs[i]) - Math.max(lo, starts[i]);
      if (ov > bestOverlap) { bestOverlap = ov; best = i; }
    }
    if (user) p.sel = { lo, hi, scene: best };
    const sel = $('#sel');
    sel.hidden = !user;
    sel.style.left = `${(lo / total) * 100}%`;
    sel.style.width = `${Math.max(0.8, ((hi - lo) / total) * 100)}%`;
    const existing = data.explainers.find((x) => x.parentScene === best);
    $('#ex-label').textContent = `${fmt(lo)}–${fmt(hi)} (“${v.scenes[best].heading}”)`;
    $('#ex-label').dataset.scene = best;
    if (document.activeElement !== $('#ex-from')) $('#ex-from').value = fmt(lo);
    if (document.activeElement !== $('#ex-to')) $('#ex-to').value = fmt(hi);
    const bal = state.info.user.balance, cost = state.info.cost.explainer;
    $('#ex-cost').textContent = existing ? `Free · ${bal} tokens available` : `${bal} tokens available · ${Math.max(0, bal - cost)} after this request`;
    $('#ex-btn').textContent = existing ? 'Watch the deep dive · free' : `Explain this part · ${state.info.cost.explainer} tokens`;
    $('#ex-hint').textContent = existing
      ? `${existing.stats.views || 'Other'} learner${existing.stats.views === 1 ? '' : 's'} already asked about this part, so it's free.`
      : "Nobody has asked about this part yet. You'll get a bespoke deep dive that joins the library for others.";
  }
  const tAt = (e) => { const r = tl.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * total; };
  let dragStart = null;
  tl.addEventListener('pointerdown', (e) => { dragStart = tAt(e); tl.setPointerCapture(e.pointerId); });
  tl.addEventListener('pointermove', (e) => { if (dragStart != null && Math.abs(tAt(e) - dragStart) > total * 0.01) setSelection(dragStart, tAt(e)); });
  tl.addEventListener('pointerup', (e) => {
    const end = tAt(e);
    if (dragStart != null && Math.abs(end - dragStart) <= total * 0.01) { p.sel = null; $('#sel').hidden = true; seek(end, true); }
    dragStart = null;
  });

  $('#pp').addEventListener('click', () => (p.playing ? pause() : needWarmup() || play()));
  $('#playbig').addEventListener('click', () => { if (needWarmup()) return; if (p.t >= total) p.t = 0; play(); });
  $('#mute').addEventListener('click', () => {
    p.muted = !p.muted;
    localStorage.setItem('cr-muted', p.muted ? '1' : '0');
    setMute();
    if (!p.muted && p.playing) speak(v.scenes[p.scene].narration);
    if (p.muted && 'speechSynthesis' in window) { speechSynthesis.cancel(); p.speaking = false; }
  });

  async function react(type) {
    const r = await api(`/api/videos/${id}/event`, { body: { type } });
    $('#like span').textContent = r.stats.likes;
    $('#dislike span').textContent = r.stats.dislikes;
    $('#like').classList.toggle('on', r.reaction === 'like');
    $('#dislike').classList.toggle('on', r.reaction === 'dislike');
    $('#like').setAttribute('aria-pressed', String(r.reaction === 'like'));
    $('#dislike').setAttribute('aria-pressed', String(r.reaction === 'dislike'));
  }
  $('#like').addEventListener('click', () => react('like'));
  $('#cc').addEventListener('click', () => {
    p.cc = !p.cc; $('#caption').hidden = !p.cc;
    $('#cc').textContent = p.cc ? 'CC on' : 'CC off'; $('#cc').setAttribute('aria-pressed', String(p.cc));
  });
  const SPEEDS = [1, 1.25, 1.5, 0.75];
  $('#speed').addEventListener('click', () => {
    p.speed = SPEEDS[(SPEEDS.indexOf(p.speed) + 1) % SPEEDS.length];
    $('#speed').textContent = `Speed ${p.speed}×`; $('#speed').setAttribute('aria-label', `Playback speed ${p.speed}×`);
  });
  $('#fs').addEventListener('click', () => {
    const el = $('.player');
    if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
  });
  $('#ad-btn').addEventListener('click', () => {
    p.ad = !p.ad; $('#ad-btn').setAttribute('aria-pressed', String(p.ad));
    $('#ad-btn').textContent = p.ad ? 'Audio description on' : 'Audio description';
    toast(p.ad ? 'Audio description on: narration also describes what is on screen.' : 'Audio description off.');
  });
  document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
    const k = Number(b.dataset.jump); p.sel = null; $('#sel').hidden = true;
    if (p.playing) { p.t = starts[k]; showScene(k, true); draw(); } else seek(starts[k], false);
  }));
  const parseT = (str) => { const m = String(str).trim().match(/^(\d+)(?::(\d{1,2}))?$/); return m ? (m[2] != null ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1])) : null; };
  ['#ex-from', '#ex-to'].forEach((sel) => $(sel).addEventListener('change', () => {
    const a = parseT($('#ex-from').value), b = parseT($('#ex-to').value);
    if (a == null || b == null || a === b) { toast('Use minutes:seconds, like 0:10, and make “To” later than “From”.'); return; }
    setSelection(a, b, true);
  }));
  tl.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
    if (step) { e.preventDefault(); seek(p.t + step, p.playing); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0, p.playing); }
    else if (e.key === 'End') { e.preventDefault(); seek(total - 0.5, p.playing); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); p.playing ? pause() : play(); }
  });
  $('#dislike').addEventListener('click', () => react('dislike'));

  $('#ex-btn').addEventListener('click', async () => {
    const scene = Number($('#ex-label').dataset.scene ?? sceneAt(p.t));
    pause();
    const existing = data.explainers.find((x) => x.parentScene === scene);
    if (!existing) modal(`<div class="spinner"></div><h3>Making a deep dive…</h3><p class="hint">Slowing down “${esc(v.scenes[scene].heading)}” into smaller steps with a fresh example.</p>`);
    try {
      const r = await api(`/api/videos/${id}/explain`, { body: { sceneIndex: scene, question: $('#ex-q').value } });
      renderTokens(r.user);
      modal();
      toast(r.reused ? 'Another learner already asked about this part. Their deep dive is free for you.' : `Your bespoke deep dive is ready (${state.info.cost.explainer} tokens). It's saved for the next learner too.`);
      location.hash = `#/watch/${r.video.id}`;
    } catch (e) {
      modal();
      showError(e);
    }
  });

  // Checkpoint: pause after a key scene and check understanding. Hint first, the answer only after a second miss.
  function checkpoint(i) {
    pause();
    const c = v.scenes[i].checkpoint;
    const box = $('#cp');
    let misses = 0, sent = false;
    const send = (correct) => { if (!sent) { sent = true; api(`/api/videos/${id}/event`, { body: { type: 'checkpoint', scene: i, correct } }).catch(() => {}); } };
    box.innerHTML = `<div class="cp-card"><div class="cp-tag">✅ Checkpoint · scene ${i + 1}</div><div class="cp-q">${esc(c.q)}</div>
      <div class="cp-opts">${c.options.map((o, k) => `<button class="cp-opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>
      <div class="cp-fb" id="cp-fb"></div><div class="cp-actions" id="cp-actions"></div></div>`;
    box.hidden = false;
    if (!p.muted) speak(c.q);
    const done = (html) => {
      box.querySelectorAll('.cp-opt').forEach((b) => (b.disabled = true));
      $('#cp-actions').innerHTML = html;
      $('#cp-continue').addEventListener('click', () => {
        box.hidden = true; p.cpDone[i] = true;
        if (i === v.scenes.length - 1) { p.t = total; draw(); finish(); } else { p.t = starts[i + 1]; play(); }
      });
      const rw = $('#cp-rewatch');
      if (rw) rw.addEventListener('click', () => { box.hidden = true; p.t = starts[i]; play(); });
      const ex = $('#cp-explain');
      if (ex) ex.addEventListener('click', () => { box.hidden = true; p.cpDone[i] = true; setSelection(starts[i], starts[i] + durs[i], true); $('#explain-box').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#explain-box').classList.add('pulse'); });
    };
    box.querySelectorAll('.cp-opt').forEach((b) => b.addEventListener('click', () => {
      const k = Number(b.dataset.k);
      if (k === c.answer) {
        b.classList.add('ok');
        $('#cp-fb').innerHTML = `🎉 ${esc(c.feedback_correct)}`;
        send(misses === 0);
        done('<button class="btn" id="cp-continue">Continue ▶</button>');
      } else if (++misses === 1) {
        b.classList.add('bad'); b.disabled = true;
        $('#cp-fb').innerHTML = `🤔 ${esc(c.feedback_incorrect)}<br><b>Hint:</b> ${esc(c.hint)}`;
      } else {
        b.classList.add('bad');
        box.querySelectorAll('.cp-opt')[c.answer].classList.add('ok');
        $('#cp-fb').innerHTML = `💡 ${esc(c.explanation)}`;
        send(false);
        done(`<button class="btn" id="cp-continue">Continue ▶</button><button class="btn ghost" id="cp-rewatch">↺ Rewatch this scene</button>${data.canGoDeeper ? '<button class="btn soft" id="cp-explain">🤔 Explain this part</button>' : ''}`);
      }
    }));
  }

  function renderQuiz() {
    const qs = QS;
    if (!qs.length) {
      $('#quiz-slot').innerHTML = `<div class="quiz"><h3>Done!</h3><p class="hint">${data.parent ? `<a href="#/watch/${data.parent.id}">Back to the full video</a>` : 'Was this helpful? Your 👍 / 👎 helps rank it for others.'}</p></div>`;
      return;
    }
    const pre = prepost && prepost.pre != null ? prepost : null;
    $('#quiz-slot').innerHTML = `<div class="quiz"><h3>${pre ? 'After: same questions. Did it click?' : 'Quick check: did it click?'}</h3><p class="hint" style="margin:0">${pre ? `Before the video you got ${pre.pre}/${pre.total}. Let’s see what changed.` : 'Your answers help rank this video for other learners.'}</p>
      ${qs.map((q, qi) => `<div class="q">${qi + 1}. ${esc(q.q)}</div>${q.options.map((o, oi) => `<label><input type="radio" name="q${qi}" value="${oi}"> ${esc(o)}</label>`).join('')}`).join('')}
      <div class="gen-row" style="margin-top:10px"><button class="btn" id="quiz-btn">Check answers</button><span id="quiz-res" class="hint"></span></div></div>`;
    $('#quiz-btn').addEventListener('click', async () => {
      let correct = 0;
      qs.forEach((q, qi) => {
        const pick = document.querySelector(`input[name=q${qi}]:checked`);
        document.querySelectorAll(`input[name=q${qi}]`).forEach((inp) => {
          const lab = inp.parentElement;
          if (Number(inp.value) === q.answer) lab.classList.add('right');
          else if (inp.checked) lab.classList.add('wrong');
        });
        if (pick && Number(pick.value) === q.answer) correct++;
      });
      $('#quiz-btn').disabled = true;
      $('#quiz-res').innerHTML = correct === qs.length ? `🎉 ${correct}/${qs.length}. Nailed it.` : `${correct}/${qs.length}. Select the part you missed on the timeline and tap “Explain this part”.`;
      api(`/api/videos/${id}/event`, { body: { type: 'quiz', correct, total: qs.length } }).then((r) => {
        if (r.prepost && r.prepost.post != null) { prepost = r.prepost; $('#quiz-res').insertAdjacentHTML('afterend', gainHtml(r.prepost)); }
      }).catch(() => {});
    });
  }

  // Before the video: the same quiz as a warm-up, so the learner (and we) can measure the change.
  let prepost = data.prepost || null;
  let warmupSkipped = false;
  function needWarmup() {
    if (!QS.length || (prepost && prepost.pre != null) || warmupSkipped || p.completed) return false;
    $('#pre-slot').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#pre-slot .prequiz')?.classList.add('pulse');
    const first = $('#pre-slot input'); if (first) first.focus({ preventScroll: true });
    toast('Take the 30-second warm-up first, or tap “Skip for now”.');
    return true;
  }
  function renderWarmup() {
    const qs = QS;
    if (!qs.length) return;
    if (prepost && prepost.pre != null) {
      $('#pre-slot').innerHTML = `<div class="prequiz done"><b>Your starting point:</b> ${prepost.pre}/${prepost.total} before watching${prepost.post != null ? ` · ${prepost.post}/${prepost.total} after` : '. Take the same quiz after the video to see your progress.'}</div>`;
      return;
    }
    $('#pre-slot').innerHTML = `<section class="prequiz" aria-labelledby="pre-h">
      <h2 id="pre-h">Before you watch: what do you already know?</h2>
      <p class="hint">${qs.length} quick question${qs.length === 1 ? '' : 's'}. No pressure and no tokens: you’ll answer the same ones after the video to see how much you learned.</p>
      ${qs.map((q, qi) => `<fieldset><legend>${qi + 1}. ${esc(q.q)}</legend>${q.options.map((o, oi) => `<label><input type="radio" name="pre${qi}" value="${oi}"> ${esc(o)}</label>`).join('')}<label><input type="radio" name="pre${qi}" value="-1"> I’m not sure yet</label></fieldset>`).join('')}
      <div class="gen-row"><button class="btn primary" id="pre-btn">Save my starting point</button><button class="btn outline" id="pre-skip">Skip for now</button></div>
    </section>`;
    $('#pre-btn').addEventListener('click', async () => {
      let correct = 0;
      qs.forEach((q, qi) => { const pick = document.querySelector(`input[name=pre${qi}]:checked`); if (pick && Number(pick.value) === q.answer) correct++; });
      const r = await api(`/api/videos/${id}/event`, { body: { type: 'prequiz', correct, total: qs.length } }).catch((e) => { showError(e); return null; });
      if (!r) return;
      prepost = r.prepost || { pre: correct, total: qs.length };
      renderWarmup();
      toast(`Starting point saved: ${prepost.pre}/${prepost.total}. We won’t show answers yet. Now watch!`);
      $('#playbig').focus();
    });
    $('#pre-skip').addEventListener('click', () => { warmupSkipped = true; $('#pre-slot').innerHTML = ''; $('#playbig').focus(); });
  }
  renderWarmup();

  showScene(0, false);
  draw();
}

// ---------- Before/after ----------
function gainHtml(pp) {
  const pct = (n) => Math.round((n / pp.total) * 100);
  const d = pct(pp.post) - pct(pp.pre);
  return `<div class="gain" role="status"><div class="gain-row"><span>Before</span><div class="gbar"><div style="width:${pct(pp.pre)}%"></div></div><b>${pp.pre}/${pp.total}</b></div>
    <div class="gain-row"><span>After</span><div class="gbar after"><div style="width:${pct(pp.post)}%"></div></div><b>${pp.post}/${pp.total}</b></div>
    <p class="gain-msg">${d > 0 ? `Your understanding grew by <b>${d} points</b>. 🎉` : d === 0 ? (pp.post === pp.total ? 'You already knew this, and you still do. 💪' : 'Same score as before. Try “Explain this part” on the bit that felt tricky.') : 'A bit lower than before. Rewatch the tricky scene or ask for a deep dive.'}</p></div>`;
}

// ---------- Profile ----------
async function renderProfile() {
  const d = await api(`/api/profile?${U()}`);
  const u = d.user;
  const saved = JSON.parse(localStorage.getItem(`cr-saved-${state.user}`) || '[]');
  const titles = Object.fromEntries(d.watched.map((w) => [w.id, w.title]));
  app.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Explore</a> / <span aria-current="page">My progress</span></nav>
    <div class="lesson-head"><div><h1>${esc(u.name)}’s progress</h1>
      <div class="lesson-meta">${u.grade ? (u.grade === 'K' ? 'Kindergarten' : `Grade ${esc(u.grade)}`) : 'No grade yet'} · ${u.balance}/${u.weekly} tokens left this week · ${u.saved} tokens saved by reusing</div></div>
      <div class="lesson-actions">${mascot('small')}</div></div>
    <section class="prof-stats" aria-label="Summary">
      <div class="pstat lime"><b>${d.avgGain == null ? '–' : `${d.avgGain > 0 ? '+' : ''}${d.avgGain}`}</b><span>average points gained, before → after</span></div>
      <div class="pstat"><b>${d.measured}</b><span>lessons measured before and after</span></div>
      <div class="pstat"><b>${d.watched.length}</b><span>lessons watched</span></div>
      <div class="pstat"><b>${d.prepost.length}</b><span>warm-ups taken before a lesson</span></div>
    </section>
    <div class="prof-grid">
      <section class="card">
        <h2>Understanding before and after</h2>
        ${d.prepost.length ? d.prepost.map((r) => `<div class="pp-row">
          <a href="#/watch/${r.id}" class="pp-title">${esc(r.title)}</a>
          ${r.post != null ? gainHtml(r) : `<p class="hint">Before: ${r.pre}/${r.total}. <a href="#/watch/${r.id}">Finish the video</a> and take the quiz again to see your progress.</p>`}
        </div>`).join('') : '<p class="empty">Nothing measured yet. Open any lesson, answer the warm-up before you watch, then the same quiz after.</p>'}
      </section>
      <aside>
        <section class="panel side-panel"><h2>Recently watched</h2>${d.watched.length ? `<ul class="plist">${d.watched.map((w) => `<li><a href="#/watch/${w.id}">${esc(w.title)}</a></li>`).join('')}</ul>` : '<p class="empty">None yet.</p>'}</section>
        <section class="panel side-panel"><h2>Saved lessons</h2>${saved.length ? `<ul class="plist">${saved.map((sid) => `<li><a href="#/watch/${sid}">${esc(titles[sid] || 'Saved lesson')}</a></li>`).join('')}</ul>` : '<p class="empty">Tap “Save lesson” on any lesson to keep it here.</p>'}</section>
        <section class="panel side-panel"><h2>Deep dives you asked for</h2>${d.deepDives.length ? `<ul class="plist">${d.deepDives.map((w) => `<li><a href="#/watch/${w.id}">${esc(w.title)}</a></li>`).join('')}</ul>` : '<p class="empty">None yet.</p>'}</section>
        ${d.made.length ? `<section class="panel side-panel"><h2>Lessons you made</h2><ul class="plist">${d.made.map((w) => `<li><a href="#/watch/${w.id}">${esc(w.title)}</a></li>`).join('')}</ul></section>` : ''}
      </aside>
    </div>`;
}

// ---------- router ----------
async function route() {
  stopPlayer();
  modal();
  const h = location.hash || '#/';
  const onProfile = h.startsWith('#/profile');
  $('#nav-explore').classList.toggle('on', !onProfile); $('#nav-profile').classList.toggle('on', onProfile);
  if (onProfile) { $('#nav-profile').setAttribute('aria-current', 'page'); $('#nav-explore').removeAttribute('aria-current'); }
  else { $('#nav-explore').setAttribute('aria-current', 'page'); $('#nav-profile').removeAttribute('aria-current'); }
  try {
    if (!state.info) await refreshState();
    if (h.startsWith('#/search')) {
      const params = new URLSearchParams(h.split('?')[1]);
      await renderSearch(params.get('q') || '', params.get('photo'));
    }
    else if (h.startsWith('#/watch/')) await renderWatch(h.slice(8));
    else if (h.startsWith('#/profile')) await renderProfile();
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = `<p>${esc(e.message)}. <a href="#/">Go home</a></p>`;
  }
}
window.addEventListener('hashchange', route);
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};
route();
