// Seeded look generator v2: every render gets a fresh visual identity.
// Themes and scene recipes are extracted from Ahmed's three reference videos:
//   midnight = dark atmospheric, glass cards, glowing gems (ref 3)
//   gallery  = warm dark wall, spotlight cone, framed art (ref 1)
//   paper    = clean light 3D-infographic look, mono + one accent (ref 2)
//   pop      = bold flat color, giant display type, dot texture (refs 1+2)
// Same script re-rendered -> different theme/palette/recipes/transitions.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToAss(hex) {
  // '#rrggbb' -> '&HAABBGGRR' (opaque)
  const m = hex.replace('#', '');
  const r = m.slice(0, 2), g = m.slice(2, 4), b = m.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

const DARK_PALETTES = [
  { name: 'prime-gold', bg: ['#0B0B12', '#1A1407', '#0E1420', '#241A06'], blobs: ['#D3AD37', '#8A6B1E', '#3A5A8C'], accent: '#D3AD37', ink: '#FFFFFF' },
  { name: 'ocean',      bg: ['#04121F', '#062A3D', '#0A1A2E', '#0E3B4D'], blobs: ['#29C7D9', '#1E6FA8', '#7AE0C3'], accent: '#4FE0D2', ink: '#FFFFFF' },
  { name: 'sunset',     bg: ['#1A0714', '#2E0A1E', '#3D1226', '#12081F'], blobs: ['#FF7A3D', '#D93D7A', '#FFB84D'], accent: '#FFB84D', ink: '#FFFFFF' },
  { name: 'pitch',      bg: ['#04140A', '#07271A', '#0A3320', '#03100C'], blobs: ['#37D97A', '#1E8C5A', '#D3AD37'], accent: '#52E896', ink: '#FFFFFF' },
  { name: 'royal',      bg: ['#0C0620', '#1A0B33', '#24104A', '#0A0426'], blobs: ['#8C5AE8', '#5A3DB8', '#D3AD37'], accent: '#B894FF', ink: '#FFFFFF' },
  { name: 'ember',      bg: ['#170705', '#2B0E08', '#3D160B', '#100506'], blobs: ['#FF5A3D', '#D98A29', '#8C3D1E'], accent: '#FF8A52', ink: '#FFFFFF' },
  { name: 'arctic',     bg: ['#08131A', '#0E2230', '#14313F', '#060D14'], blobs: ['#7AC7E8', '#3D8CB8', '#E8F4FA'], accent: '#A8DFFF', ink: '#FFFFFF' },
  { name: 'neon-night', bg: ['#0A0A14', '#12122B', '#0D1B2E', '#160B26'], blobs: ['#3DD9D9', '#B83DE8', '#3D7AE8'], accent: '#52E8E8', ink: '#FFFFFF' },
];

const GALLERY_PALETTES = [
  { name: 'museum-gold', bg: ['#140D07', '#241708', '#1A1006', '#0E0A06'], blobs: ['#D3AD37', '#8A6B1E', '#5A3D1E'], accent: '#D3AD37', ink: '#F5EFE2' },
  { name: 'warm-brown',  bg: ['#171008', '#2B1C0E', '#1F1409', '#0F0A05'], blobs: ['#E8B84D', '#B8813D', '#8C5A1E'], accent: '#F0C96A', ink: '#F5EFE2' },
  { name: 'wine',        bg: ['#170810', '#2B0E1A', '#1F0A12', '#0E0509'], blobs: ['#E83D5A', '#8C1E3D', '#D3AD37'], accent: '#FF7A94', ink: '#F5ECEE' },
];

const PAPER_PALETTES = [
  { name: 'ivory-gold',  bg: ['#F2F0EC'], blobs: ['#D9D5CC', '#C9C4B8', '#E4E1DA'], accent: '#B8891E', ink: '#16161A' },
  { name: 'paper-blue',  bg: ['#EFF1F4'], blobs: ['#D5DAE2', '#C4CBD6', '#E2E6EC'], accent: '#1E5AA8', ink: '#14161C' },
  { name: 'paper-green', bg: ['#EFF3EF'], blobs: ['#D5DFD5', '#C2D0C2', '#E0E8E0'], accent: '#0E6A3D', ink: '#121713' },
  { name: 'paper-red',   bg: ['#F4EFEF'], blobs: ['#E2D5D5', '#D6C4C4', '#ECE0E0'], accent: '#B82E3D', ink: '#1A1415' },
];

