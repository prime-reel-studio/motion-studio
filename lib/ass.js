// ASS subtitle generation with kinetic typography.
// libass shapes Arabic correctly (RTL + ligatures) and supports karaoke
// word highlighting + animated transforms, which gives us word-by-word
// caption motion that stays perfectly synced to the suggested timing.

// NOTE: with the system libass, modern geometric Arabic fonts (Cairo, Tajawal,
// Noto Sans Arabic) fail to shape the lam-alef ligature. Noto Naskh Arabic
// shapes everything correctly, so it is the caption font for all presets.
const CAPTION_FONT = 'Noto Naskh Arabic';

const PRESET_CAPTIONS = {
  cinematic: {
    // karaoke: words start white (secondary) and turn accent once "sung" (primary)
    font: CAPTION_FONT,
    primary: '&H0037AFD4', // gold (BGR)
    accent: '&H00FFFFFF', // white
    box: '&H780A0A0E',
    sizeRatio: 0.05,
  },
  sports: {
    font: CAPTION_FONT,
    primary: '&H00008CFF', // vivid orange (BGR)
    accent: '&H00FFFFFF',
    box: '&H78060608',
    sizeRatio: 0.056,
  },
  minimal: {
    font: CAPTION_FONT,
    primary: '&H00C9A227', // soft accent (BGR)
    accent: '&H00F2F2F2',
    box: '&H50101010',
    sizeRatio: 0.044,
  },
  club: {
    font: CAPTION_FONT,
    primary: '&H0047D7FF', // bright club gold (BGR)
    accent: '&H00FFFFFF',
    box: '&H7A000000',
    sizeRatio: 0.052,
  },
};

function stripOverrideChars(t) {
  return t.replace(/[{}\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Split scene text into words with per-word karaoke durations (centiseconds).
function karaokeWords(text, totalCs) {
  const words = stripOverrideChars(text).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const weights = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, '').length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let used = 0;
  return words
    .map((w, i) => {
      let cs = i === words.length - 1 ? totalCs - used : Math.max(8, Math.round((totalCs * weights[i]) / sum));
      cs = Math.max(5, cs);
      used += cs;
      return `{\\k${cs}}${w}`;
    })
    .join(' ');
}

function ts(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s - h * 3600 - m * 60;
  return `${h}:${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
}

// Build a full ASS file for one scene segment (times relative to 0).
function makeSceneASS(scene, presetName, W, H, isHook) {
  const p = PRESET_CAPTIONS[presetName] || PRESET_CAPTIONS.cinematic;
  const size = Math.round(H * (isHook ? p.sizeRatio * 1.35 : p.sizeRatio));
  const align = isHook ? 5 : 2; // hook centered, captions lower third
  const marginV = Math.round(H * 0.13);
  const start = 0.25;
  const end = Math.max(start + 0.5, scene.duration - 0.15);
  const totalCs = Math.round((end - start) * 100);
  const words = karaokeWords(scene.text || '', totalCs);

  // Pop-in: scale 118% -> 100% over 220ms, fade in/out, karaoke sweep word by word.
  const anim = `{\\fad(150,150)\\fscx118\\fscy118\\t(0,220,\\fscx100\\fscy100)}`;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap, ${p.font}, ${size}, ${p.primary}, ${p.accent}, &H64000000, ${p.box}, 1, 0, 0, 0, 100, 100, 1, 0, 3, 16, 0, ${align}, 70, 70, ${marginV}, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${ts(start)},${ts(end)},Cap,,0,0,0,,${anim}${words}
`;
  return header;
}

module.exports = { makeSceneASS, PRESET_CAPTIONS };
