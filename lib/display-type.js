// Short, RAQM-shaped display beats. Text never enters a shell or a filter expression.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);

async function withDisplayType(spec, scene, idx, W, H, workDir, look) {
  if (!String(scene.text || '').trim() && !scene.credit) return spec;
  const configFile = path.join(workDir, `type_${idx}.json`);
  fs.writeFileSync(configFile, JSON.stringify({
    W, H, duration: scene.duration, text: scene.text, index: idx,
    credit: scene.credit, media: !!scene.absMedia, logo: !!(scene.logoMode || scene.portraitCard), outDir: workDir,
    ink: look.palette.ink, accent: look.palette.accent,
  }));
  const { stdout } = await exec('python3', [path.join(__dirname, 'display_type.py'), configFile]);
  const beats = JSON.parse(stdout);
  if (!beats.length) return spec;
  const inputs = [...spec.inputs];
  let inputIndex = inputs.filter(v => v === '-i').length;
  const fc = [spec.filter.replace(/\[v\]$/, '[typeBase]')];
  const words = beats.filter(b=>b.wordCount>0);
  const blank = beats.find(b=>b.wordCount===-1).file;
  const quote = file => "'" + file.replace(/'/g,"'\\''") + "'";
  const concat = ['ffconcat version 1.0'];
  const frame = (file,duration) => {if(duration>0.0001)concat.push('file '+quote(file),'duration '+duration.toFixed(5));};
  let cursor=0;
  for(const beat of words){frame(blank,beat.start-cursor);frame(beat.file,beat.end-beat.start);cursor=beat.end;}
  frame(blank,scene.duration-cursor);
  concat.push('file '+quote(blank));
  const file=path.join(workDir,`type_${idx}.ffconcat`);
  fs.writeFileSync(file,concat.join('\n')+'\n');
  const n=inputIndex++;
  inputs.push('-threads','1','-f','concat','-safe','0','-i',file);
  fc.push(`[${n}:v]fps=30,format=rgba[letters]`);
  const motion = axis => words.map(beat=>{
    const a=beat.start.toFixed(4),b=beat.end.toFixed(4);
    const amount=axis==='x'?(beat.entrance===1?Math.round(W*.14):0):(beat.entrance===1?0:beat.entrance===2?-Math.round(H*.035):Math.round(H*.04));
    return amount?`${amount}*between(t,${a},${b})*pow(max(0,1-(t-${a})/0.17),3)`:null;
  }).filter(Boolean).join('+')||'0';
  fc.push(`[typeBase][letters]overlay=x='${motion('x')}':y='${motion('y')}':shortest=1[typed0]`);
  const credit=beats.find(b=>b.wordCount===0);
  let last='typed0';
  if(credit){
    const n=inputIndex++;
    inputs.push('-threads','1','-loop','1','-framerate','30','-t',String(scene.duration),'-i',credit.file);
    fc.push(`[typed0][${n}:v]overlay=x=${credit.x}:y=${credit.y}:shortest=1[typed1]`);
    last='typed1';
  }
  fc.push(`[${last}]zoompan=z='1+0.11*exp(-on/4)':d=1:x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':s=${W}x${H}:fps=30[v]`);
  return { inputs, filter: fc.join(';'), map: '[v]' };
}
module.exports = { withDisplayType };
