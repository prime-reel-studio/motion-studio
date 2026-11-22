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
    applyI18n(); buildPresetRow(); buildAspectRow(); buildMusicSelect(); updateKeyPill(); renderScenes();
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
    const { jobId } = await api('/api/render', { method: 'POST', body: JSON.stringify({ project: projectPayload() }) });
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

init().catch((e) => console.error(e));
