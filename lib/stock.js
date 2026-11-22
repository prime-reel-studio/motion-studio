// Pixabay legal-stock adapter. API responses cached for 24h. Only API-returned
// assets from provider CDNs can be downloaded, never client-supplied URLs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const SETTINGS = path.join(__dirname, '..', 'settings');
const KEY_FILE = path.join(SETTINGS, 'stock.json');
const cache = new Map();
const candidates = new Map();
function key() {
  if (process.env.PIXABAY_API_KEY) return process.env.PIXABAY_API_KEY.trim();
  try { return JSON.parse(fs.readFileSync(KEY_FILE)).pixabay || ''; } catch { return ''; }
}
const topics = [
  [/كورة|كرة|ماتش|مبارا|ملعب|قدم|football|soccer/i, 'soccer football'],
  [/تدريب|تمرين|training|fitness/i, 'sports training'],
  [/كأس|بطول|جايزة|كاس|trophy/i, 'trophy victory'],
  [/بحر|شاط|ساحل|beach|sea/i, 'sea beach'],
  [/قهو|كافيه|coffee/i, 'coffee cafe'],
  [/اكل|أكل|طعام|مطبخ|مطعم|food/i, 'food cooking'],
  [/سفر|طيران|رحل|travel/i, 'travel airplane'],
  [/جبل|جبال|mountain/i, 'mountain landscape'],
  [/طبيع|غاب|شجر|nature/i, 'forest nature'],
  [/مدينة|شوارع|مدين|city/i, 'city street'],
  [/مصر|قاهر|egypt/i, 'egypt cairo'],
  [/شغل|عمل|شركة|مكتب|business/i, 'business office'],
  [/تعليم|مدرس|دراس|كتاب|education/i, 'education books'],
  [/فلوس|مال|اقتصاد|money/i, 'finance money'],
  [/تقني|تكنولوج|كمبيوتر|برمج|technology/i, 'technology computer'],
  [/صحة|طب|مستشف|health/i, 'healthcare medicine'],
  [/نجوم|سماء|فضاء|space/i, 'stars space'],
  [/سيار|عربي|car\b/i, 'car road'],
  [/ورد|زهور|flower/i, 'flowers garden'],
  [/شمس|غروب|sunset/i, 'sunset sky'],
  [/مطر|شتاء|rain/i, 'rain winter'],
  [/سعاد|فرح|happy/i, 'happiness celebration'],
];
// A named person is not interchangeable with generic footage. Never silently
// substitute an aerial stadium or illustration for a request for that person.
function namedEntity(text) {
  return /رونالدو|كريستيانو|ميسي|ليونيل|محمد صلاح|مبابي|نيمار|هالاند|رونالدينيو|ronaldo|cristiano|messi|lionel|mbapp[eé]|neymar|haaland|mohamed salah/i.test(String(text || ''));
}
function suggest(text) {
  text = String(text || '');
  if (namedEntity(text)) return '';
  const football = /كورة|كرة|ماتش|مبارا|ملعب|قدم|football|soccer/i.test(text);
  if (football && /تدريب|تمرين|تدرب|training|practice/i.test(text)) return 'soccer training';
  if (football && /طفل|أطفال|اطفال|ناشئ|براعم|kids|children/i.test(text)) return 'kids soccer';
  if (/هدف|أهداف|اهداف|تسديد|مرمى|goal|shooting/i.test(text) && football) return 'soccer goal';
  if (/ملعب|stadium/i.test(text)) return 'soccer stadium';
  if (football) return 'soccer ball';
  const hit = topics.find(([re]) => re.test(text));
  if (hit) return hit[1];
  const english = text.match(/[A-Za-z]{3,}/g);
  return english ? english.slice(0, 5).join(' ') : '';
}
const synonyms = {
  soccer:['soccer','football'], football:['soccer','football'],
  training:['training','practice','drill','drills'],
  ball:['ball','soccer','football'], stadium:['stadium','arena','pitch','field'],
  goal:['goal','goalkeeper','scoring','shooting'], kids:['kids','child','children','youth','boy','boys','junior'],
  city:['city','urban','town','buildings','downtown'], street:['street','road','traffic','urban'],
  food:['food','meal','cooking','kitchen','chef','vegetables'], cooking:['cooking','kitchen','chef','food','cook'],
  sports:['sport','sports','fitness','athlete','athletes'], beach:['beach','seaside','coast'], sea:['sea','ocean','water']
};
function relevance(query, hit, width, height, aspect) {
  const tags = String(hit.tags || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2 && !['the','and','with','for'].includes(t));
  if (!terms.length || /cartoon|animation|animated|render|illustration|robot|symbol|logo|flame/.test(tags.join(' '))) return null;
  if (/training/.test(query) && /drone|aerial/.test(tags.join(' '))) return null;
  if (/soccer|football/.test(query) && /american football|rugby/.test(String(hit.tags).toLowerCase())) return null;
  // Every concrete query component must be represented in source metadata.
  const matches = terms.map(t => (synonyms[t] || [t]).some(s=>tags.includes(s)));
  if (matches.some(x=>!x)) return null;
  if (Math.min(width,height)<720 || width*height<900000) return null;
  const portrait = height>width;
  const fit = aspect === '9:16' ? (portrait ? 28 : 0) : aspect === '16:9' ? (!portrait ? 20 : 0) : 10;
  return 60 + fit + Math.min(10,Math.log10(1+(hit.likes||0))*3) + Math.min(8,Math.min(width,height)/200);
}
function safeURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !['cdn.pixabay.com', 'pixabay.com', 'videos.pexels.com', 'images.pexels.com'].includes(u.hostname) || u.username || u.password || u.port) throw new Error('Untrusted stock media host');
  return u.href;
}
async function search(query, kind = 'video', aspect = '9:16') {
  const apiKey = key();
  if (!apiKey) throw new Error('Stock API is not configured');
  query = String(query || '').trim().slice(0, 100);
  if (namedEntity(query)) throw new Error('الشخص ده محتاج صورة أو فيديو ترفعه بنفسك. مش هنبدله بلقطة عامة.');
  if (!query) throw new Error('Add a short English search phrase for this scene');
  kind = kind === 'image' ? 'image' : 'video';
  const ck = 'rank-v3:' + kind + ':' + aspect + ':' + query.toLowerCase();
  const cacheFile = path.join(SETTINGS, 'stock-cache-' + crypto.createHash('sha256').update(ck).digest('hex') + '.json');
  let old = cache.get(ck);
  if (!old) { try { old = JSON.parse(fs.readFileSync(cacheFile)); } catch {} }
  if (old && Date.now() - old.time < 86400000) {
    for (const c of old.candidates || []) candidates.set(c.token, c);
    cache.set(ck, old); return old.items;
  }
  const url = new URL(kind === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/');
  url.search = new URLSearchParams({ key: apiKey, q: query, safesearch: 'true', per_page: '40', order: 'popular', ...(kind === 'image' ? { image_type: 'photo' } : {}) }).toString();
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(25000) }); } catch { throw new Error('Stock provider is not responding'); }
  if (!response.ok) throw new Error(response.status === 429 ? 'Stock rate limit reached. Try later.' : 'Stock provider request failed (' + response.status + ')');
  const data = await response.json();
  const items = [];
  for (const h of data.hits || []) {
    const media = kind === 'video' ? ['large','medium','small'].map(k=>h.videos[k]).find(v=>v?.url && v.size < 95*1024*1024 && Math.min(v.width,v.height)>=720) : null;
    const width = media?.width || h.imageWidth || 0, height = media?.height || h.imageHeight || 0;
    const score = relevance(query,h,width,height,aspect);
    if (score == null) continue;
    const download = kind === 'video' ? media?.url : (h.largeImageURL || h.webformatURL);
    const preview = kind === 'video' ? (media?.thumbnail || h.videos.small?.thumbnail) : h.webformatURL;
    if (!download || !preview) continue;
    try { safeURL(download); safeURL(preview); } catch { continue; }
    if (!String(h.pageURL).startsWith('https://pixabay.com/')) continue;
    const token = crypto.randomBytes(14).toString('hex');
    const item = { token, score, width, height, orientation: height>width?'portrait':'landscape', autoEligible:true, provider: 'Pixabay', id: h.id, kind, preview, source: h.pageURL, author: h.user, tags: h.tags, duration: h.duration || null };
    candidates.set(token, { ...item, download, created: Date.now() });
    items.push(item);
  }
  items.sort((a,b)=>b.score-a.score);
  items.splice(12);
  const cached = { time: Date.now(), items, candidates: items.map(i => candidates.get(i.token)) };
  cache.set(ck, cached);
  fs.mkdirSync(SETTINGS, { recursive:true, mode:0o700 });
  fs.writeFileSync(cacheFile, JSON.stringify(cached), {mode:0o600});
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  for (const [t,c] of candidates) if (Date.now()-c.created > 86400000) candidates.delete(t);
  return items;
}
async function download(token, uploads) {
  const item = candidates.get(token);
  if (!item || Date.now() - item.created > 86400000) throw new Error('Search again to refresh this asset');
  const name = 'stock-pixabay-' + item.id + '-' + crypto.randomBytes(3).toString('hex') + (item.kind === 'video' ? '.mp4' : '.jpg');
  const dest = path.join(uploads, name);
  let url = safeURL(item.download), response;
  for (let i = 0; i < 4; i++) {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if ([301,302,303,307,308].includes(response.status)) { url = safeURL(new URL(response.headers.get('location'), url).href); continue; }
    break;
  }
  if (!response?.ok || !/^(image|video)\//.test(response.headers.get('content-type') || '')) throw new Error('Stock download failed');
  if (+response.headers.get('content-length') > 100 * 1024 * 1024) throw new Error('Stock asset is too large');
  let bytes = 0;
  const limiter = async function* (source) { for await (const chunk of source) { bytes += chunk.length; if (bytes > 100*1024*1024) throw new Error('Stock asset is too large'); yield chunk; } };
  try { await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(dest)); }
  catch { fs.rmSync(dest, { force:true }); throw new Error('Stock download interrupted'); }
  const credit = { provider:item.provider, source:item.source, author:item.author, id:item.id, downloadedAt:new Date().toISOString(), license:'https://pixabay.com/service/terms/' };
  fs.writeFileSync(dest+'.license.json', JSON.stringify(credit, null, 2));
  return { name, kind:item.kind, url:'/uploads/'+name, credit };
}
module.exports = { keySet: () => !!key(), suggest, namedEntity, search, download };
