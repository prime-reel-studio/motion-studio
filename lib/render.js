// Render engine: scenes -> styled segments (Ken Burns, grade, kinetic captions)
// -> xfade transitions -> music ducking + SFX -> final MP4.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeSceneASS } = require('./ass');
const { makeLook, shuffledTransitions } = require('./look');

const FPS = 30;
const TRANSITIONS = {
  cinematic: { list: ['fade', 'dissolve', 'fadeblack'], dur: 0.7 },
  sports: { list: ['fadeblack', 'slideleft', 'wipeup'], dur: 0.4 },
  minimal: { list: ['fade'], dur: 0.5 },
  club: { list: ['fadeblack', 'wipeleft', 'dissolve'], dur: 0.5 },
};

const GRADES = {
  cinematic: 'eq=contrast=1.08:saturation=0.92:brightness=-0.02,vignette=PI/4,noise=alls=5:allf=t',
  sports: 'eq=contrast=1.18:saturation=1.28,unsharp=5:5:0.7,vignette=PI/5',
  minimal: 'eq=contrast=1.03',
  club: 'eq=contrast=1.12:saturation=0.85:brightness=-0.03,colorbalance=bs=0.08:bm=0.05,vignette=PI/4,noise=alls=4:allf=t',
};

function dimsFor(aspect) {
  if (aspect === '1:1') return { W: 1080, H: 1080 };
  if (aspect === '16:9') return { W: 1920, H: 1080 };
  return { W: 1080, H: 1920 }; // 9:16
}

function run(cmd, args, onStderr) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let errBuf = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      errBuf = (errBuf + s).slice(-4000);
      if (onStderr) onStderr(s);
    });
    proc.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} stopped (${signal || code}): ${errBuf.slice(-600)}`));
    });
    proc.on('error', reject);
  });
}

async function probe(file) {
  const args = ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file];
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', args);
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('close', (code, signal) => {
      if (code !== 0) return reject(new Error('ffprobe failed for ' + file));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function escFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// Write a 2x2 PPM whose 4 pixels are the gradient corner colors.
// Upscaled with bicubic it becomes a smooth 4-corner gradient.
function writeGradientPPM(file, corners) {
  const px = corners.map((hex) => {
    const m = hex.replace('#', '');
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  });
  const n = 128;
  const body = Buffer.alloc(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / (n-1), v = y / (n-1);
    for (let c = 0; c < 3; c++) body[(y*n+x)*3+c] = Math.round(
      px[0][c]*(1-u)*(1-v) + px[1][c]*u*(1-v) + px[2][c]*(1-u)*v + px[3][c]*u*v);
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${n} ${n}\n255\n`), body]));
}

const SPRITES = path.join(__dirname, '..', 'assets', 'sprites');

function rgbScale(hex) {
  const m = hex.replace('#', '');
  return [0, 2, 4].map((i) => (parseInt(m.slice(i, i + 2), 16) / 255).toFixed(3));
}

