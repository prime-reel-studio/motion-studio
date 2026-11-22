let lastRenderForm = null;
/* Reel Studio frontend */
const state = {
  config: null,
  media: [],
  scenes: [],
  voiceover: null, // filename in uploads/
  preset: 'cinematic',
  aspect: '9:16',
  musicTrack: null,
  projectName: null,
  renderJob: null,
};

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || res.statusText), { status: res.status, json });
  return json;
}

function projectPayload() {
  return {
    title: state.projectName || 'reel',
    aspect: state.aspect,
    preset: state.preset,
    musicTrack: state.musicTrack,
    musicVolume: $('musicVol').value / 100 * 0.8,
    sfxOn: $('sfxToggle').checked,
    voiceover: state.voiceover,
    voiceoverStart: 0.25,
    scenes: state.scenes.map((s) => ({
      id: s.id, text: s.text, duration: s.duration,
      media: s.media, trimStart: s.trimStart, logoMode: s.logoMode,
    })),
  };
}

/* ---------- config & init ---------- */
async function init() {
  applyI18n();
  buildTemplates();
  state.config = await api('/api/config');
  buildVoiceSelect();
  buildMusicSelect();
  buildPresetRow();
  buildAspectRow();
  updateKeyPill();
  bindEvents();
  await refreshMedia();
  await refreshProjects();
  renderScenes();
}

function updateKeyPill() {
  const el = $('keyStatus');
  if (state.config.geminiKeySet) {
    el.className = 'pill ok';
    el.textContent = t('keyOk');
  } else {
    el.className = 'pill warn';
    el.textContent = t('keyMissing');
  }
}

function buildVoiceSelect() {
  $('voiceSelect').innerHTML = state.config.voices
    .map((v) => `<option value="${v.id}">${v.label}</option>`).join('');
}

function buildMusicSelect() {
  const sel = $('musicSelect');
  sel.innerHTML = `<option value="">${t('noMusic')}</option>` +
    state.config.music.map((m) => `<option value="${m}">${m.replace(/\.mp3$/i, '')}</option>`).join('');
  sel.onchange = () => (state.musicTrack = sel.value || null);
}

function buildPresetRow() {
  $('presetRow').innerHTML = '';
  for (const p of state.config.presets) {
    const b = document.createElement('button');
    b.className = 'chip' + (p === state.preset ? ' active' : '');
    b.textContent = t('presets')[p] || p;
    b.onclick = () => { state.preset = p; buildPresetRow(); };
    $('presetRow').appendChild(b);
  }
}

function buildAspectRow() {
  $('aspectRow').innerHTML = '';
  for (const a of state.config.aspects) {
    const b = document.createElement('button');
    b.className = 'chip' + (a === state.aspect ? ' active' : '');
    b.textContent = t('aspects')[a] || a;
    b.onclick = () => { state.aspect = a; buildAspectRow(); };
    $('aspectRow').appendChild(b);
  }
}

/* ---------- scenes ---------- */
function renderScenes() {
  const list = $('sceneList');
  $('sceneCount').textContent = state.scenes.length ? `(${state.scenes.length})` : '';
  list.innerHTML = '';
  state.scenes.forEach((s, i) => list.appendChild(sceneCard(s, i)));
  renderTimeline();
}

