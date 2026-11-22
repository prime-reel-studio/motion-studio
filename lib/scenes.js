// Script breakdown: paragraphs/sentences -> scenes with suggested durations.
// Works for Arabic and English, fully local (no AI key needed).

const SENTENCE_RE = /[^.!?؟…\n]+[.!?؟…]*/g;

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Arabic VO reads at roughly 2.3-2.6 words/sec. Add a small beat per scene.
function estimateDuration(text) {
  const words = countWords(text);
  const d = words / 2.4 + 0.5;
  return Math.min(14, Math.max(2, Math.round(d * 10) / 10));
}

function splitSentences(paragraph) {
  const matches = paragraph.match(SENTENCE_RE);
  if (!matches) return [paragraph.trim()].filter(Boolean);
  return matches.map((s) => s.trim()).filter(Boolean);
}

// Split a long paragraph into chunks of at most maxWords words, on sentence boundaries.
function chunkSentences(sentences, maxWords) {
  const chunks = [];
  let current = [];
  let currentWords = 0;
  for (const s of sentences) {
    const w = countWords(s);
    if (current.length > 0 && currentWords + w > maxWords) {
      chunks.push(current.join(' '));
      current = [s];
      currentWords = w;
    } else {
      current.push(s);
      currentWords += w;
    }
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}

let counter = 0;
function nextId() {
  counter += 1;
  return 'sc' + Date.now().toString(36) + '_' + counter;
}

function breakdown(script) {
  const paragraphs = (script || '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const scenes = [];
  for (const p of paragraphs) {
    const words = countWords(p);
    if (words <= 18) {
      scenes.push(makeScene(p));
    } else {
      for (const chunk of chunkSentences(splitSentences(p), 14)) {
        scenes.push(makeScene(chunk));
      }
    }
  }
  return scenes;
}

function makeScene(text) {
  return {
    id: nextId(),
    text,
    duration: estimateDuration(text),
    media: null, // filename in uploads/
    trimStart: 0, // seconds into a video upload
    logoMode: false, // render media as centered logo on dark card
  };
}

module.exports = { breakdown, estimateDuration };
