// ============================================================================
// CONFIG — teams, field formats, athlete attributes, settings
// ============================================================================

// Teams: kit colours (jersey body, panel = sleeves/side panels, trim, shorts, socks, shoes, number colour) + logo icon.
const T = (key, city, name, icon, jersey, panel, trim, shorts, sock, shoe, num) => ({
  key, city, name, icon, jersey, panel, trim, shorts, sock, shoe, num,
  css: '#' + panel.toString(16).padStart(6, '0'), dark: '#' + trim.toString(16).padStart(6, '0'),
});
export const TEAMS = {
  skyline:  T('skyline',  'RIVER CITY',   'SKYLINE',   'skyline', 0xf2f4f8, 0x1f56d6, 0x0b2a72, 0x161d3a, 0xf2f4f8, 0x1b2a55, '#1f56d6'),
  blaze:    T('blaze',    'BAY AREA',     'BLAZE',     'flame',   0x1c1b20, 0xd3262c, 0x8a1016, 0x141316, 0x1c1b20, 0xb51f24, '#ff4a3a'),
  tide:     T('tide',     'HARBOR CITY',  'TIDE',      'wave',    0x0f7f86, 0xf2f4f8, 0x08474c, 0x0b2f36, 0x0f7f86, 0xf2f4f8, '#ffffff'),
  summit:   T('summit',   'GRANITE PEAK', 'SUMMIT',    'mountain',0x5b6573, 0xffb020, 0x2e343c, 0x22272e, 0x5b6573, 0x22272e, '#ffb020'),
  solar:    T('solar',    'SUNVALE',      'SOLAR',     'sun',     0xffc21a, 0xff6a13, 0x9a3b00, 0x2b2b2b, 0xffc21a, 0x2b2b2b, '#9a3b00'),
  timber:   T('timber',   'NORTHWOOD',    'TIMBER',    'tree',    0x1f6b3a, 0xc9a26b, 0x0f3a1f, 0x1a1a1a, 0x1f6b3a, 0x5a3a1a, '#f0e6d0'),
  loons:    T('loons',    'LAKESHORE',    'LOONS',     'bird',    0x151a2b, 0xf4f4f6, 0x9fb4d0, 0x151a2b, 0xf4f4f6, 0x151a2b, '#ffffff'),
  mesa:     T('mesa',     'DESERT MESA',  'SCORCH',    'compass', 0xe8d5b0, 0xb5482a, 0x6b2412, 0x6b2412, 0xe8d5b0, 0x6b2412, '#b5482a'),
  volt:     T('volt',     'METRO',        'VOLT',      'bolt',    0x1d1d24, 0xd4ff1f, 0x5a6b00, 0x1d1d24, 0x1d1d24, 0xd4ff1f, '#d4ff1f'),
  reef:     T('reef',     'CORAL BAY',    'REEF',      'swirl',   0xff7a6b, 0x1fc0c9, 0x8a2a20, 0x1d3d55, 0xff7a6b, 0x1d3d55, '#ffffff'),
  glacier:  T('glacier',  'FROSTLINE',    'GLACIER',   'flake',   0xdff3ff, 0x3aa0e8, 0x1a4f80, 0x1a4f80, 0xdff3ff, 0x1a4f80, '#1a4f80'),
  forge:    T('forge',    'IRONWORKS',    'FORGE',     'gear',    0x7a2a1a, 0xff8a1a, 0x2a0e08, 0x2a2a2a, 0x7a2a1a, 0x2a2a2a, '#ffd08a'),
  comets:   T('comets',   'PRAIRIE',      'COMETS',    'comet',   0x5b2bd6, 0xffd34d, 0x2a1170, 0x2a1170, 0x5b2bd6, 0x2a1170, '#ffd34d'),
  kestrels: T('kestrels', 'CANYON',       'KESTRELS',  'wing',    0xc22a6e, 0x222228, 0x6a0f38, 0x222228, 0xc22a6e, 0x222228, '#ffffff'),
  owls:     T('owls',     'MIDNIGHT',     'OWLS',      'moon',    0x23214f, 0x7fe0d0, 0x0f0e2a, 0x0f0e2a, 0x23214f, 0x7fe0d0, '#7fe0d0'),
  crowns:   T('crowns',   'KINGSPORT',    'CROWNS',    'crown',   0x6d1530, 0xe8c35a, 0x3a0a18, 0x3a0a18, 0x6d1530, 0x3a0a18, '#e8c35a'),
};
export const TEAM_KEYS = Object.keys(TEAMS);