function sceneCard(s, i) {
  const card = document.createElement('div');
  card.className = 'scene-card';

  const thumb = document.createElement(s.previewUrl ? 'img' : 'div');
  if (s.previewUrl) {
    thumb.src = s.previewUrl;
    thumb.className = 'scene-thumb';
  } else {
    thumb.className = 'scene-thumb-empty';
    thumb.textContent = t('preview');
  }
  thumb.onclick = () => previewScene(s);

  const body = document.createElement('div');
  body.className = 'scene-body';
  body.innerHTML = `
    <div class="scene-num">#${i + 1}</div>
    <textarea data-f="text">${escapeHtml(s.text)}</textarea>
    <div class="scene-controls">
      <label class="lbl" style="margin:0">${t('dur')}</label>
      <input type="number" step="0.1" min="1" max="30" value="${s.duration}" data-f="duration" />
      <select data-f="media"></select>
      <label class="lbl" style="margin:0">${t('trim')}</label>
      <input type="number" step="0.1" min="0" value="${s.trimStart || 0}" data-f="trimStart" />
    </div>
    <div class="scene-controls">
      <label class="check" style="margin:0"><input type="checkbox" data-f="logoMode" ${s.logoMode ? 'checked' : ''}/> ${t('logoMode')}</label>
      <button class="mini" data-a="up">↑</button>
      <button class="mini" data-a="down">↓</button>
      <button class="mini" data-a="del">✕</button>
    </div>`;

  const mediaSel = body.querySelector('[data-f="media"]');
  mediaSel.innerHTML = `<option value="">${t('noMedia')}</option>` +
    state.media.filter((m) => m.kind !== 'audio')
      .map((m) => `<option value="${m.name}" ${m.name === s.media ? 'selected' : ''}>${m.name.slice(0, 34)}</option>`).join('');

  body.querySelector('[data-f="text"]').oninput = (e) => (s.text = e.target.value);
  body.querySelector('[data-f="duration"]').oninput = (e) => (s.duration = parseFloat(e.target.value) || s.duration);
  body.querySelector('[data-f="trimStart"]').oninput = (e) => (s.trimStart = parseFloat(e.target.value) || 0);
  body.querySelector('[data-f="media"]').onchange = (e) => { s.media = e.target.value || null; s.previewUrl = null; };
  body.querySelector('[data-f="logoMode"]').onchange = (e) => { s.logoMode = e.target.checked; s.previewUrl = null; };
  body.querySelector('[data-a="up"]').onclick = () => moveScene(i, -1);
  body.querySelector('[data-a="down"]').onclick = () => moveScene(i, 1);
  body.querySelector('[data-a="del"]').onclick = () => { state.scenes.splice(i, 1); renderScenes(); };

  card.appendChild(thumb);
  card.appendChild(body);
  return card;
}

function moveScene(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.scenes.length) return;
  [state.scenes[i], state.scenes[j]] = [state.scenes[j], state.scenes[i]];
  renderScenes();
}

async function previewScene(s) {
  s.previewUrl = null;
  renderScenes();
  try {
    const r = await api('/api/preview-scene', {
      method: 'POST',
      body: JSON.stringify({ scene: s, project: { aspect: state.aspect, preset: state.preset } }),
    });
    s.previewUrl = r.url;
  } catch (e) {
    alert(t('error') + ': ' + e.message);
  }
  renderScenes();
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------- media ---------- */
async function refreshMedia() {
  const { media } = await api('/api/media');
  state.media = media;
  const grid = $('mediaGrid');
  grid.innerHTML = '';
  for (const m of media) {
    const item = document.createElement('div');
    item.className = 'media-item';
    item.innerHTML =
      (m.thumb ? `<img src="${m.thumb}" loading="lazy"/>` : `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--muted);font-size:11px">${m.kind}</div>`) +
      `<span class="kind">${m.kind}</span><button class="del">✕</button>`;
    item.title = m.name;
    item.querySelector('.del').onclick = async (e) => {
      e.stopPropagation();
      await api('/api/media/' + encodeURIComponent(m.name), { method: 'DELETE' });
      await refreshMedia();
      renderScenes();
    };
    item.onclick = () => assignToFirstEmptyScene(m.name);
    grid.appendChild(item);
  }
}

function assignToFirstEmptyScene(name) {
  const s = state.scenes.find((sc) => !sc.media);
  if (s) { s.media = name; s.previewUrl = null; renderScenes(); }
}

async function uploadFiles(files) {
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  await api('/api/upload', { method: 'POST', body: fd });
  await refreshMedia();
  renderScenes();
}

/* ---------- events ---------- */
function bindEvents() {
  $('langToggle').onclick = () => {
    LANG = LANG === 'ar' ? 'en' : 'ar';
    localStorage.setItem('rs-lang', LANG);
    applyI18n(); buildTemplates(); buildPresetRow(); buildAspectRow(); buildMusicSelect(); updateKeyPill(); renderScenes();
  };

  $('breakdownBtn').onclick = async () => {
    const script = $('scriptInput').value.trim();
    if (!script) return;
    const { scenes } = await api('/api/breakdown', { method: 'POST', body: JSON.stringify({ script }) });
    state.scenes = scenes;
    renderScenes();
  };

  $('genVoBtn').onclick = async () => {
    const text = $('scriptInput').value.trim();
    if (!text) return;
    $('voState').textContent = '…';
    try {
      const r = await api('/api/voiceover', {
        method: 'POST',
        body: JSON.stringify({ text, voice: $('voiceSelect').value }),
      });
      state.voiceover = r.file;
      $('voPlayer').src = r.url;
      $('voPlayer').style.display = 'block';
      $('voState').textContent = t('voReady');
    } catch (e) {
      $('voState').textContent = t('voFail') + ': ' + e.message;
    }
  };

  $('voUpload').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('files', f);
    const r = await api('/api/upload', { method: 'POST', body: fd });
    state.voiceover = r.files[0].name;
    $('voPlayer').src = r.files[0].url;
    $('voPlayer').style.display = 'block';
    $('voState').textContent = t('voReady');
    await refreshMedia();
  };

  $('musicVol').oninput = (e) => ($('musicVolVal').textContent = e.target.value + '%');

  const dz = $('dropzone');
  dz.onclick = () => $('mediaInput').click();
  $('mediaInput').onchange = (e) => uploadFiles([...e.target.files]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); };

  $('renderBtn').onclick = startRender;
  $('saveProjectBtn').onclick = saveProject;
  $('projectSelect').onchange = (e) => loadProject(e.target.value);
}

