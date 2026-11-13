/* ConceptReel front end: vanilla JS, hash routing. */
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
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
  toast(`${e.code && !['hold', 'illegible'].includes(e.code) ? '🛡️ ' : ''}${esc(e.message)}`, ms);
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
}
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
  $('#tokens-sub').textContent = `${u.grade ? `Grade ${u.grade} · ` : ''}Refills in ${days} day${days === 1 ? '' : 's'} · ${u.saved} saved by reusing`;
}
$('#user-select').addEventListener('change', async (e) => {
  if (e.target.value === '__new') {
    const name = (prompt('New learner name?') || '').trim().slice(0, 24);
    if (!name) { e.target.value = state.user; return; }
    e.target.value = name;
  }
  state.user = e.target.value === '__new' ? state.user : e.target.value;
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
function thumb(v, extra = '') {
  return `<div class="vthumb">${esc(v.emoji || SUBJECT_EMOJI[v.subject] || '🎬')}${v.source === 'generated' ? `<span class="badge">${v.sourceImage ? '📷 From a photo' : 'New'}</span>` : v.source === 'explainer' ? '<span class="badge">Deep dive</span>' : ''}<span class="dur">${fmt(v.duration)}</span>${extra}</div>`;
}
function videoCard(v) {
  return `<div class="vcard" data-go="${v.id}">
    ${thumb(v)}
    <div class="vtitle">${esc(v.title)}</div>
    <div class="vmeta"><span>${esc(v.subject)}</span><span>Grades ${esc(v.gradeBand)}</span><span>${v.stats.views} views</span></div>
    <div class="qrow"><span>Helpfulness</span><div class="qbar"><div style="width:${v.quality.score}%"></div></div><b>${v.quality.score}</b></div>
  </div>`;
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
  app.innerHTML = `
    <section class="hero">
      <h1>Stuck on a concept?<br/>Watch it explained.</h1>
      <p>Search any high school topic. If another learner already made a video for it, you watch it free. Confused at one moment? Select it and get a bespoke explainer just for that part.</p>
      <form class="searchbar" id="search-form">
        <input id="q" placeholder="e.g. how do plants make food from sunlight" autocomplete="off" autofocus />
        <button class="btn big">Find videos</button>
      </form>
      <div class="photo-row">
        <button class="btn ghost" id="photo-btn" type="button">📷 Snap or upload a page</button>
        <span class="hint">A textbook page, a diagram, a screenshot or your handwritten notes. You can also paste or drop an image here.</span>
      </div>
      <div class="chips">
        ${['Photosynthesis', "Newton's laws", 'Why the French Revolution started', 'Mitosis phases', 'Pythagoras theorem', 'Supply and demand', 'The Krebs cycle']
          .map((c) => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
    </section>
    <section class="impact">
      <div class="stat"><b>${m.videos}</b><span>concept videos in the shared library</span></div>
      <div class="stat"><b>${m.reuseCount}</b><span>times a saved video was reused</span></div>
      <div class="stat"><b>${m.tokensSaved}</b><span>tokens saved by reuse instead of regenerating</span></div>
      <div class="stat"><b>${m.explainers}</b><span>bespoke "explain this part" deep dives</span></div>
    </section>
    <h2>Most helpful right now</h2>
    <p class="sub">Ranked by how well other learners did on the check-in quiz, how many finished, likes, and how rarely they got stuck.</p>
    <div class="grid">${videos.map(videoCard).join('')}</div>`;
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`; });
  app.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/search?q=${encodeURIComponent(b.dataset.q)}`)));
  $('#photo-btn').addEventListener('click', photoPicker);
  bindGo();
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
      <input id="q" value="" placeholder="Try another concept" /><button class="btn">Search</button>
    </form>
    <div class="banner warn">🛡️ ${esc(data.blocked)}</div>`;
    $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); const nq = $('#q').value.trim(); if (nq) location.hash = `#/search?q=${encodeURIComponent(nq)}`; });
    return;
  }
  app.innerHTML = `
    <form class="searchbar" id="search-form" style="margin:0 0 6px;max-width:none">
      <input id="q" value="${esc(q)}" /><button class="btn">Search</button>
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
          <div class="vmeta" style="margin-top:4px"><span>${esc(v.subject)} · Grades ${esc(v.gradeBand)}</span>${v.checkpoints ? `<span>✅ ${v.checkpoints} checkpoint${v.checkpoints === 1 ? '' : 's'}</span>` : ''}<span>${v.stats.views} views</span><span>${v.quality.breakdown.quiz}% quiz accuracy</span><span>${v.quality.breakdown.completion}% finish it</span></div>
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

  app.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> › ${data.parent ? `<a href="#/watch/${data.parent.id}">${esc(data.parent.title)}</a> › Deep dive` : esc(v.subject)}</div>
    <div class="watch">
      <div>
        <div class="stage" id="stage">
          <div class="scene-num" id="scene-num"></div>
          <div class="heading" id="heading"></div>
          <div class="visual" id="visual"></div>
          <div class="caption" id="caption"></div>
          <div class="overlay" id="overlay"><button class="playbig" id="playbig" aria-label="Play">▶</button></div>
          <div class="checkpoint" id="cp" hidden></div>
        </div>
        <div class="controls">
          <button class="iconbtn" id="pp" aria-label="Play or pause">▶</button>
          <div class="timeline" id="timeline">
            <div class="segs">${durs.map((d, i) => `<div class="seg" style="flex:${d}" title="${esc(v.scenes[i].heading)}"><div class="heat" style="opacity:${((confused[i] || 0) / maxConf) * 0.75}"></div></div>`).join('')}</div>
            <div class="played" id="played"></div>
            <div class="sel" id="sel" hidden></div>
            <div class="head" id="head"></div>
          </div>
          <span class="time" id="time">0:00 / ${fmt(total)}</span>
          <button class="iconbtn" id="mute" aria-label="Toggle narration">🔊</button>
        </div>
        <div class="tl-legend"><span>Drag across the timeline to select the part you didn't get.</span><span><i></i>where other learners got stuck</span></div>
        <div class="explain-box" id="explain-box">
          <div class="row">
            <span>🤔 Didn't get <b id="ex-label">this part</b>?</span>
            ${data.freeTextQuestions ? '<input id="ex-q" placeholder="Optional: what confused you?" />' : '<input id="ex-q" type="hidden" value="" />'}
            <button class="btn" id="ex-btn">Explain this part · ${state.info.cost.explainer} tokens</button>
          </div>
          <div class="hint" id="ex-hint" style="margin-top:6px">If another learner already asked about this part, you'll get their deep dive free.</div>
        </div>
        ${data.canGoDeeper ? '' : `<div class="banner info">🧭 ${v.depth ? "You've gone as deep as this lesson goes! Want to try a related topic?" : ''}</div>`}
        <div class="v-info">
          <div>
            <h1>${esc(v.title)}</h1>
            <div class="vmeta"><span>${esc(v.subject)} · Grades ${esc(v.gradeBand)}</span>${v.scenes.some((s) => s.checkpoint) ? `<span>✅ ${v.scenes.filter((s) => s.checkpoint).length} checkpoints</span>` : ''}<span>${v.stats.views} views</span><span>made by ${esc(v.createdBy)}</span></div>
          </div>
          <div class="reactions">
            <button id="like">👍 <span>${v.stats.likes}</span></button>
            <button id="dislike">👎 <span>${v.stats.dislikes}</span></button>
          </div>
        </div>
        <div id="quiz-slot"></div>
      </div>
      <aside class="side">
        ${v.sourceImage ? `<div class="panel"><h3>Made from a learner's photo</h3><a href="${esc(v.sourceImage)}" target="_blank" rel="noopener"><img class="src-img" src="${esc(v.sourceImage)}" alt="The photo this video was made from" /></a></div>` : ''}
        <div class="panel">
          <h3>Why it ranks here</h3>
          <div class="hint" style="margin:-4px 0 8px">How it helped other learners</div>
          <div class="breakdown">
            ${[['Quiz accuracy', v.quality.breakdown.quiz], ['Finish rate', v.quality.breakdown.completion], ['Liked', v.quality.breakdown.likes], ['Clarity', v.quality.breakdown.clarity]]
              .map(([k, n]) => `<span>${k}</span><div class="qbar"><div style="width:${n}%"></div></div><b>${n}</b>`).join('')}
          </div>
          <div style="margin-top:8px;font-weight:700">${v.quality.confident ? `Helpfulness score: <span class="qpill ${qClass(v.quality.score)}">${v.quality.score}</span>` : 'New video: the score firms up as learners watch, rate and take the quiz.'}</div>
        </div>
        ${v.conceptMap && v.conceptMap.nodes.length >= 3 ? `<div class="panel"><h3>Concept map</h3><div class="hint" style="margin:-4px 0 6px">Knowledge graph built from this video's transcript (POS tagging: nouns become concepts, verbs become links). Search matches against it.</div>${conceptMapSvg(v.conceptMap)}</div>` : ''}
        <div class="panel">
          <h3>Deep dives other learners asked for</h3>
          ${data.explainers.length ? data.explainers.map((x) => `<div class="mini" data-go="${x.id}"><div class="vthumb">🔎</div><div><div class="t">${esc(v.scenes[x.parentScene]?.heading || x.title)}</div><div class="m">at ${fmt(starts[x.parentScene] || 0)} · ${x.stats.views} views</div></div></div>`).join('') : '<div class="empty">None yet. Be the first to ask about a confusing part.</div>'}
        </div>
        <div class="panel">
          <h3>Other versions, ranked by learners</h3>
          ${data.alternatives.length ? data.alternatives.map((x) => `<div class="mini" data-go="${x.id}"><div class="vthumb">${esc(x.emoji || SUBJECT_EMOJI[x.subject] || '🎬')}</div><div><div class="t">${esc(x.title)}</div><div class="m">${qPill(x.quality)} · ${esc(x.style || '')} · ${fmt(x.duration)}</div></div></div>`).join('') : '<div class="empty">This is the only version so far.</div>'}
        </div>
      </aside>
    </div>`;
  bindGo();

  api(`/api/videos/${id}/event`, { body: { type: 'view' } }).then((r) => renderTokens(r.user)).catch(() => {});

  const p = (player = { t: 0, playing: false, scene: -1, muted: localStorage.getItem('cr-muted') === '1', sel: null, completed: false, last: 0, speaking: false, cpDone: {} });
  $('#mute').textContent = p.muted ? '🔇' : '🔊';

  const sceneAt = (t) => { let i = 0; while (i < starts.length - 1 && t >= starts[i + 1]) i++; return i; };
  function speak(text) {
    if (p.muted || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    const voice = speechSynthesis.getVoices().find((vv) => /en(-|_)/i.test(vv.lang) && /Google|Natural|Samantha|Daniel/i.test(vv.name)) || speechSynthesis.getVoices().find((vv) => /^en/i.test(vv.lang));
    if (voice) u.voice = voice;
    p.speaking = true;
    u.onend = u.onerror = () => { p.speaking = false; };
    speechSynthesis.speak(u);
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
    if (narrate) speak(s.narration);
  }
  function draw() {
    const pct = (p.t / total) * 100;
    $('#played').style.width = `${pct}%`;
    $('#head').style.left = `calc(${pct}% - 1px)`;
    $('#time').textContent = `${fmt(p.t)} / ${fmt(total)}`;
  }
  function tick(now) {
    if (!p.playing) return;
    const dt = Math.min(0.25, (now - p.last) / 1000);
    p.last = now;
    const i = sceneAt(p.t);
    const end = starts[i] + durs[i];
    // Hold at the end of a scene until narration finishes so voice and visuals stay in sync.
    if (p.t + dt >= end && p.speaking && i < v.scenes.length) p.t = Math.max(p.t, end - 0.05);
    else p.t += dt;
    if (p.t >= total) {
      const last = v.scenes.length - 1;
      if (v.scenes[last].checkpoint && !p.cpDone[last]) { p.t = total - 0.01; draw(); return checkpoint(last); }
      p.t = total; draw(); return finish();
    }
    const ni = sceneAt(p.t);
    if (ni !== p.scene && v.scenes[p.scene] && v.scenes[p.scene].checkpoint && !p.cpDone[p.scene] && ni === p.scene + 1) {
      p.t = starts[ni] - 0.01; draw(); return checkpoint(p.scene);
    }
    if (ni !== p.scene) showScene(ni, true);
    draw();
    p.raf = requestAnimationFrame(tick);
  }
  function play() {
    if (p.t >= total) p.t = 0;
    p.playing = true;
    $('#overlay').hidden = true;
    $('#pp').textContent = '❚❚';
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
    $('#pp').textContent = '▶';
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
    $('#ex-btn').textContent = existing ? 'Watch the deep dive · free' : `Explain this part · ${state.info.cost.explainer} tokens`;
    $('#ex-hint').textContent = existing
      ? `${existing.stats.views || 'Other'} learner${existing.stats.views === 1 ? '' : 's'} already asked about this part, so it's free.`
      : "Nobody has asked about this part yet. You'll get a bespoke deep dive that joins the library for others.";
  }
  const tl = $('#timeline');
  const tAt = (e) => { const r = tl.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * total; };
  let dragStart = null;
  tl.addEventListener('pointerdown', (e) => { dragStart = tAt(e); tl.setPointerCapture(e.pointerId); });
  tl.addEventListener('pointermove', (e) => { if (dragStart != null && Math.abs(tAt(e) - dragStart) > total * 0.01) setSelection(dragStart, tAt(e)); });
  tl.addEventListener('pointerup', (e) => {
    const end = tAt(e);
    if (dragStart != null && Math.abs(end - dragStart) <= total * 0.01) { p.sel = null; $('#sel').hidden = true; seek(end, true); }
    dragStart = null;
  });

  $('#pp').addEventListener('click', () => (p.playing ? pause() : play()));
  $('#playbig').addEventListener('click', () => { if (p.t >= total) p.t = 0; play(); });
  $('#mute').addEventListener('click', () => {
    p.muted = !p.muted;
    localStorage.setItem('cr-muted', p.muted ? '1' : '0');
    $('#mute').textContent = p.muted ? '🔇' : '🔊';
    if (p.muted && 'speechSynthesis' in window) { speechSynthesis.cancel(); p.speaking = false; }
  });

  async function react(type) {
    const r = await api(`/api/videos/${id}/event`, { body: { type } });
    $('#like span').textContent = r.stats.likes;
    $('#dislike span').textContent = r.stats.dislikes;
    $('#like').classList.toggle('on', r.reaction === 'like');
    $('#dislike').classList.toggle('on', r.reaction === 'dislike');
  }
  $('#like').addEventListener('click', () => react('like'));
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
    const qs = v.quiz || [];
    if (!qs.length) {
      $('#quiz-slot').innerHTML = `<div class="quiz"><h3>Done!</h3><p class="hint">${data.parent ? `<a href="#/watch/${data.parent.id}">Back to the full video</a>` : 'Was this helpful? Your 👍 / 👎 helps rank it for others.'}</p></div>`;
      return;
    }
    $('#quiz-slot').innerHTML = `<div class="quiz"><h3>Quick check: did it click?</h3><p class="hint" style="margin:0">Your answers help rank this video for other learners.</p>
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
      api(`/api/videos/${id}/event`, { body: { type: 'quiz', correct, total: qs.length } }).catch(() => {});
    });
  }

  showScene(0, false);
  draw();
}

// ---------- router ----------
async function route() {
  stopPlayer();
  modal();
  const h = location.hash || '#/';
  try {
    if (!state.info) await refreshState();
    if (h.startsWith('#/search')) {
      const params = new URLSearchParams(h.split('?')[1]);
      await renderSearch(params.get('q') || '', params.get('photo'));
    }
    else if (h.startsWith('#/watch/')) await renderWatch(h.slice(8));
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = `<p>${esc(e.message)}. <a href="#/">Go home</a></p>`;
  }
}
window.addEventListener('hashchange', route);
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};
route();
