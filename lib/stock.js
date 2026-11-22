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
function suggest(text) {
  const hit = topics.find(([re]) => re.test(text || ''));
  if (hit) return hit[1];
  const english = String(text || '').match(/[A-Za-z]{3,}/g);
  return english ? english.slice(0, 5).join(' ') : '';
}
function safeURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !['cdn.pixabay.com', 'pixabay.com', 'videos.pexels.com', 'images.pexels.com'].includes(u.hostname) || u.username || u.password || u.port) throw new Error('Untrusted stock media host');
  return u.href;
}
async function search(query, kind = 'video') {
  const apiKey = key();
  if (!apiKey) throw new Error('Stock API is not configured');
  query = String(query || '').trim().slice(0, 100);
  if (!query) throw new Error('Add a short English search phrase for this scene');
  kind = kind === 'image' ? 'image' : 'video';
  const ck = kind + ':' + query.toLowerCase();
  const cacheFile = path.join(SETTINGS, 'stock-cache-' + crypto.createHash('sha256').update(ck).digest('hex') + '.json');
  let old = cache.get(ck);
  if (!old) { try { old = JSON.parse(fs.readFileSync(cacheFile)); } catch {} }
  if (old && Date.now() - old.time < 86400000) {
    for (const c of old.candidates || []) candidates.set(c.token, c);
    cache.set(ck, old); return old.items;
  }
  const url = new URL(kind === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/');
  url.search = new URLSearchParams({ key: apiKey, q: query, safesearch: 'true', per_page: '8', ...(kind === 'image' ? { image_type: 'photo' } : {}) }).toString();
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(25000) }); } catch { throw new Error('Stock provider is not responding'); }
  if (!response.ok) throw new Error(response.status === 429 ? 'Stock rate limit reached. Try later.' : 'Stock provider request failed (' + response.status + ')');
  const data = await response.json();
  const items = [];
  for (const h of data.hits || []) {
    const media = kind === 'video' ? (h.videos.medium?.url ? h.videos.medium : h.videos.small) : null;
    const download = kind === 'video' ? media?.url : (h.largeImageURL || h.webformatURL);
    const preview = kind === 'video' ? (media?.thumbnail || h.videos.small?.thumbnail) : h.webformatURL;
    if (!download || !preview) continue;
    try { safeURL(download); safeURL(preview); } catch { continue; }
    if (!String(h.pageURL).startsWith('https://pixabay.com/')) continue;
    const token = crypto.randomBytes(14).toString('hex');
    const item = { token, provider: 'Pixabay', id: h.id, kind, preview, source: h.pageURL, author: h.user, tags: h.tags, duration: h.duration || null };
    candidates.set(token, { ...item, download, created: Date.now() });
    items.push(item);
  }
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
module.exports = { keySet: () => !!key(), suggest, search, download };