/* ---------- render ---------- */
async function startRender() {
  if (!state.scenes.length) { alert(t('noScenes')); return; }
  $('renderBtn').disabled = true;
  $('renderProgress').style.display = 'block';
  $('renderBar').style.width = '2%';
  $('renderMsg').textContent = t('rendering');
  $('resultVideo').style.display = 'none';
  $('downloadLink').style.display = 'none';
  try {
    const proj = projectPayload();
    lastRenderForm = { title: proj.title || '', style: proj.preset || '' };
    const { jobId } = await api('/api/render', { method: 'POST', body: JSON.stringify({ project: proj }) });
    pollJob(jobId);
  } catch (e) {
    $('renderMsg').textContent = t('error') + ': ' + e.message;
    $('renderBtn').disabled = false;
  }
}

async function pollJob(jobId) {
  const job = await api('/api/jobs/' + jobId);
  $('renderBar').style.width = Math.round(job.progress * 100) + '%';
  $('renderMsg').textContent = job.message + (job.status === 'running' ? '…' : '');
  if (job.status === 'done') {
    $('renderMsg').textContent = t('done');
    $('resultVideo').src = job.url;
    $('resultVideo').style.display = 'block';
    $('downloadLink').href = job.url;
    $('downloadLink').download = job.outName;
    $('downloadLink').style.display = 'block';
    loadPublishExtras(job);
    $('renderBtn').disabled = false;
    return;
  }
  if (job.status === 'error') {
    $('renderMsg').textContent = t('error') + ': ' + job.error;
    $('renderBtn').disabled = false;
    return;
  }
  setTimeout(() => pollJob(jobId), 1200);
}

/* ---------- projects ---------- */
async function refreshProjects() {
  const { projects } = await api('/api/projects');
  const sel = $('projectSelect');
  sel.innerHTML = `<option value="">${t('newProject')}</option>` +
    projects.map((p) => `<option value="${p.name}">${p.name}</option>`).join('');
}

async function saveProject() {
  const name = state.projectName || prompt(t('projectName')) || 'reel';
  state.projectName = name;
  await api('/api/project', { method: 'POST', body: JSON.stringify({ name, data: { ...projectPayload(), script: $('scriptInput').value } }) });
  await refreshProjects();
  $('projectSelect').value = name;
  $('saveProjectBtn').textContent = t('savedOk') + ' ✓';
  setTimeout(() => ($('saveProjectBtn').textContent = t('save')), 1500);
}

async function loadProject(name) {
  if (!name) return;
  const { data, name: n } = await api('/api/project/' + encodeURIComponent(name));
  state.projectName = n;
  state.scenes = data.scenes || [];
  state.preset = data.preset || 'cinematic';
  state.aspect = data.aspect || '9:16';
  state.musicTrack = data.musicTrack;
  state.voiceover = data.voiceover || null;
  $('scriptInput').value = data.script || '';
  if (data.musicTrack) $('musicSelect').value = data.musicTrack;
  if (state.voiceover) { $('voPlayer').src = '/uploads/' + state.voiceover; $('voPlayer').style.display = 'block'; }
  buildPresetRow(); buildAspectRow(); renderScenes();
}

