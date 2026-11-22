// AI voiceover via Gemini TTS. Requires GEMINI_API_KEY in the environment.
// Without a key the studio still works with uploaded voiceover audio.

const fs = require('fs');
const path = require('path');

const VOICES = [
  { id: 'Charon', label: 'Charon - male, firm' },
  { id: 'Orus', label: 'Orus - male, warm' },
  { id: 'Achird', label: 'Achird - male, friendly' },
  { id: 'Aoede', label: 'Aoede - female, bright' },
  { id: 'Kore', label: 'Kore - female, calm' },
];

function keySet() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

function writeWav(pcm, filePath, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

async function generateTTS(text, voiceId, outDir) {
  if (!keySet()) {
    return { ok: false, needsKey: true, message: 'GEMINI_API_KEY is not set' };
  }
  const voice = VOICES.some((v) => v.id === voiceId) ? voiceId : 'Orus';
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=' +
    encodeURIComponent(process.env.GEMINI_API_KEY.trim());

  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, message: `Gemini TTS failed (HTTP ${res.status}): ${errText.slice(0, 300)}` };
  }
  const json = await res.json();
  const b64 = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) return { ok: false, message: 'Gemini TTS returned no audio' };

  const pcm = Buffer.from(b64, 'base64');
  const file = path.join(outDir, `vo-${Date.now()}.wav`);
  writeWav(pcm, file, 24000);
  return { ok: true, file: path.basename(file) };
}

module.exports = { generateTTS, keySet, VOICES };
