const fs=require('fs');const path=require('path');const crypto=require('crypto');const {spawn}=require('child_process');
function validate(project,dirs){
 if(project.aspect!=='16:9')throw new Error('وضع ملخص المسلسلات حاليًا أفقي 16:9.');
 if(!Array.isArray(project.scenes)||!project.scenes.length||project.scenes.length>120)throw new Error('أضف من مشهد إلى 120 مشهد.');
 if(!project.voiceover||path.basename(project.voiceover)!==project.voiceover||!fs.existsSync(path.join(dirs.uploads,project.voiceover)))throw new Error('ارفع التعليق الصوتي أولًا.');
 let total=0;
 for(const s of project.scenes){
  if(!s.media||path.basename(s.media)!==s.media||!fs.existsSync(path.join(dirs.uploads,s.media)))throw new Error('كل مشهد محتاج صورة أو فيديو مرفوع. مش هنستبدل مشاهد الحلقة بميديا عشوائية.');
  if(!/\.(png|jpe?g|webp|mp4|mov|mkv|webm)$/i.test(s.media))throw new Error('صيغة الميديا غير مدعومة في الملخص.');
  s.duration=Number(s.duration);s.trimStart=Number(s.trimStart||0);
  if(!Number.isFinite(s.duration)||s.duration<.4||s.duration>30||!Number.isFinite(s.trimStart)||s.trimStart<0)throw new Error('راجع مدة وقص كل مشهد، المدة من 0.4 إلى 30 ثانية.');
  if(s.sourceCrop&&(!Array.isArray(s.sourceCrop)||s.sourceCrop.length!==4||s.sourceCrop.some(x=>!Number.isInteger(x)||x<0)||s.sourceCrop[2]<1||s.sourceCrop[3]<1))throw new Error('قص المصدر غير صالح.');
  total+=s.duration;
 }
 if(total>600)throw new Error('الحد الحالي للملخص عشر دقائق.');
 return total;
}
async function renderRecap(project,job,dirs){
 const duration=validate(project,dirs);const id=crypto.randomBytes(5).toString('hex');const outName='recap-'+id+'.mp4';const work=path.join(dirs.tmp,'recap-'+id);fs.mkdirSync(work,{recursive:true});const config=path.join(work,'config.json');fs.writeFileSync(config,JSON.stringify({project,uploads:dirs.uploads,output:path.join(dirs.renders,outName),work}));job.message='تركيب الملخص من الميديا والتعليق المرفوعين';
 await new Promise((resolve,reject)=>{const p=spawn('python3',[path.join(__dirname,'recap_render.py'),config]);let err='',pending='';p.stderr.on('data',d=>err=(err+d).slice(-1800));p.stdout.on('data',d=>{pending+=d;let pos;while((pos=pending.indexOf('\n'))>=0){const line=pending.slice(0,pos);pending=pending.slice(pos+1);try{const j=JSON.parse(line);if(j.progress!==undefined)job.progress=j.progress;}catch{}}});p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error('تعذر تصدير الملخص: '+err)));});
 const notes=['ملخص وتحليل مستقل. لا يوجد نشر تلقائي.','الصور والمقاطع ليست مرخصة تلقائيًا لمجرد رفعها أو إتاحة مصدرها. راجع حقوق النشر قبل النشر.',...project.scenes.map((s,i)=>`${i+1}. ${s.sourceUrl||'مصدر غير مسجل'} | ${s.rightsNote||'حالة الحقوق غير موثقة'}`)].join('\n');const creditName=outName.replace('.mp4','-sources.txt');fs.writeFileSync(path.join(dirs.renders,creditName),notes);return{outName,duration,creditsUrl:'/renders/'+creditName};
}
module.exports={validate,renderRecap};
