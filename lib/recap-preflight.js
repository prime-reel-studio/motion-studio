const {spawn}=require('child_process');
function probe(file){return new Promise((resolve,reject)=>{const p=spawn('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',file]);let out='';p.stdout.on('data',d=>out+=d);p.on('error',reject);p.on('close',c=>{try{if(c!==0)throw new Error('Unreadable media');resolve(JSON.parse(out));}catch(e){reject(e);}});});}
async function preflight(project,dirs){
 const path=require('path');const p=await probe(path.join(dirs.uploads,project.voiceover));const vo=Number(p.format?.duration);const total=project.scenes.reduce((n,s)=>n+s.duration,0);
 if(!Number.isFinite(vo))throw new Error('تعذر قراءة مدة التعليق الصوتي.');
 if(total<vo-.25)throw new Error(`مدة المشاهد ${total.toFixed(1)} ثانية، والتعليق ${vo.toFixed(1)} ثانية. زوّد مدد المشاهد أو ارفع تعليقًا أقصر، مش هنقطع الكلام تلقائيًا.`);
 if(total>vo+2.1)throw new Error(`المشاهد أطول من التعليق بحوالي ${(total-vo).toFixed(1)} ثانية. راجع التوقيت لتجنب صمت طويل.`);
 for(const s of project.scenes){const p=await probe(path.join(dirs.uploads,s.media));if(/\.(mp4|mov|mkv|webm)$/i.test(s.media)){const remaining=Number(p.format?.duration)-Number(s.trimStart||0);if(!Number.isFinite(remaining)||remaining+.09<s.duration)throw new Error('مقتطف الفيديو أقصر من مدة المشهد بعد القص. قلّل المدة أو استخدم صورة ثابتة بوضوح، مش هنجمّد آخر كادر ونسميه فيديو.');}}
}
module.exports={preflight,probe};