init().catch((e) => { console.error(e); showFatalHint(e); });

// Safety net: if init raced the DOM or an await hung, guarantee the gallery + core UI build.
document.addEventListener('DOMContentLoaded', () => setTimeout(ensureBuilt, 300));
window.addEventListener('load', () => setTimeout(ensureBuilt, 800));
function ensureBuilt() {
  try {
    if ($('tplRow') && !$('tplRow').children.length) buildTemplates();
    if ($('presetRow') && !$('presetRow').children.length && state.config) { buildPresetRow(); buildAspectRow(); buildMusicSelect(); }
  } catch (e) { console.error('ensureBuilt', e); }
}
function showFatalHint(e) {
  const el = $('renderMsg');
  if (el) el.textContent = 'حصل خطأ في التحميل — حدّث الصفحة. (' + (e && e.message ? e.message : e) + ')';
}

// ---------- publish extras: caption suggestion + thumbnail ----------
async function loadPublishExtras(job) {
  const box = $('publishBox');
  if (!box) return;
  box.style.display = 'flex';
  try {
    const r = await fetch('/api/suggest-caption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: job.title || (lastRenderForm && lastRenderForm.title) || '', style: (lastRenderForm && lastRenderForm.style) || '', outName: job.outName })
    });
    const d = await r.json();
    if (d && d.caption) {
      $('captionSugg').value = d.caption;
      $('captionAiNote').textContent = d.ai ? '✨ AI' : 'ℹ️ قاعدة جاهزة (فعّل مفتاح Gemini لكابشن بالذكاء الاصطناعي)';
    }
  } catch (e) { console.warn('caption suggest failed', e); }
  try {
    const r2 = await fetch('/api/thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outName: job.outName || (job.url || '').split('/').pop(), title: job.title || (lastRenderForm && lastRenderForm.title) || '' })
    });
    const d2 = await r2.json();
    if (d2 && d2.url) {
      const img = $('thumbPreview');
      img.src = d2.url; img.style.display = 'block';
      const a = $('thumbLink');
      a.href = d2.url; a.download = d2.name || 'thumbnail.jpg'; a.style.display = 'inline-block';
    }
  } catch (e) { console.warn('thumbnail failed', e); }
}

$('copyCaption').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('captionSugg').value);
    $('copyCaption').textContent = t('captionCopied');
    setTimeout(() => { $('copyCaption').textContent = t('copyCaption'); }, 2000);
  } catch (e) {
    $('captionSugg').select();
    document.execCommand('copy');
  }
});

// ---------- timeline view ----------
const TL_COLORS = ['#d3ad37', '#7ec8e3', '#9be37e', '#e37e9b', '#b79be3', '#e3a97e', '#7ee3c8'];
function renderTimeline() {
  const wrap = $('timelineWrap');
  const strip = $('timelineStrip');
  if (!wrap || !strip) return;
  strip.innerHTML = '';
  if (!state.scenes.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const total = state.scenes.reduce((a, s) => a + (parseFloat(s.duration) || 0), 0);
  $('tlTotal').textContent = `(${total.toFixed(1)} ${t('sec') || 'ث'})`;
  state.scenes.forEach((sc, i) => {
    const dur = parseFloat(sc.duration) || 0;
    const b = document.createElement('div');
    b.className = 'tl-block';
    b.style.background = TL_COLORS[i % TL_COLORS.length];
    b.style.width = Math.max(44, Math.min(220, dur * 26)) + 'px';
    b.innerHTML = `<span class="tl-idx">${i + 1}</span><span class="tl-dur">${dur.toFixed(1)}s</span>`;
    b.onclick = () => {
      const cards = document.querySelectorAll('#sceneList .scene-card, #sceneList > *');
      const target = cards[i];
      if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.style.outline = '2px solid #d3ad37'; setTimeout(() => { target.style.outline = ''; }, 1500); }
    };
    strip.appendChild(b);
  });
}