// If two kits are too similar, the away side wears an alternate (dark body, light number).
const lum = (c) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return 0.299 * r + 0.587 * g + 0.114 * b; };
const cdist = (a, b) => Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255));
export function kitsClash(a, b) { return cdist(TEAMS[a].jersey, TEAMS[b].jersey) < 110 || Math.abs(lum(TEAMS[a].jersey) - lum(TEAMS[b].jersey)) < 40 && cdist(TEAMS[a].panel, TEAMS[b].panel) < 120; }
export function teamKit(key, away = false) {
  const t = TEAMS[key];
  if (!away) return t;
  const light = lum(t.jersey) > 140;
  const jersey = light ? t.trim : 0xf2f4f8;
  return { ...t, jersey, sock: jersey, num: light ? '#ffffff' : t.dark, alt: true };
}

// Original team logos (SVG, 40x40 viewBox)
export function teamLogo(key) {
  const t = TEAMS[key]; const P = t.css, D = t.dark, J = '#' + t.jersey.toString(16).padStart(6, '0'), N = t.num;
  const shield = `<path d="M20 2 L37 9 L35 27 L20 38 L5 27 L3 9 Z" fill="${D}" stroke="${P}" stroke-width="2"/>`;
  const icons = {
    skyline: `<path d="M9 26 V18 H12 V14 H15 V20 H18 V9 H22 V16 H25 V12 H28 V22 H31 V26 Z" fill="#e9f1ff"/>`,
    flame: null,
    wave: `<path d="M7 24 C11 17 15 17 18 21 C21 25 25 25 28 19 C30 15 33 16 33 16 C31 23 27 29 21 29 C15 29 11 26 7 24 Z" fill="${J === '#f2f4f8' ? P : '#f2f4f8'}"/><path d="M8 30 H32" stroke="${P}" stroke-width="2"/>`,
    mountain: `<path d="M6 29 L16 12 L21 20 L25 15 L34 29 Z" fill="${P}"/><path d="M16 12 L19 17 L13 17 Z" fill="#fff"/>`,
    sun: `<circle cx="20" cy="20" r="7" fill="${P}"/>` + [...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<path d="M${20 + Math.cos(a) * 9} ${20 + Math.sin(a) * 9} L${20 + Math.cos(a) * 14} ${20 + Math.sin(a) * 14}" stroke="${J}" stroke-width="3"/>`; }).join(''),
    tree: `<path d="M20 7 L29 22 L24 22 L31 31 L9 31 L16 22 L11 22 Z" fill="${P}"/><rect x="18" y="31" width="4" height="4" fill="#c9a26b"/>`,
    bird: `<path d="M8 22 C13 15 19 15 22 19 C25 14 30 13 34 15 C29 16 27 20 26 24 C22 28 14 28 8 22 Z" fill="#f4f4f6"/><circle cx="29" cy="16" r="1.4" fill="#e03030"/>`,
    compass: `<circle cx="20" cy="20" r="12" fill="none" stroke="${P}" stroke-width="2"/><path d="M20 7 L23 20 L20 33 L17 20 Z" fill="${P}"/><path d="M7 20 L20 17 L33 20 L20 23 Z" fill="${J}"/>`,
    bolt: `<path d="M23 5 L11 22 H19 L16 35 L29 17 H21 Z" fill="${P}"/>`,
    swirl: `<path d="M20 10 C27 10 31 16 29 22 C27 28 19 29 16 25 C13 21 16 16 20 17 C23 18 23 22 20 22" fill="none" stroke="${P}" stroke-width="3"/>`,
    flake: [0, 1, 2].map(i => `<path d="M20 7 V33 M15 10 L20 14 L25 10 M15 30 L20 26 L25 30" stroke="${P}" stroke-width="2.4" fill="none" transform="rotate(${i * 60} 20 20)"/>`).join(''),
    gear: `<circle cx="20" cy="20" r="8" fill="none" stroke="${P}" stroke-width="5" stroke-dasharray="4 2.3"/><circle cx="20" cy="20" r="3" fill="${P}"/>`,
    comet: `<circle cx="26" cy="15" r="5" fill="${P}"/><path d="M22 18 L8 31 M24 20 L13 32 M20 16 L7 26" stroke="${P}" stroke-width="2.4" opacity=".8"/>`,
    wing: `<path d="M7 26 C12 14 22 9 34 9 C29 12 27 15 26 18 C30 18 32 19 33 20 C27 21 24 23 22 27 C17 28 12 28 7 26 Z" fill="${N}"/>`,
    moon: `<path d="M24 8 C16 9 11 15 12 22 C13 29 20 33 27 31 C21 29 18 24 19 18 C20 13 22 10 24 8 Z" fill="${P}"/><circle cx="27" cy="15" r="1.6" fill="${P}"/><circle cx="31" cy="21" r="1.2" fill="${P}"/>`,
    crown: `<path d="M8 28 L9 13 L15 20 L20 10 L25 20 L31 13 L32 28 Z" fill="${P}"/><rect x="8" y="29" width="24" height="3" fill="${P}"/>`,
  };
  if (t.icon === 'flame') return '<path d="M20 2 C26 10 33 14 31 25 C30 33 24 38 20 38 C14 38 8 33 9 25 C10 18 15 16 15 9 C18 13 18 16 19 18 C21 13 21 7 20 2 Z" fill="#ff5a1f" stroke="#ffd34d" stroke-width="1.5"/><path d="M20 20 C24 25 25 29 22 33 C20 35 16 34 16 30 C16 27 19 25 20 20 Z" fill="#ffd34d"/>';
  return shield + (icons[t.icon] || '');
}

// Field formats: total length L, end-zone depth E, width W (metres)
export const FIELDS = {
  2: { L: 52, E: 9, W: 21 },
  3: { L: 62, E: 11, W: 25 },
  4: { L: 72, E: 13, W: 28 },
  5: { L: 82, E: 15, W: 32 },
  6: { L: 92, E: 16.5, W: 35 },
  7: { L: 100, E: 18, W: 37 },
};

export const DEFAULTS = {
  athlete: {
    name: 'ALEX CHEN', number: 12, role: 'handler', height: 'taller', gender: 'male', hand: 'right',
    skin: 2, hairColor: 0, hair: 'curly',
  },
  settings: {
    teamSize: 5, duration: 100, rules: 'usau', difficulty: 'normal', team: 'skyline',
    wind: 'random', windDir: 'N', windSpeed: 6, rain: 'random', weatherPreset: 'random',
    assist: 'assisted', sensitivity: 1.0, swipeScale: 1.0, invertY: false, graphics: 'high',
    volume: 0.7, muted: false, stallSeconds: 1.0, opponent: 'blaze',
  },
};

export const SKIN_TONES = ['#f6d3b8', '#e8b48f', '#c98d63', '#a46a43', '#7a4a2c', '#53311d'];
export const HAIR_COLORS = ['#2a1a10', '#4a2c16', '#0f0f12', '#8a5a2b', '#d9b26a', '#a33a1c', '#c9c9c9'];
export const HAIR_STYLES = ['short', 'curly', 'buzz', 'ponytail', 'bun', 'long', 'mohawk'];
export const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Gameplay attributes derived from role + build
export function makeAttrs(role, height) {
  const a = {
    run: 5.4, sprint: 7.4, accel: 8.0, decel: 11, turnPenalty: 1.0,
    sprintDrain: 30, sprintRegen: 16, enduranceDrain: 0.55, enduranceRegen: 0.35,
    maxThrow: 26, throwErr: 1.0, windCtrl: 1.0, breakSkill: 1.0,
    reach: 2.2, jumpV: 3.7, lowCatch: 1.0, highCatch: 1.0, scale: 1.0, longRunBonus: 0,
  };
  if (role === 'handler') {
    a.sprint = 7.05; a.sprintDrain = 19; a.sprintRegen = 11; a.enduranceDrain = 0.7; a.enduranceRegen = 0.3;
    a.maxThrow = 29; a.throwErr = 0.55; a.windCtrl = 0.55; a.breakSkill = 1.25;
  } else {
    a.sprint = 7.75; a.sprintDrain = 13; a.sprintRegen = 15; a.enduranceDrain = 0.42; a.enduranceRegen = 0.42;
    a.maxThrow = 24.5; a.throwErr = 1.3; a.windCtrl = 1.15; a.breakSkill = 0.8;
  }
  if (height === 'taller') {
    a.accel *= 0.84; a.decel *= 0.88; a.turnPenalty = 1.25; a.reach = 2.42; a.jumpV = 3.85;
    a.lowCatch = 0.82; a.highCatch = 1.18; a.scale = 1.07; a.longRunBonus = 0.06;
  } else {
    a.accel *= 1.18; a.decel *= 1.12; a.turnPenalty = 0.8; a.reach = 2.1; a.jumpV = 3.6;
    a.lowCatch = 1.2; a.highCatch = 0.86; a.scale = 0.94; a.longRunBonus = -0.02;
  }
  return a;
}

const FIRST = ['TORI', 'MASON', 'JAY', 'SAM', 'RILEY', 'KAI', 'NOOR', 'DEV', 'ELLA', 'MILO', 'ZOE', 'LEO', 'IVY', 'OMAR',
  'NIA', 'FINN', 'AVA', 'THEO', 'MAYA', 'COLE', 'JUNE', 'RAFA', 'LENA', 'BEN', 'SKYE', 'ARI', 'TESS', 'MAX'];
export function botNames(rng, n) {
  const pool = FIRST.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0] || ('P' + i));
  return out;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