const POP_COLORS = [
  { name: 'pop-green',  bg: ['#0E5A3D'], accent: '#F2C94C', ink: '#FFFFFF' },
  { name: 'pop-royal',  bg: ['#2B1E8C'], accent: '#52E8E8', ink: '#FFFFFF' },
  { name: 'pop-wine',   bg: ['#8C1E3D'], accent: '#FFD37A', ink: '#FFFFFF' },
  { name: 'pop-teal',   bg: ['#0E5A66'], accent: '#FFB84D', ink: '#FFFFFF' },
  { name: 'pop-amber',  bg: ['#B8741E'], accent: '#16161A', ink: '#FFFFFF' },
  { name: 'pop-night',  bg: ['#16162B'], accent: '#D3AD37', ink: '#FFFFFF' },
];

const THEMES = {
  midnight: { palettes: DARK_PALETTES, recipes: ['atmos-glass', 'glow-gems', 'typo-poster', 'spot-card'], light: false },
  gallery:  { palettes: GALLERY_PALETTES, recipes: ['gallery-frame', 'atmos-glass', 'typo-poster'], light: false },
  paper:    { palettes: PAPER_PALETTES, recipes: ['paper-card', 'paper-giant', 'paper-min'], light: true },
  pop:      { palettes: POP_COLORS, recipes: ['flat-giant', 'flat-frame', 'typo-poster'], light: false },
};
const THEME_NAMES = Object.keys(THEMES);

const RECIPE_ENTRANCES = {
  'atmos-glass': ['rise', 'zoom'],
  'glow-gems': ['pop', 'rotate'],
  'typo-poster': ['slide', 'zoom'],
  'spot-card': ['rise', 'pop'],
  'gallery-frame': ['pop', 'rise'],
  'paper-card': ['rise', 'pop'],
  'paper-giant': ['slide', 'zoom'],
  'paper-min': ['pop', 'rise'],
  'flat-giant': ['slide', 'zoom'],
  'flat-frame': ['pop', 'rotate'],
};

const RECIPE_ZONES = {
  'atmos-glass': 'center',
  'glow-gems': 'bottom',
  'typo-poster': 'bottom',
  'spot-card': 'center',
  'gallery-frame': 'center',
  'paper-card': 'center',
  'paper-giant': 'center',
  'paper-min': 'bottom',
  'flat-giant': 'center',
  'flat-frame': 'center',
};

