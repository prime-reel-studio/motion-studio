const crypto=require('crypto');
function digits(s){return String(s||'').replace(/[٠-٩]/g,x=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[۰-۹]/g,x=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x)));}
const ordinal={'الاولى':1,'الاولي':1,'الأولى':1,'الأولي':1,'الاول':1,'الأول':1,'الثانية':2,'الثانيه':2,'الثاني':2,'التالتة':3,'الثالثة':3,'الثالث':3,'الرابعة':4,'الرابع':4,'الخامسة':5,'الخامس':5,'السادسة':6,'السادس':6,'السابعة':7,'السابع':7,'الثامنة':8,'الثامن':8,'التاسعة':9,'التاسع':9,'العاشرة':10,'العاشر':10};
function parse(prompt){
 const s=digits(prompt).trim();if(!s||s.length>500)throw new Error('اكتب اسم المسلسل ورقم الحلقة في طلب قصير.');
 const marker=s.match(/(?:الحلق[ةه]|episode)\s*([\p{L}\d]+)/iu);let episode=marker?(Number(marker[1])||ordinal[marker[1]]):null;
 const seasonMarker=s.match(/(?:الجزء|الموسم|season)\s*([\p{L}\d]+)/iu);const season=seasonMarker?(Number(seasonMarker[1])||ordinal[seasonMarker[1]]):null;
 let series=s.replace(/^(?:من فضلك\s*)?(?:اعملي|اعمل لي|اعمل|عمل|لخص|لخّص|ملخص|summary of|recap)\s*/iu,'').replace(/^ملخص\s*/u,'').replace(/^(?:ل?مسلسل)\s*/u,'');
 series=series.replace(/(?:الحلق[ةه]|episode|الجزء|الموسم|season)\s*[\p{L}\d]+/giu,'').replace(/[،,.:؛!؟]/g,' ').replace(/\s+/g,' ').trim();
 if(!series||!episode||episode<1||episode>10000)return{series,episode:episode||null,season:season||null,ready:false,message:'حدد اسم المسلسل ورقم الحلقة بوضوح. لو له أكتر من جزء، اكتب الجزء كمان.'};
 return{series,episode,season:season||null,ready:true,needsIdentityReview:true,message:season?'الاسم ورقم الجزء والحلقة مستخرجون من طلبك، ولسه محتاجين مطابقة المصدر.':'رقم الجزء غير محدد. لا نفترض أحدث جزء أو نختار جزءًا بدلًا منك.'};
}
function norm(s){return digits(s).replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064B-\u065F\u0640]/g,'').toLowerCase();}
function classify(title,target){
 const t=norm(title);const series=norm(target.series).split(/\s+/).filter(Boolean);const seriesMatch=series.every(w=>t.includes(w));
 const nums=[...t.matchAll(/(?:الحلقه|episode|ep\.?)[\s_:#-]*0*(\d+)\b/gu)].map(x=>Number(x[1]));
 const episodeMatch=nums.includes(target.episode);const conflictingEpisode=nums.some(n=>n!==target.episode);
 const seasons=[...t.matchAll(/(?:الجزء|الموسم|season)[\s_:#-]*0*(\d+)\b/gu)].map(x=>Number(x[1]));
 const seasonMatch=target.season?seasons.includes(target.season):false;
 return{seriesMatch,episodeMatch,conflictingEpisode,seasonMatch,identityStatus:seriesMatch&&episodeMatch&&!conflictingEpisode&&(!target.season||seasonMatch)?'title_candidate':'unresolved',pixelsVerified:false,rightsStatus:'unverified',autoUsable:false};
}
const cache=new Map();
async function discover(target){
 if(!target?.ready)throw new Error('راجع اسم المسلسل ورقم الحلقة أولًا.');
 const key=JSON.stringify(target);const old=cache.get(key);if(old&&Date.now()-old.at<30*60*1000)return old.data;
 const url=new URL('https://archive.org/advancedsearch.php');const terms=target.series.replace(/["\\]/g,'');url.search=new URLSearchParams({q:`title:("${terms}") AND mediatype:movies`,output:'json',rows:'12','fl[]':'identifier,title,description,licenseurl'}).toString();
 const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'PrimePersonalRecap/1.0 (bounded on-demand metadata search)'}});if(!r.ok)throw new Error('بحث المصادر العامة غير متاح الآن. لم يتم جلب أي مقطع.');
 const j=await r.json();const items=(j.response?.docs||[]).filter(x=>/^[\w.-]+$/.test(x.identifier||'')).map(x=>({id:crypto.createHash('sha256').update(x.identifier).digest('hex').slice(0,16),title:String(x.title||'').slice(0,350),url:'https://archive.org/details/'+encodeURIComponent(x.identifier),licenseClaim:x.licenseurl||null,...classify(x.title||'',target)}));
 const rejectedCount=items.filter(x=>x.identityStatus!=='title_candidate').length;
 const candidates=items.filter(x=>x.identityStatus==='title_candidate');
 const data={target,provider:'Internet Archive metadata',items:candidates,rejectedCount,queriedAt:new Date().toISOString(),status:candidates.length?'candidates_need_review':'exact_episode_not_verified',automaticFootageReady:false,automaticScriptReady:false,automaticVoiceReady:false,message:'دي نتائج بحث في بيانات أرشيف عام، مش إثبات مصدر رسمي أو حقوق أو تطابق الصور. لا تحميل تلقائي ولا استبدال بحلقة تانية. عدم وجود نتيجة هنا مش معناه إن الحلقة مش موجودة.'};
 cache.set(key,{at:Date.now(),data});return data;
}
module.exports={parse,classify,discover};
