// Public-domain and attribution-only Commons images. No Google scraping.
// ShareAlike/unclear licenses are excluded from automatic assembly.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cache = new Map(), assets = new Map();
const agent = { 'User-Agent': 'MotionStudio/1.0 (licensed media search)' };
const names = [
  [/كريستيانو|رونالدو|cristiano|ronaldo/i,'Cristiano Ronaldo'],
  [/ليونيل|ميسي|lionel|messi/i,'Lionel Messi'],
  [/محمد صلاح|mohamed salah/i,'Mohamed Salah'],
  [/مبابي|mbapp[eé]/i,'Kylian Mbappe'], [/نيمار|neymar/i,'Neymar'],
  [/هالاند|haaland/i,'Erling Haaland'], [/رونالدينيو|ronaldinho/i,'Ronaldinho'],
];
function entity(text) { return names.find(([re])=>re.test(String(text||'')))?.[1] || ''; }
function clean(text) { return String(text||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim(); }
function safe(value) {
  const u=new URL(value);
  if(u.protocol!=='https:' || !['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname) || u.username || u.password || u.port) throw new Error('Untrusted Commons image host');
  return u.href;
}
async function search(query) {
  query=(entity(query)||String(query||'').trim()).slice(0,100);
  if(!query) return [];
  const old=cache.get(query.toLowerCase());
  if(old && Date.now()-old.time<86400000) return old.items;
  const url=new URL('https://commons.wikimedia.org/w/api.php');
  url.search=new URLSearchParams({action:'query',generator:'search',gsrsearch:`"${query.replace(/["\\]/g,'')}" "CC-BY" -"CC-BY-SA" filetype:bitmap`,gsrnamespace:'6',gsrlimit:'8',prop:'imageinfo',iiprop:'url|size|extmetadata|mime',iiurlwidth:'1280',format:'json',formatversion:'2'}).toString();
  const r=await fetch(url,{headers:agent,signal:AbortSignal.timeout(25000)});
  if(!r.ok) throw new Error(r.status===429?'Wikimedia حدّد الطلبات مؤقتا. ارفع صورة أو جرّب لاحقا.':'Wikimedia مش متاح حاليا. ارفع صورة للمشهد.');
  const d=await r.json();
  const wanted=query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/\s+/).filter(s=>s.length>2);
  const items=[];
  for(const p of d.query?.pages||[]) {
    const i=p.imageinfo?.[0]; if(!i || !/^image\/(jpeg|png)$/.test(i.mime||'')) continue;
    const m=i.extmetadata||{}, val=k=>clean(m[k]?.value);
    const license=val('LicenseShortName'), licenseUrl=val('LicenseUrl');
    const publicDomain=/^(CC0|Public domain)$/i.test(license);
    const by=/^CC BY [1-4]\.0$/i.test(license) && /^https?:\/\/creativecommons\.org\/licenses\/by\/[1-4]\.0\/?$/.test(licenseUrl);
    if(!publicDomain&&!by || val('NonFree')==='true') continue;
    if(i.width<720 || i.height<1000 || i.size>45*1024*1024) continue;
    const title=clean(p.title).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(!wanted.every(w=>title.includes(w))) continue;
    if(/statue|wax|painting|drawing|caricature|mural|graffiti/i.test(title)) continue;
    if(!String(i.descriptionurl).startsWith('https://commons.wikimedia.org/wiki/File:')) continue;
    let download;try{download=safe(i.url);}catch{continue;}
    const token='commons-'+crypto.randomBytes(14).toString('hex');
    const author=val('Attribution')||val('Artist');
    if(by&&!author)continue;
    const score=70+(i.height>i.width?25:0)-(/ and | vs | against /i.test(title)?18:0)+Math.min(8,i.width/400);
    const item={token,provider:'Wikimedia Commons',id:p.pageid,kind:'image',preview:(()=>{try{return safe(i.thumburl);}catch{return download;}})(),source:i.descriptionurl,author,license,licenseUrl,restrictions:val('Restrictions'),tags:clean(p.title).replace(/^File:/,''),width:i.width,height:i.height,score,autoEligible:true};
    assets.set(token,{...item,download,created:Date.now()});items.push(item);
  }
  items.sort((a,b)=>b.score-a.score);cache.set(query.toLowerCase(),{time:Date.now(),items});
  return items;
}
async function download(token,uploads) {
  const item=assets.get(token);
  if(!item||Date.now()-item.created>86400000)throw new Error('Search again to refresh this image');
  const r=await fetch(safe(item.download),{headers:agent,redirect:'error',signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw new Error(r.status===429?'Wikimedia حدّد تحميل الصور مؤقتا. ارفع الصورة بنفسك.':'تعذر تحميل صورة Wikimedia. ارفع الصورة بنفسك.');
  if(!/^image\/(jpeg|png)/.test(r.headers.get('content-type')||''))throw new Error('Unexpected Commons file type');
  if(+r.headers.get('content-length')>45*1024*1024)throw new Error('Commons image too large');
  let total=0;const chunks=[];
  for await(const chunk of r.body){total+=chunk.length;if(total>45*1024*1024)throw new Error('Commons image too large');chunks.push(chunk);}
  const png=/png/.test(r.headers.get('content-type'));
  const name=`commons-${item.id}-${crypto.randomBytes(3).toString('hex')}.${png?'png':'jpg'}`;
  fs.writeFileSync(path.join(uploads,name),Buffer.concat(chunks));
  const credit={provider:item.provider,title:item.tags,source:item.source,author:item.author,license:item.license,licenseUrl:item.licenseUrl,restrictions:item.restrictions,modifications:'Cropped and animated',downloadedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(uploads,name)+'.license.json',JSON.stringify(credit,null,2));
  return{name,kind:'image',url:'/uploads/'+name,credit};
}
module.exports={entity,search,download};