const rnd = (rng, a, b) => a + rng() * (b - a);
const rint = (rng, a, b) => Math.floor(rnd(rng, a, b + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function floatMotion(rng) {
  return {
    ax: rint(rng, 40, 220), ay: rint(rng, 40, 260),
    tx: rnd(rng, 5, 11).toFixed(2), ty: rnd(rng, 6, 13).toFixed(2),
    phx: rnd(rng, 0, 6.28).toFixed(2), phy: rnd(rng, 0, 6.28).toFixed(2),
    cx: rnd(rng, 0.2, 0.8), cy: rnd(rng, 0.15, 0.85),
  };
}

// Per-render look.
function makeLook(seed, sceneCount) {
  const rng = mulberry32(seed);
  const themeName = pick(rng, THEME_NAMES);
  const theme = THEMES[themeName];
  const palette = pick(rng, theme.palettes);
  const inkAss = hexToAss(palette.ink);
  const accentAss = hexToAss(palette.accent);
  const scenes = [];
  let lastRecipe = null;
  for (let i = 0; i < sceneCount; i++) {
    let recipe = pick(rng, theme.recipes);
    if (recipe === lastRecipe && theme.recipes.length > 1) {
      recipe = theme.recipes[(theme.recipes.indexOf(recipe) + 1 + rint(rng, 0, theme.recipes.length - 2)) % theme.recipes.length];
    }
    lastRecipe = recipe;
    const corners = [...(palette.bg.length === 4 ? palette.bg : [palette.bg[0], palette.bg[0], palette.bg[0], palette.bg[0]])].sort(() => rng() - 0.5);
    const blobColors = palette.blobs || [palette.accent, '#FFFFFF', palette.bg[0]];
    const blobs = [];
    for (let b = 0; b < 3; b++) {
      blobs.push({
        color: blobColors[b % blobColors.length],
        size: rint(rng, 240, 560),
        alpha: rnd(rng, 0.28, 0.5).toFixed(2),
        sigma: rint(rng, 36, 64),
        ...floatMotion(rng),
      });
    }
    scenes.push({
      recipe,
      corners,
      blobs,
      hueRate: pick(rng, [0, 0, 6, -8, 10]),
      driftAx: rint(rng, 0, 120),
      driftAy: rint(rng, 0, 160),
      driftPx: rnd(rng, 7, 14).toFixed(2),
      driftPy: rnd(rng, 8, 16).toFixed(2),
      coneSway: rnd(rng, 8, 20).toFixed(2),
      conePeriod: rnd(rng, 7, 12).toFixed(2),
      gems: [0, 1, 2].map(() => ({
        scale: rnd(rng, 0.16, 0.34),
        spin: (rng() < 0.5 ? -1 : 1) * rnd(rng, 0.05, 0.22).toFixed(3),
        glowScale: rnd(rng, 1.7, 2.4),
        glowAlpha: rnd(rng, 0.35, 0.6),
        ...floatMotion(rng),
      })),
      cardScale: rnd(rng, 0.82, 0.95),
      bigWordSize: rnd(rng, 0.20, 0.30),  // fraction of H
      bigWordAlpha: theme.light ? pick(rng, ['&H14', '&H1C']) : pick(rng, ['&H28', '&H38', '&H48']),
      bigWordDrift: rint(rng, 30, 90),
      bigY: recipe === 'paper-giant' ? 0.24 : recipe === 'flat-giant' ? 0.30 : 0.42,
      caption: {
        zone: RECIPE_ZONES[recipe] || 'bottom',
        entrance: pick(rng, RECIPE_ENTRANCES[recipe] || ['pop']),
        accent: accentAss,
        ink: inkAss,
        box: theme.light ? '&H70F2F0EC' : '&H780A0A0E',
        outline: theme.light ? '&HA0E8E2D8' : '&H64000000',
        sizeMul: rnd(rng, 0.96, 1.18),
        bigWord: recipe === 'typo-poster' || recipe === 'paper-giant' || recipe === 'flat-giant',
      },
      kenBurnsIn: rng() < 0.5,
    });
  }
  return { theme: themeName, light: theme.light, palette, scenes, accent: accentAss, ink: inkAss };
}

// xfade pool (ffmpeg 4.4-safe), shuffled per render so transitions never cycle visibly.
const XFADE_POOL = [
  'fade', 'dissolve', 'fadeblack', 'fadewhite',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circleopen', 'circleclose', 'circlecrop', 'rectcrop', 'radial',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'pixelize', 'diagtl', 'diagbr', 'diagtr', 'diagbl', 'hblur',
];

function shuffledTransitions(seed, count) {
  const rng = mulberry32(seed ^ 0x9E3779B9);
  const pool = [...XFADE_POOL].sort(() => rng() - 0.5);
  const out = [];
  let last = null;
  for (let k = 0; k < count; k++) {
    let t = pool[k % pool.length];
    if (t === last) t = pool[(k + 1) % pool.length];
    out.push(t);
    last = t;
  }
  const rngD = mulberry32(seed ^ 0x51F15EED);
  const dur = rnd(rngD, 0.4, 0.62);
  return { list: out, dur: +dur.toFixed(2) };
}

module.exports = { makeLook, shuffledTransitions, mulberry32, hexToAss, PALETTES: DARK_PALETTES, THEMES };
