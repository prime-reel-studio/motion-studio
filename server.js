const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { breakdown } = require('./lib/scenes');
const { renderProject, previewScene } = require('./lib/render');
const voiceover = require('./lib/voiceover');
const stock = require('./lib/stock');
const commons = require('./lib/commons');
const recap = require('./lib/recap');

const ROOT = __dirname;
const dirs = {
  uploads: path.join(ROOT, 'uploads'),
  renders: path.join(ROOT, 'renders'),
  tmp: path.join(ROOT, 'tmp'),
  projects: path.join(ROOT, 'projects'),
  music: path.join(ROOT, 'assets', 'music'),
  sfx: path.join(ROOT, 'assets', 'sfx'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

// Bundled Arabic fonts: install into the user font dir so libass shapes
// captions correctly (Noto Naskh Arabic is the caption font). Linux only;
// on other platforms install assets/fonts/*.ttf manually once.
try {
  const os = require('os');
  const { execSync } = require('child_process');
  const fontDir = path.join(os.homedir(), '.fonts');
  if (process.platform === 'linux') {
    fs.mkdirSync(fontDir, { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'fonts'))) {
      const dest = path.join(fontDir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(ROOT, 'assets', 'fonts', f), dest);
    }
    execSync('fc-cache -f >/dev/null 2>&1 || true');
  }
} catch (_) {}

const app = express();
app.use(express.json({ limit: '20mb' }));

// ---------- access gate: single shared passcode (personal app) ----------
const SITE_PASSCODE = (process.env.SITE_PASSCODE || '').trim();
const GATE_SECRET = process.env.GATE_SECRET || SITE_PASSCODE || 'dev-open';
const gateToken = () => crypto.createHmac('sha256', GATE_SECRET).update('studio-gate-v1').digest('hex');
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function gateOpen(req) {
  if (!SITE_PASSCODE) return true; // local dev without a passcode stays open
  return readCookie(req, 'studio_auth') === gateToken();
}
app.post('/api/login', (req, res) => {
  if (!SITE_PASSCODE) return res.json({ ok: true });
  const { passcode } = req.body || {};
  if (String(passcode || '').trim() === SITE_PASSCODE) {
    res.setHeader('Set-Cookie',
      'studio_auth=' + gateToken() + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (60 * 60 * 24 * 60) + '; Secure');
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, message: 'wrong passcode' });
});
app.get('/api/health', (_req, res) => res.json({ ok: true, build: 'recap-v10-local-media' }));
// Everything else under /api, and all user content, requires the gate.
app.use((req, res, next) => {
  const p = req.path;
  const gated = p.startsWith('/api/') || p.startsWith('/uploads') || p.startsWith('/renders') || p.startsWith('/tmp');
  if (gated && !gateOpen(req)) return res.status(401).json({ ok: false, message: 'locked' });
  next();
});
app.use(express.static(path.join(ROOT, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use('/uploads', express.static(dirs.uploads));
app.use('/renders', express.static(dirs.renders));
app.use('/tmp', express.static(dirs.tmp));

const upload = multer({
  storage: multer.diskStorage({
    destination: dirs.uploads,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path
        .basename(file.originalname, ext)
        .replace(/[^\p{L}\p{N}_-]+/gu, '_')
        .slice(0, 50) || 'file';
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const jobs = new Map();
let renderQueue = Promise.resolve();

// ---------- config ----------
app.get('/api/config', (_req, res) => {
  const music = fs.readdirSync(dirs.music).filter((f) => /\.(mp3|wav|m4a)$/i.test(f));
  const sfx = fs.readdirSync(dirs.sfx).filter((f) => /\.(mp3|wav)$/i.test(f));
  res.json({
    geminiKeySet: voiceover.keySet(),
    recapReady: true,
    episodeRetrievalReady: false,
    promptScriptReady: false,
    stockKeySet: stock.keySet(),
    voices: voiceover.VOICES,
    music,
    sfx,
    presets: ['cinematic', 'sports', 'minimal', 'club'],
    aspects: ['9:16', '1:1', '16:9'],
  });
});

// ---------- script breakdown ----------
app.post('/api/breakdown', (req, res) => {
  const scenes = breakdown(req.body.script || '');
  res.json({ scenes });
});

// ---------- media ----------
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const VIDEO_RE = /\.(mp4|mov|webm|mkv)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg)$/i;

function mediaKind(name) {
  if (IMAGE_RE.test(name)) return 'image';
  if (VIDEO_RE.test(name)) return 'video';
  if (AUDIO_RE.test(name)) return 'audio';
  return 'other';
}

app.post('/api/upload', upload.array('files', 20), (req, res) => {
  const files = (req.files || []).map((f) => ({
    name: path.basename(f.path),
    kind: mediaKind(f.filename),
    size: f.size,
    url: '/uploads/' + path.basename(f.path),
  }));
  res.json({ files });
});

app.get('/api/media', async (_req, res) => {
  const names = fs.readdirSync(dirs.uploads).filter((f) => !f.startsWith('.') && !f.endsWith('.json'));
  const items = [];
  for (const name of names) {
    const kind = mediaKind(name);
    let thumb = null;
    if (kind === 'image') thumb = '/uploads/' + name;
    if (kind === 'video') {
      const t = path.join(dirs.tmp, 'thumb_' + name.replace(/[^\w.-]/g, '_') + '.jpg');
      if (!fs.existsSync(t)) {
        try {
          await new Promise((resolve) => {
            const { spawn } = require('child_process');
            const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.5', '-i', path.join(dirs.uploads, name), '-frames:v', '1', '-vf', 'scale=320:-2', t]);
            p.on('close', resolve);
            p.on('error', resolve);
          });
        } catch (_) {}
      }
      if (fs.existsSync(t)) thumb = '/tmp/' + path.basename(t);
    }
    items.push({ name, kind, thumb, url: '/uploads/' + name });
  }
  res.json({ media: items });
});

app.delete('/api/media/:name', (req, res) => {
  const p = path.join(dirs.uploads, path.basename(req.params.name));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ---------- legal stock ----------
app.post('/api/stock/search', async (req, res) => {
  try {
    const entity = commons.entity(req.body.text) || commons.entity(req.body.query);
    if (entity || req.body.provider === 'commons') {
      const query = entity || req.body.query || req.body.text;
      const result = req.body.kind === 'image' ? {items:await commons.search(query,'image'),fallback:false} : await commons.forEntity(query);
      return res.json({ok:true,query,provider:'Wikimedia Commons',...result});
    }
    const query = req.body.query || stock.suggest(req.body.text);
    if (!query) return res.status(422).json({ok:false,message:'اكتب كلمات بحث بالإنجليزي للمشهد ده'});
    res.json({ok:true,query,items:await stock.search(query,req.body.kind,req.body.aspect || '9:16')});
  } catch(e) { res.status(503).json({ok:false,message:e.message}); }
});
app.post('/api/stock/download', async (req,res) => {
  try { res.json({ok:true,file:await (String(req.body.token).startsWith('commons-') ? commons : stock).download(req.body.token,dirs.uploads)}); }
  catch(e) { res.status(400).json({ok:false,message:e.message}); }
});

// ---------- voiceover ----------
app.post('/api/voiceover', async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ ok: false, message: 'empty text' });
  try {
    const result = await voiceover.generateTTS(text, voice, dirs.uploads);
    if (result.ok) return res.json({ ok: true, file: result.file, url: '/uploads/' + result.file });
    res.status(result.needsKey ? 412 : 500).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: String(e.message || e) });
  }
});

// ---------- scene preview ----------
app.post('/api/preview-scene', async (req, res) => {
  const { scene, project } = req.body || {};
  if (!scene) return res.status(400).json({ ok: false, message: 'no scene' });
  const outFile = path.join(dirs.tmp, `pv_${crypto.randomBytes(4).toString('hex')}.jpg`);
  try {
    await previewScene(scene, project || {}, dirs, outFile);
    res.json({ ok: true, url: '/tmp/' + path.basename(outFile) + '?t=' + Date.now() });
  } catch (e) {
    res.status(500).json({ ok: false, message: String(e.message || e) });
  }
});


// ---------- caption suggestion ----------
function ruleBasedCaption(title, texts) {
  const hook = (texts.find((t) => t && t.trim()) || title || '').trim();
  const all = texts.join(' ');
  const tags = ['#برايم_اكاديمي'];
  const map = [
    [/ماتش|مباراة|فوز|هدف|جون/i, ['#كورة', '#مباراة', '#اهداف']],
    [/تدريب|تمرين/i, ['#تدريب', '#كورة_قعدات']],
    [/موهبة|مواهب|لاعب/i, ['#مواهب', '#نجوم_المستقبل']],
    [/بطولة|دوري/i, ['#بطولة', '#دوري']],
    [/حراسة|حارس/i, ['#حراسة_المرمى']],
  ];
  for (const [re, arr] of map) if (re.test(all)) tags.push(...arr);
  tags.push('#اكاديمية_كرة', '#مصر');
  const uniq = [...new Set(tags)].slice(0, 8);
  const caption = (hook ? hook + '\n\n' : '') + 'تابعونا لسه في كتير جاي ⚽🔥\n\n' + uniq.join(' ');
  return caption;
}

app.post('/api/suggest-caption', async (req, res) => {
  const { title, texts, lang } = req.body || {};
  const list = Array.isArray(texts) ? texts : [];
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (key) {
    try {
      const prompt = 'اكتب كابشن جاهز للنشر على فيسبوك/انستجرام/تيك توك لفيديو قصير بالمحتوى ده. باللهجة المصرية، سطرين جذابين + إيموجي مناسب + سطر هاشتاجات (حتى 8). من غير مقدمات. المحتوى:\n' + list.filter(Boolean).join('\n');
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      const j = await r.json();
      const text = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts.map((p) => p.text).join('');
      if (text) return res.json({ ok: true, caption: text.trim(), ai: true });
      throw new Error('bad gemini response');
    } catch (e) {
      return res.json({ ok: true, caption: ruleBasedCaption(title, list), ai: false, fallback: true });
    }
  }
  res.json({ ok: true, caption: ruleBasedCaption(title, list), ai: false });
});

// ---------- thumbnail ----------
app.post('/api/thumbnail', async (req, res) => {
  const { outName, title } = req.body || {};
  const safe = path.basename(outName || '');
  const src = path.join(dirs.renders, safe);
  if (!safe || !fs.existsSync(src)) return res.status(404).json({ ok: false, message: 'render not found' });
  const outThumb = safe.replace(/\.mp4$/i, '') + '-thumb.jpg';
  const outPath = path.join(dirs.renders, outThumb);
  try {
    const W = 1080, H = 1920;
    // Use an actual export frame. Do not add the old sentence-style font on top.
    await new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const p = spawn('ffmpeg', ['-y', '-loglevel', 'error',
        '-i', src, '-ss', '0.8',
        '-vf', "scale=" + W + ":" + H + ":force_original_aspect_ratio=increase,crop=" + W + ":" + H,
        '-frames:v', '1', '-q:v', '3', outPath]);
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err || 'ffmpeg ' + c))));
      p.on('error', reject);
    });
    res.json({ ok: true, url: '/renders/' + outThumb, name: outThumb });
  } catch (e) {
    res.status(500).json({ ok: false, message: String(e.message || e) });
  }
});

