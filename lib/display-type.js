// Short, RAQM-shaped display beats. Text never enters a shell or a filter expression.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);

async function withDisplayType(spec, scene, idx, W, H, workDir, look) {
  if (!String(scene.text || '').trim()) return spec;
  const configFile = path.join(workDir, `type_${idx}.json`);
  fs.writeFileSync(configFile, JSON.stringify({
    W, H, duration: scene.duration, text: scene.text, index: idx,
    media: !!scene.absMedia, logo: !!scene.logoMode, outDir: workDir,
    ink: look.palette.ink, accent: look.palette.accent,
  }));
  const { stdout } = await exec('python3', [path.join(__dirname, 'display_type.py'), configFile]);
  const beats = JSON.parse(stdout);
  if (!beats.length) return spec;
  const inputs = [...spec.inputs];
  let inputIndex = inputs.filter(v => v === '-i').length;
  const fc = [spec.filter.replace(/\[v\]$/, '[typeBase]')];
  let last = 'typeBase';
  beats.forEach((beat, i) => {
    const n = inputIndex++;
    inputs.push('-threads', '1', '-loop', '1', '-framerate', '30', '-t', String(scene.duration), '-i', beat.file);
    const a = beat.start.toFixed(4), b = beat.end.toFixed(4);
    const fade = Math.min(.075, (beat.end-beat.start)/4).toFixed(4);
    fc.push(`[${n}:v]format=rgba,fade=t=in:st=${a}:d=${fade}:alpha=1,fade=t=out:st=${(beat.end-Number(fade)).toFixed(4)}:d=${fade}:alpha=1[letter${i}]`);
    const ease = `pow(max(0,1-(t-${a})/0.17),3)`;
    const x = `${beat.x}+${beat.entrance === 1 ? Math.round(W*.14) : 0}*${ease}`;
    const y = `${beat.y}+${beat.entrance === 1 ? 0 : (beat.entrance === 2 ? -Math.round(H*.035) : Math.round(H*.04))}*${ease}`;
    const next = i === beats.length-1 ? 'typed' : `typeStage${i}`;
    fc.push(`[${last}][letter${i}]overlay=x='${x}':y='${y}':enable='gte(t,${a})*lt(t,${b})':shortest=1[${next}]`);
    last = next;
  });
  fc.push(`[typed]zoompan=z='1+0.11*exp(-on/4)':d=1:x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':s=${W}x${H}:fps=30[v]`);
  return { inputs, filter: fc.join(';'), map: '[v]' };
}
module.exports = { withDisplayType };
