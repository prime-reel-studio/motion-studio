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

// Entrance animations. rise/slide use \move, so they pin alignment via \an5 + absolute pos.
function entranceAnim(cap, W, H, zone) {
  const cy = zone === 'top' ? Math.round(H * 0.22) : zone === 'center' ? Math.round(H * 0.5) : Math.round(H * 0.78);
  const cx = Math.round(W / 2);
  switch (cap && cap.entrance) {
    case 'rise':
      return `{\\an5\\fad(150,150)\\move(${cx},${cy + 90},${cx},${cy},0,320)}`;
    case 'zoom':
      return `{\\fad(150,150)\\fscx40\\fscy40\\t(0,320,\\fscx100\\fscy100)}`;
    case 'rotate':
      return `{\\fad(150,150)\\frz-8\\fscx130\\fscy130\\t(0,320,\\frz0\\fscx100\\fscy100)}`;
    case 'slide':
      return `{\\an5\\fad(120,150)\\move(${Math.round(cx - W * 0.55)},${cy},${cx},${cy},0,320)}`;
    case 'pop':
    default:
      return `{\\fad(150,150)\\fscx118\\fscy118\\t(0,220,\\fscx100\\fscy100)}`;
  }
}

// Build a full ASS file for one scene segment (times relative to 0).
// cap (optional per-scene look): {zone: 'bottom'|'center'|'top', entrance, accent, sizeMul}
function makeSceneASS(scene, presetName, W, H, isHook, cap) {
  const p = PRESET_CAPTIONS[presetName] || PRESET_CAPTIONS.cinematic;
  const zone = (cap && cap.zone) || (isHook ? 'center' : 'bottom');
  const sizeMul = (cap && cap.sizeMul) || 1;
  const size = Math.round(H * (isHook ? p.sizeRatio * 1.35 : p.sizeRatio) * sizeMul);
  const usesMove = cap && (cap.entrance === 'rise' || cap.entrance === 'slide');
  const align = usesMove ? 5 : (zone === 'top' ? 8 : zone === 'center' ? 5 : 2);
  const marginV = zone === 'top' ? Math.round(H * 0.10) : Math.round(H * 0.13);
  const primary = (cap && cap.accent) || p.primary;
  const secondary = (cap && cap.ink) || p.accent;
  const box = (cap && cap.box) || p.box;
  const outline = (cap && cap.outline) || '&H64000000';
  const start = 0.25;
  const end = Math.max(start + 0.5, scene.duration - 0.15);
  const totalCs = Math.round((end - start) * 100);
  const words = karaokeWords(scene.text || '', totalCs);

  const anim = entranceAnim(cap, W, H, zone);

  // Giant display word drifting behind the caption (typo-poster recipes).
  let bigStyle = '';
  let bigEvent = '';
  if (cap && cap.bigWordText) {
    const bigSize = Math.round(H * ((cap && cap.bigWordSize) || 0.26));
    const cx = Math.round(W / 2);
    const cy = Math.round(H * ((cap && cap.bigY) || 0.42));
    const drift = (cap && cap.bigWordDrift) || 60;
    const durMs = Math.round(scene.duration * 1000);
    bigStyle = `\nStyle: Big, ${p.font}, ${bigSize}, ${cap.bigColor || '&H38FFFFFF'}, &H00FFFFFF, &H00000000, &H00000000, 1, 0, 0, 0, 100, 100, 1, 0, 1, 0, 0, 5, 20, 20, 20, 1`;
    bigEvent = `\nDialogue: 0,${ts(0)},${ts(end)},Big,,0,0,0,,{\\an5\\fad(300,300)\\move(${cx},${cy + drift},${cx},${cy - drift},0,${durMs})}${stripOverrideChars(cap.bigWordText)}`;
  }

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap, ${p.font}, ${size}, ${primary}, ${secondary}, ${outline}, ${box}, 1, 0, 0, 0, 100, 100, 1, 0, ${cap ? 1 : 3}, ${cap ? 1.5 : 16}, 0, ${align}, 70, 70, ${marginV}, 1${bigStyle}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text${bigEvent}
Dialogue: 1,${ts(start)},${ts(end)},Cap,,0,0,0,,${anim}${words}
`;
  return header;
}

module.exports = { makeSceneASS, PRESET_CAPTIONS };