// ---------- template gallery ----------
const TEMPLATES = [
  { id: 'matchday', emoji: '⚽', ar: 'إعلان ماتش', en: 'Matchday', desc_ar: 'إعلان ماتش جاي بتاريخ وملعب', desc_en: 'Upcoming match announcement', gradient: 'linear-gradient(135deg,#1a1a1f,#3a2f10)', preset: 'sports', aspect: '9:16', music: 'Upbeat Forever.mp3',
    script: 'يوم الماتش وصل!\nبرايم أكاديمي ضد المنافس القادم\nالجمعة الساعة 4 عصرًا — الملعب الرئيسي\nتعالوا شجعوا أبطالنا' },
  { id: 'highlights', emoji: '🔥', ar: 'لقطات الماتش', en: 'Highlights', desc_ar: 'أجمل لقطات من آخر ماتش', desc_en: 'Best moments from the last match', gradient: 'linear-gradient(135deg,#101016,#5a1010)', preset: 'cinematic', aspect: '9:16', music: 'Inspired.mp3',
    script: 'لقطات ما تتنسيش من الماتش الأخير\nمهارات وأهداف بمستوى تاني\nبرايم أكاديمي — حيث يولد الأبطال' },
  { id: 'goal', emoji: '🥅', ar: 'جول الأسبوع', en: 'Goal of the week', desc_ar: 'أحلى جول في الأسبوع', desc_en: 'Best goal this week', gradient: 'linear-gradient(135deg,#0c1a0c,#2f5a10)', preset: 'sports', aspect: '9:16', music: 'Upbeat Forever.mp3',
    script: 'جول الأسبوع من برايم أكاديمي\nتسديدة ما تتصدش!\nشوف الإبداع بنفسك' },
  { id: 'player', emoji: '⭐', ar: 'تقديم لاعب', en: 'Player intro', desc_ar: 'قدّم لاعب جديد أو نجم الأسبوع', desc_en: 'Introduce a player', gradient: 'linear-gradient(135deg,#141420,#3a2f10)', preset: 'club', aspect: '9:16', music: 'Deliberate Thought.mp3',
    script: 'نجمنا الصاعد\nموهبة من برايم أكاديمي\nالمستقبل بيبدأ من هنا' },
  { id: 'training', emoji: '💪', ar: 'تدريبات', en: 'Training', desc_ar: 'لقطات من التدريب اليومي', desc_en: 'Training montage', gradient: 'linear-gradient(135deg,#101820,#1f3a5a)', preset: 'minimal', aspect: '9:16', music: 'Wholesome.mp3',
    script: 'شغل كل يوم\nالتفاصيل الصغيرة بتفرق\nبرايم أكاديمي — انضباط وشغف' },
  { id: 'promo', emoji: '🏆', ar: 'اشترك الآن', en: 'Join us', desc_ar: 'دعوة للاشتراك في الأكاديمية', desc_en: 'Academy sign-up promo', gradient: 'linear-gradient(135deg,#1a1408,#6a5410)', preset: 'club', aspect: '9:16', music: 'Inspired.mp3',
    script: 'ابنك عنده موهبة؟\nبرايم أكاديمي بتستقبل لاعبين جدد\nاحجز مكانك دلوقتي — الأماكن محدودة' },
];

function buildTemplates() {
  const row = $('tplRow');
  if (!row) return;
  row.innerHTML = '';
  const isAr = (document.documentElement.lang || 'ar') === 'ar';
  TEMPLATES.forEach((tp) => {
    const c = document.createElement('div');
    c.className = 'tpl-card';
    c.style.background = tp.gradient;
    c.innerHTML = `<span class="tpl-emoji">${tp.emoji}</span><span class="tpl-name">${isAr ? tp.ar : tp.en}</span><span class="tpl-desc">${isAr ? tp.desc_ar : tp.desc_en}</span><span class="tpl-meta">${tp.aspect} · ${tp.preset}</span>`;
    c.onclick = () => applyTemplate(tp);
    row.appendChild(c);
  });
}

async function applyTemplate(tp) {
  $('scriptInput').value = tp.script.replace(/\\n/g, '\n');
  state.preset = tp.preset;
  state.aspect = tp.aspect;
  buildPresetRow(); buildAspectRow();
  const sel = $('musicSelect');
  if (sel) {
    const opt = [...sel.options].find(o => o.value === tp.music);
    if (opt) { sel.value = tp.music; state.musicTrack = tp.music; }
  }
  state.projectName = tp.ar;
  window.scrollTo({ top: document.querySelector('.layout').offsetTop - 10, behavior: 'smooth' });
  // auto-breakdown so scenes appear immediately
  try { $('breakdownBtn').click(); } catch (e) { /* user can click */ }
}
