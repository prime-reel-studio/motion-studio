// Render engine: scenes -> styled segments (Ken Burns, grade, kinetic captions)
// -> xfade transitions -> music ducking + SFX -> final MP4.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeSceneASS } = require('./ass');

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
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${errBuf.slice(-600)}`));
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
    proc.on('close', (code) => {
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

// Build the per-scene video filter chain (no audio in segments).
function segmentFilter(scene, idx, preset, W, H, assPath, mediaKind) {
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

  // Image: upscale then slow Ken Burns zoom (alternate in/out per scene).
  const zoomExpr =
    idx % 2 === 0 ? `min(1+0.0009*on,1.15)` : `max(1.15-0.0009*on,1.0)`;
  return {
    inputs: ['-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', scene.absMedia],
    filter:
      `[0:v]scale=${Math.round(W * 1.25)}:-2,zoompan=z='${zoomExpr}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},` +
      `${grade},${sub}[v]`,
    map: '[v]',
  };
}

async function renderSceneSegment(scene, idx, project, W, H, workDir) {
  const preset = project.preset || 'cinematic';
  const assPath = path.join(workDir, `scene_${idx}.ass`);
  fs.writeFileSync(assPath, makeSceneASS(scene, preset, W, H, idx === 0), 'utf8');

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
    // No media: dark animated card with a soft radial pulse behind the caption.
    const args = [
      ...common,
      '-f', 'lavfi', '-i', `color=c=0x0D0D12:s=${W}x${H}:r=${FPS}:d=${scene.duration}`,
      '-vf', `${GRADES[preset]},subtitles='${escFilterPath(assPath)}'`,
      '-threads', '2', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', out,
    ];
    await run('ffmpeg', args);
    return out;
  }

  const spec = segmentFilter(scene, idx, preset, W, H, assPath, mediaKind);
  const args = [
    ...common,
    ...spec.inputs,
    '-filter_complex', spec.filter,
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
  const trans = TRANSITIONS[preset] || TRANSITIONS.cinematic;
  const tdur = trans.dur;
  const scenes = project.scenes.filter((s) => s.text || s.media);
  if (!scenes.length) throw new Error('No scenes to render');

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
    segs.push(await renderSceneSegment(scenes[i], i, project, W, H, workDir));
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
  for (const seg of segs) inputs.push('-i', seg);

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
    const spots = offsets.slice(0, 6);
    if (spots.length) {
      const parts = spots.map((_, i) => `[sw${i}]`).join('');
      fc.push(`[${whooshIdx}:a]asplit=${spots.length}${parts}`);
      spots.forEach((off, i) => {
        const d = Math.round(off * 1000);
        fc.push(`[sw${i}]adelay=${d}|${d},apad,atrim=0:${total.toFixed(3)},volume=0.35[swo${i}]`);
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
    '-filter_complex', fc.join(';'),
    '-map', '[xv]', '-map', amap,
    '-threads', '2', '-filter_threads', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
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
  fs.writeFileSync(assPath, makeSceneASS(scene, preset, W, H, false), 'utf8');
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
      '-filter_complex', `[1:v]scale=${Math.round(W * 0.52)}:-1[lg];[0:v][lg]overlay=(W-w)/2:(H-h)/2-${Math.round(H * 0.06)}[b];[b]${grade},${sub},select='eq(n,${midFrame})'[v]`,
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
    args = ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x0D0D12:s=${W}x${H}:r=${FPS}:d=${mid + 0.2}`,
      '-vf', `${grade},${sub},select='eq(n,${midFrame})'`, '-frames:v', '1', '-q:v', '4', outFile];
  }
  await run('ffmpeg', args);
  return outFile;
}

module.exports = { renderProject, previewScene, dimsFor };