// ---------- render ----------
app.post('/api/render', (req, res) => {
  const project = req.body.project;
  if (!project || !Array.isArray(project.scenes) || !project.scenes.length) {
    return res.status(400).json({ ok: false, message: 'project has no scenes' });
  }
  const id = 'job-' + crypto.randomBytes(4).toString('hex');
  const job = { id, status: 'running', progress: 0, message: 'starting', outName: null, error: null };
  jobs.set(id, job);
  const frozenProject = JSON.parse(JSON.stringify(project));
  job.message = 'waiting for render slot';
  const operation = renderQueue.then(() => frozenProject.renderMode === 'recap' ? recap.renderRecap(frozenProject, job, dirs) : renderProject(frozenProject, job, dirs));
  renderQueue = operation.catch(() => {});
  operation
    .then(({ outName, duration, creditsUrl }) => {
      job.status = 'done';
      job.outName = outName;
      job.url = '/renders/' + outName;
      job.duration = duration;
      job.creditsUrl = creditsUrl;
      job.progress = 1;
    })
    .catch((e) => {
      job.status = 'error';
      job.error = String(e.message || e);
    });
  res.json({ ok: true, jobId: id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false });
  res.json(job);
});

// ---------- projects ----------
function safeProjName(n) {
  return (n || 'project').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'project';
}

app.post('/api/project', (req, res) => {
  const { name, data } = req.body || {};
  if (!data) return res.status(400).json({ ok: false });
  const file = path.join(dirs.projects, safeProjName(name) + '.json');
  fs.writeFileSync(file, JSON.stringify({ name, data, savedAt: new Date().toISOString() }, null, 2));
  res.json({ ok: true });
});

app.get('/api/projects', (_req, res) => {
  const list = fs
    .readdirSync(dirs.projects)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dirs.projects, f), 'utf8'));
        return { name: j.name, savedAt: j.savedAt };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  res.json({ projects: list });
});

app.get('/api/project/:name', (req, res) => {
  const file = path.join(dirs.projects, safeProjName(req.params.name) + '.json');
  if (!fs.existsSync(file)) return res.status(404).json({ ok: false });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Motion Studio running: http://localhost:${PORT}`);
  console.log(`Gemini voiceover key: ${voiceover.keySet() ? 'set' : 'NOT set (uploaded voiceover still works)'}`);
});