// Procedural motion-graphics scene for media-less scenes (all ffmpeg 4.4-safe).
// Recipes are extracted from Ahmed's reference videos: drifting gradient +
// glow blobs, smoke pools, spotlight cone, glass cards, framed art, glowing
// gems, dot textures, rings. Sprites are white RGBA; tinted via channel mixer.
function bgSpec(look, lookScene, W, H, dur, assPath, workDir, idx) {
  const stack = ['base'];
  const outPrev = () => stack[stack.length - 1];
  const markPrev = (label) => stack.push(label);
  const inputs = [];
  // Track input indices explicitly (img pushes 8 tokens, lavfi 3).
  let nIn = 0;
  const pushImg = (file) => { inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', file); return nIn++; };
  const pushLavfi = (src) => { inputs.push('-f', 'lavfi', '-i', src); return nIn++; };

  const fc = [];
  let label = 0;
  const L = () => `s${label++}`;
  const sprite = (name) => path.join(SPRITES, name);

  const tint = (hex) => { const [r, g, b] = rgbScale(hex); return `colorchannelmixer=rr=${r}:gg=${g}:bb=${b}`; };
  const floatXY = (m, scaleW) => ({
    x: `'W*${m.cx.toFixed(3)}-w/2+${m.ax}*sin(2*PI*t/${m.tx}+${m.phx})'`,
    y: `'H*${m.cy.toFixed(3)}-h/2+${m.ay}*cos(2*PI*t/${m.ty}+${m.phy})'`,
  });

  // ---------- base ----------
  const recipe = lookScene.recipe;
  if (look.theme === 'paper') {
    const bi = pushLavfi(`color=c=${look.palette.bg[0]}:s=${W}x${H}:r=${FPS}:d=${dur}`);
    fc.push(`[${bi}:v]format=yuv420p[base]`);
    // big soft gray spheres
    lookScene.blobs.slice(0, 2).forEach((b, i) => {
      const gi = pushImg(sprite('glow.png'));
      const lb = L();
      fc.push(`[${gi}:v]scale=${Math.round(W * 0.9)}:-1,format=rgba,${tint(b.color)},colorchannelmixer=aa=${(0.5 + i * 0.15).toFixed(2)}[g${i}]`);
      const xy = floatXY(b);
      const out = L();
      fc.push(`[${i === 0 ? 'base' : outPrev()}][g${i}]overlay=x=${xy.x}:y=${xy.y}[${out}]`);
      markPrev(out);
    });
  } else if (look.theme === 'pop') {
    const bi = pushLavfi(`color=c=${look.palette.bg[0]}:s=${W}x${H}:r=${FPS}:d=${dur}`);
    fc.push(`[${bi}:v]format=yuv420p,eq=contrast=1.02[base]`);
    markPrev('base');
  } else {
    // midnight / gallery: 4-corner drifting gradient + glow blobs
    const ppm = path.join(workDir, `grad_${idx}.ppm`);
    writeGradientPPM(ppm, lookScene.corners);
    const gi = pushImg(ppm);
    const big = 280;
    const hue = lookScene.hueRate ? `,hue=h='t*${lookScene.hueRate}'` : '';
    fc.push(
      `[${gi}:v]scale=${W + big}:${H + big}:flags=bicubic,` +
      `crop=${W}:${H}:x='(iw-ow)/2+${lookScene.driftAx}*sin(2*PI*t/${lookScene.driftPx})':y='(ih-oh)/2+${lookScene.driftAy}*cos(2*PI*t/${lookScene.driftPy})'` +
      `${hue},eq=saturation=1.08:contrast=1.04[base]`
    );
    markPrev('base');
    lookScene.blobs.forEach((b, i) => {
      const li = pushImg(sprite('glow.png'));
      fc.push(`[${li}:v]scale=${b.size * 2}:-1,format=rgba,${tint(b.color)},colorchannelmixer=aa=${b.alpha}[b${i}]`);
      const xy = floatXY(b);
      const out = L();
      fc.push(`[${outPrev()}][b${i}]overlay=x=${xy.x}:y=${xy.y}[${out}]`);
      markPrev(out);
    });
  }

  // ---------- recipe layers ----------
  const over = (inputLabel, x, y) => {
    const out = L();
    fc.push(`[${outPrev()}][${inputLabel}]overlay=x=${x}:y=${y}[${out}]`);
    markPrev(out);
  };

  if (recipe === 'atmos-glass' || recipe === 'spot-card' || recipe === 'gallery-frame') {
    // spotlight cone from the top, swaying gently
    const ci = pushImg(sprite('cone.png'));
    fc.push(`[${ci}:v]scale=${W}:-1,format=rgba,colorchannelmixer=aa=${recipe === 'gallery-frame' ? 0.4 : 0.3}[cone]`);
    over('cone', `'(W-w)/2+40*sin(2*PI*t/${lookScene.conePeriod})'`, '-40');
    // top light pool
    const pi = pushImg(sprite('glow.png'));
    fc.push(`[${pi}:v]scale=${Math.round(W * 0.7)}:-1,format=rgba,colorchannelmixer=aa=0.5[pool]`);
    over('pool', '(W-w)/2', `-H*0.12`);
  }

  if (recipe === 'atmos-glass') {
    const cw = Math.round(W * lookScene.cardScale);
    const fi = pushImg(sprite('card.png'));
    fc.push(`[${fi}:v]scale=${cw}:-1,format=rgba,colorchannelmixer=aa=0.14[cardf]`);
    over('cardf', '(W-w)/2', '(H-h)/2');
    const bi2 = pushImg(sprite('card-border.png'));
    fc.push(`[${bi2}:v]scale=${cw}:-1,format=rgba,${tint(look.palette.accent)},colorchannelmixer=aa=0.55[cardb]`);
    over('cardb', '(W-w)/2', '(H-h)/2');
  }

  if (recipe === 'spot-card') {
    const cw = Math.round(W * lookScene.cardScale);
    const fi = pushImg(sprite('card.png'));
    fc.push(`[${fi}:v]scale=${cw}:-1,format=rgba,${tint('#000000')},colorchannelmixer=aa=0.55[cardf]`);
    over('cardf', '(W-w)/2', '(H-h)/2');
    const bi2 = pushImg(sprite('card-border.png'));
    fc.push(`[${bi2}:v]scale=${cw}:-1,format=rgba,${tint(look.palette.accent)},colorchannelmixer=aa=0.9[cardb]`);
    over('cardb', '(W-w)/2', '(H-h)/2');
  }

  if (recipe === 'gallery-frame') {
    const fw = Math.round(W * 0.66);
    const fi = pushImg(sprite('frame.png'));
    fc.push(`[${fi}:v]scale=${fw}:-1,format=rgba,${tint(look.palette.accent)},colorchannelmixer=aa=0.95[frame]`);
    over('frame', '(W-w)/2', '(H-h)/2-H*0.02');
  }

  if (recipe === 'glow-gems') {
    const gemCols = look.palette.blobs || [look.palette.accent, '#FFFFFF'];
    lookScene.gems.forEach((g, i) => {
      const col = gemCols[i % gemCols.length];
      const gi = pushImg(sprite('glow.png'));
      const gw = Math.round(W * g.scale * g.glowScale);
      fc.push(`[${gi}:v]scale=${gw}:-1,format=rgba,${tint(col)},colorchannelmixer=aa=${g.glowAlpha.toFixed(2)}[gg${i}]`);
      const xy = floatXY(g);
      over(`gg${i}`, xy.x, xy.y);
      const mi = pushImg(sprite('gem.png'));
      const mw = Math.round(W * g.scale);
      fc.push(`[${mi}:v]scale=${mw}:-1,format=rgba,rotate=a='${g.spin}*t':fillcolor=black@0.0:ow=rotw(iw):oh=roth(ih),colorchannelmixer=aa=0.95[gm${i}]`);
      over(`gm${i}`, xy.x, xy.y);
    });
  }

  if (recipe === 'typo-poster') {
    const ri = pushImg(sprite('ring.png'));
    fc.push(`[${ri}:v]scale=${Math.round(W * 0.55)}:-1,format=rgba,${tint(look.palette.accent)},colorchannelmixer=aa=0.35[ring]`);
    const m = lookScene.blobs[0];
    over('ring', `'W*0.7-w/2+${m.ax}*sin(2*PI*t/${m.tx})'`, `'H*0.25-h/2+${m.ay}*cos(2*PI*t/${m.ty})'`);
  }

  if (recipe === 'paper-card') {
    const cw = Math.round(W * lookScene.cardScale);
    const si = pushImg(sprite('card.png'));
    fc.push(`[${si}:v]scale=${cw}:-1,format=rgba,${tint('#000000')},gblur=sigma=24,colorchannelmixer=aa=0.22[shad]`);
    over('shad', '(W-w)/2', '(H-h)/2+18');
    const fi = pushImg(sprite('card.png'));
    fc.push(`[${fi}:v]scale=${cw}:-1,format=rgba,colorchannelmixer=aa=0.96[cardf]`);
    over('cardf', '(W-w)/2', '(H-h)/2');
    const bi2 = pushImg(sprite('card-border.png'));
    fc.push(`[${bi2}:v]scale=${cw}:-1,format=rgba,${tint(look.palette.accent)},colorchannelmixer=aa=0.9[cardb]`);
    over('cardb', '(W-w)/2', '(H-h)/2');
  }

  if (recipe === 'paper-giant' || recipe === 'paper-min') {
    const di = pushImg(sprite('dots.png'));
    fc.push(`[${di}:v]scale=${W}:-1,format=rgba,${tint(look.palette.accent)},colorchannelmixer=aa=0.12[dots]`);
    over('dots', `'20*sin(2*PI*t/12)'`, `'30*cos(2*PI*t/15)'`);
    if (recipe === 'paper-min') {
      const ri = pushImg(sprite('ring.png'));
      fc.push(`[${ri}:v]scale=${Math.round(W * 0.5)}:-1,format=rgba,${tint(look.palette.accent)},colorchannelmixer=aa=0.3[ring]`);
      over('ring', `'W*0.25-w/2+60*sin(2*PI*t/9)'`, `'H*0.3-h/2+80*cos(2*PI*t/11)'`);
    }
  }

  if (recipe === 'flat-giant' || recipe === 'flat-frame') {
    const di = pushImg(sprite('dots.png'));
    fc.push(`[${di}:v]scale=${W}:-1,format=rgba,colorchannelmixer=aa=0.16[dots]`);
    over('dots', `'24*sin(2*PI*t/13)'`, `'26*cos(2*PI*t/17)'`);
    if (recipe === 'flat-frame') {
      const cw = Math.round(W * lookScene.cardScale);
      const bi2 = pushImg(sprite('card-border.png'));
      fc.push(`[${bi2}:v]scale=${cw}:-1,format=rgba,${tint(look.palette.ink)},colorchannelmixer=aa=0.85[cardb]`);
      over('cardb', '(W-w)/2', '(H-h)/2');
    } else {
      // accent bar under the headline zone
      const bw = Math.round(W * 0.42);
      const bi2 = pushLavfi(`color=c=${look.palette.accent}:s=${bw}x14:r=${FPS}:d=${dur}`);
      fc.push(`[${bi2}:v]format=rgba[bar]`);
      over('bar', '(W-w)/2', 'H*0.60');
    }
  }

  // ---------- finish ----------
  const vig = look.light ? '' : 'vignette=PI/5,';
  fc.push(`[${outPrev()}]${vig}noise=alls=4:allf=t,subtitles='${escFilterPath(assPath)}'[v]`);
  return { inputs, filter: fc.join(';'), map: '[v]' };
}

// Build the per-scene video filter chain (no audio in segments).
function segmentFilter(scene, idx, preset, W, H, assPath, mediaKind, kbIn) {
  const grade = GRADES[preset] || GRADES.cinematic;
  const sub = `subtitles='${escFilterPath(assPath)}'`;
  const dur = scene.duration;

  if (scene.logoMode) {
    // Dark card, centered logo, caption below.
    return {
      inputs: ['-f', 'lavfi', '-i', `color=c=0x0B0B0F:s=${W}x${H}:r=${FPS}:d=${dur}`, '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', scene.absMedia],
      filter:
        `[1:v]scale=${Math.round(W * 0.52)}:-1[lg];` +
        `[0:v][lg]overlay=(W-w)/2:(H-h)/2-${Math.round(H * 0.06)}[b];` +
        `[b]${grade},${sub}[v]`,
      map: '[v]',
    };
  }

  if (mediaKind === 'video') {
    return {
      inputs: ['-ss', String(scene.trimStart || 0), '-t', String(dur), '-i', scene.absMedia],
      filter:
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},` +
        `${grade},${sub}[v]`,
      map: '[v]',
    };
  }

  // Image: upscale then slow Ken Burns zoom (direction seeded per scene).
  const zoomExpr =
    kbIn ? `min(1+0.0009*on,1.15)` : `max(1.15-0.0009*on,1.0)`;
  return {
    inputs: ['-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', scene.absMedia],
    filter:
      `[0:v]scale=${Math.round(W * 1.25)}:-2,zoompan=z='${zoomExpr}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},` +
      `${grade},${sub}[v]`,
    map: '[v]',
  };
}

async function renderSceneSegment(scene, idx, project, W, H, workDir, look, lookScene) {
  const preset = project.preset || 'cinematic';
  const assPath = path.join(workDir, `scene_${idx}.ass`);
  const cap = lookScene ? { ...lookScene.caption } : undefined;
  if (cap && cap.bigWord && scene.text) {
    const words = scene.text.trim().split(/\s+/);
    cap.bigWordText = words.slice(0, 2).join(' ');
    cap.bigWordSize = lookScene.bigWordSize;
    cap.bigWordDrift = lookScene.bigWordDrift;
    cap.bigY = lookScene.bigY;
    cap.bigColor = (lookScene.bigWordAlpha || '&H38') + (look ? look.ink.slice(4) : 'FFFFFF');
  }
  fs.writeFileSync(assPath, makeSceneASS(scene, preset, W, H, idx === 0, cap), 'utf8');

  let mediaKind = null;
  if (scene.absMedia && scene.logoMode) {
    mediaKind = 'logo';
  } else if (scene.absMedia) {
    // Extension-based: ffprobe reports still images (png/jpeg) as video streams.
    mediaKind = /\.(jpe?g|png|webp|gif)$/i.test(scene.absMedia) ? 'image' : 'video';
  }

  const out = path.join(workDir, `seg_${idx}.mp4`);
  const common = ['-y', '-hide_banner', '-loglevel', 'error'];

  if (!scene.absMedia) {
    // No media: seeded procedural motion-graphics scene + kinetic caption.
    const spec = bgSpec(look, lookScene, W, H, scene.duration, assPath, workDir, idx);
    const args = [
      ...common,
      ...spec.inputs,
      '-filter_complex_threads', '1', '-filter_complex', spec.filter,
      '-map', spec.map,
      '-threads', '2', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', out,
    ];
    await run('ffmpeg', args);
    return out;
  }

  const spec = segmentFilter(scene, idx, preset, W, H, assPath, mediaKind, lookScene ? lookScene.kenBurnsIn : idx % 2 === 0);
  const args = [
    ...common,
    ...spec.inputs,
    '-filter_complex_threads', '1', '-filter_complex', spec.filter,
    '-map', spec.map,
    '-threads', '2', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', out,
  ];
  await run('ffmpeg', args);
  return out;
}

function transitionOffsets(durations, tdur) {
  // offsets[k] = start time (in the growing output) of the transition into scene k+1
  const offsets = [];
  let acc = durations[0];
  for (let k = 0; k < durations.length - 1; k++) {
    offsets.push(Math.max(0.1, acc - tdur));
    acc += durations[k + 1] - tdur;
  }
  return { offsets, total: acc };
}

async function renderProject(project, job, dirs) {
  const { W, H } = dimsFor(project.aspect);
  const preset = project.preset || 'cinematic';
  const scenes = project.scenes.filter((s) => s.text || s.media);
  if (!scenes.length) throw new Error('No scenes to render');

  // Fresh visual identity every render: new seed -> new palette, background
  // motion, caption styles and transition order, even for the same script.
  const seed = project.renderSeed != null ? project.renderSeed : Math.floor(Math.random() * 2147483647);
  const look = makeLook(seed, scenes.length, project.motionTheme);
  const trans = shuffledTransitions(seed, Math.max(1, scenes.length - 1));
  const tdur = trans.dur;
  job.message = `rendering scenes (look: ${look.palette.name})`;

  const workDir = path.join(dirs.tmp, job.id);
  fs.mkdirSync(workDir, { recursive: true });

  // Resolve media paths
  for (const s of scenes) {
    s.absMedia = s.media ? path.join(dirs.uploads, s.media) : null;
    if (s.absMedia && !fs.existsSync(s.absMedia)) s.absMedia = null;
  }

  // 1) Segments
  job.message = 'rendering scenes';
  const segs = [];
  for (let i = 0; i < scenes.length; i++) {
    segs.push(await renderSceneSegment(scenes[i], i, project, W, H, workDir, look, look.scenes[i]));
    job.progress = 0.05 + (0.55 * (i + 1)) / scenes.length;
  }

  const durations = scenes.map((s) => s.duration);
  const useXfade = scenes.length > 1;
  const { offsets, total } = useXfade
    ? transitionOffsets(durations, tdur)
    : { offsets: [], total: durations[0] };

  // 2) Final combine: xfade chain + audio mix
  job.message = 'transitions and audio mix';
  const inputs = [];
  for (const seg of segs) inputs.push('-threads', '1', '-i', seg);

  const musicFile = project.musicTrack ? path.join(dirs.music, project.musicTrack) : null;
  const hasMusic = musicFile && fs.existsSync(musicFile);
  const voFile = project.voiceover ? path.join(dirs.uploads, project.voiceover) : null;
  const hasVo = voFile && fs.existsSync(voFile);
  const sfxOn = project.sfxOn !== false;
  const whoosh = path.join(dirs.sfx, 'whoosh.wav');
  const impact = path.join(dirs.sfx, 'impact.wav');
  const hasSfx = sfxOn && fs.existsSync(whoosh);

  let musicIdx = -1, voIdx = -1, whooshIdx = -1, impactIdx = -1;
  let nextIdx = segs.length;
  if (hasMusic) { musicIdx = nextIdx++; inputs.push('-stream_loop', '-1', '-i', musicFile); }
  if (hasVo) { voIdx = nextIdx++; inputs.push('-i', voFile); }
  if (hasSfx) { whooshIdx = nextIdx++; inputs.push('-i', whoosh); }
  if (hasSfx && fs.existsSync(impact)) { impactIdx = nextIdx++; inputs.push('-i', impact); }

  const fc = [];
  let vlabel = '0:v';
  if (useXfade) {
    let prev = '0:v';
    for (let k = 0; k < segs.length - 1; k++) {
      const t = trans.list[k % trans.list.length];
      const out = k === segs.length - 2 ? 'xv0' : `x${k}`;
      fc.push(`[${prev}][${k + 1}:v]xfade=transition=${t}:duration=${tdur}:offset=${offsets[k].toFixed(3)}[${out}]`);
      prev = out;
    }
    vlabel = 'xv0';
  }
  // Global open/close fades
  fc.push(`[${vlabel}]fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0.1, total - 0.5).toFixed(3)}:d=0.5,format=yuv420p[xv]`);

  // Audio
  const audioOuts = [];
  if (hasVo) {
    const delayMs = Math.round((project.voiceoverStart ?? 0.25) * 1000);
    fc.push(`[${voIdx}:a]adelay=${delayMs}|${delayMs},apad,atrim=0:${total.toFixed(3)},volume=1.0[voc]`);
    fc.push(`[${voIdx}:a]adelay=${delayMs}|${delayMs},apad,atrim=0:${total.toFixed(3)},volume=1.0[voside]`);
    audioOuts.push('[voc]');
  }
  if (hasMusic) {
    const mv = project.musicVolume != null ? project.musicVolume : 0.5;
    fc.push(`[${musicIdx}:a]atrim=0:${total.toFixed(3)},volume=${mv}[mus0]`);
    if (hasVo) {
      fc.push(`[mus0][voside]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400:makeup=1[musd]`);
      audioOuts.push('[musd]');
    } else {
      fc.push(`[mus0]volume=0.9[musd]`);
      audioOuts.push('[musd]');
    }
  }
  if (hasSfx) {
    const spots = offsets.filter((_, i) => (i + seed) % 3 === 0).slice(0, 3);
    if (spots.length) {
      const parts = spots.map((_, i) => `[sw${i}]`).join('');
      fc.push(`[${whooshIdx}:a]asplit=${spots.length}${parts}`);
      spots.forEach((off, i) => {
        const speed = [0.85, 1.12, 0.96][(i + seed) % 3];
        const d = Math.round(off * 1000);
        fc.push(`[sw${i}]asetrate=${Math.round(44100*1)}*${speed},aresample=44100,adelay=${d}|${d},apad,atrim=0:${total.toFixed(3)},volume=0.20[swo${i}]`);
        audioOuts.push(`[swo${i}]`);
      });
    }
    if (impactIdx >= 0) {
      fc.push(`[${impactIdx}:a]adelay=0|0,apad,atrim=0:${total.toFixed(3)},volume=0.3[imp]`);
      audioOuts.push('[imp]');
    }
  }

  let amap;
  if (audioOuts.length === 0) {
    fc.push(`anullsrc=r=44100:cl=stereo:d=${total.toFixed(3)}[aout]`);
    amap = '[aout]';
  } else if (audioOuts.length === 1) {
    fc.push(`${audioOuts[0]}alimiter=limit=0.95,aresample=44100,aformat=channel_layouts=stereo[aout]`);
    amap = '[aout]';
  } else {
    fc.push(`${audioOuts.join('')}amix=inputs=${audioOuts.length}:duration=longest:normalize=0,alimiter=limit=0.95,atrim=0:${total.toFixed(3)},aresample=44100,aformat=channel_layouts=stereo[aout]`);
    amap = '[aout]';
  }

  const safeName = (project.title || 'reel').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'reel';
  const outName = `${safeName}-${Date.now()}.mp4`;
  const outPath = path.join(dirs.renders, outName);

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-stats',
    ...inputs,
    '-filter_complex_threads', '1', '-filter_complex', fc.join(';'),
    '-map', '[xv]', '-map', amap,
    '-threads', '2', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
    '-maxrate', '5M', '-bufsize', '10M',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-t', total.toFixed(3),
    outPath,
  ];

  await run('ffmpeg', args, (s) => {
    const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
    if (m) {
      const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
      job.progress = 0.6 + 0.38 * Math.min(1, t / total);
    }
  });

  // cleanup segments
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  job.progress = 1;
  return { outName, outPath, duration: total };
}

// Single-frame preview of a scene (caption + grade + media), as JPEG.
async function previewScene(scene, project, dirs, outFile) {
  const { W, H } = dimsFor(project.aspect);
  const preset = project.preset || 'cinematic';
  const workDir = path.join(dirs.tmp, 'preview');
  fs.mkdirSync(workDir, { recursive: true });
  const assPath = path.join(workDir, `pv_${Date.now()}.ass`);
  const look = makeLook(project.renderSeed || 12345, 1, project.motionTheme);
  fs.writeFileSync(assPath, makeSceneASS(scene, preset, W, H, false, { ...look.scenes[0].caption, look: look.scenes[0], theme: look.theme }), 'utf8');
  const grade = GRADES[preset] || GRADES.cinematic;
  const sub = `subtitles='${escFilterPath(assPath)}'`;
  const mid = Math.max(0.1, (scene.duration || 3) / 2);

  let args;
  const abs = scene.media ? path.join(dirs.uploads, scene.media) : null;
  const kind = abs && fs.existsSync(abs)
    ? (/\.(jpe?g|png|webp|gif)$/i.test(abs) ? 'image' : 'video')
    : null;

  const midFrame = Math.round(mid * FPS);
  if (scene.logoMode && abs) {
    args = ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x0B0B0F:s=${W}x${H}:r=${FPS}:d=${mid + 0.2}`,
      '-i', abs,
      '-filter_complex_threads', '1', '-filter_complex', `[1:v]scale=${Math.round(W * 0.52)}:-1[lg];[0:v][lg]overlay=(W-w)/2:(H-h)/2-${Math.round(H * 0.06)}[b];[b]${grade},${sub},select='eq(n,${midFrame})'[v]`,
      '-map', '[v]', '-frames:v', '1', '-q:v', '4', outFile];
  } else if (kind === 'video') {
    args = ['-y', '-loglevel', 'error',
      '-ss', String(scene.trimStart || 0), '-i', abs,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${grade},${sub},select='eq(n,${midFrame})'`,
      '-frames:v', '1', '-q:v', '4', outFile];
  } else if (kind === 'image') {
    args = ['-y', '-loglevel', 'error',
      '-loop', '1', '-framerate', String(FPS), '-t', String(mid + 0.2), '-i', abs,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${grade},${sub},select='eq(n,${midFrame})'`,
      '-frames:v', '1', '-q:v', '4', outFile];
  } else {
    const spec = bgSpec(look, look.scenes[0], W, H, mid + 0.2, assPath, workDir, Date.now());
    args = ['-y', '-loglevel', 'error', ...spec.inputs, '-filter_complex_threads', '1', '-filter_complex', spec.filter + `;[v]select='eq(n,${midFrame})'[pv]`, '-map', '[pv]', '-threads', '2', '-frames:v', '1', '-q:v', '4', outFile];
  }
  await run('ffmpeg', args);
  return outFile;
}

module.exports = { renderProject, previewScene, dimsFor };
