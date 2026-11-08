// ============================================================================
// PROCEDURAL PIXEL-ART TEXTURES (canvas generated, no external assets)
// ============================================================================
import * as THREE from 'three';
import { mulberry } from './config.js';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function tex(c, opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = opts.linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = opts.mip === false ? (opts.linear ? THREE.LinearFilter : THREE.NearestFilter) : THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = opts.mip !== false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  t.anisotropy = opts.aniso || 4;
  return t;
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const FONT = '"Saira Condensed", "Arial Narrow", Impact, sans-serif';

// ---------------------------------------------------------------------------
// TURF with field markings. Floor covers [-FX,FX] x [-FZ,FZ]
// ---------------------------------------------------------------------------
export const FLOOR = { FX: 52, FZ: 76, PPM: 13 };
export function turfTexture(field, rain = 0) {
  const { FX, FZ, PPM } = FLOOR;
  const W = FX * 2 * PPM, H = FZ * 2 * PPM;
  const c = canvas(W, H), g = c.getContext('2d');
  const rng = mulberry(1234);
  const halfL = field.L / 2, halfW = field.W / 2;
  const toPx = (x, z) => [(x + FX) * PPM, (z + FZ) * PPM];
  // base grass with mow stripes
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let py = 0; py < H; py++) {
    const z = py / PPM - FZ;
    const stripe = Math.floor((z + 200) / 6) % 2;
    for (let px = 0; px < W; px++) {
      const x = px / PPM - FX;
      const inField = Math.abs(x) <= halfW + 3 && Math.abs(z) <= halfL + 3;
      let r = 72, gg = 150, b = 44;
      if (stripe) { r = 80; gg = 160; b = 48; }
      if (!inField) { r -= 6; gg -= 14; b -= 4; }
      // grass blades: vertical highlight streaks + dark tufts
      const n = rng();
      const k = (py * W + px) * 4;
      let dr = 0, dg = 0, db = 0;
      if (n < 0.1) { dr = -24; dg = -38; db = -14; }            // dark tuft
      else if (n < 0.2) { dr = -12; dg = -18; db = -8; }
      else if (n < 0.27) { dr = 28; dg = 30; db = 6; }          // sunlit tip (yellow-green)
      else if (n < 0.31) { dr = 44; dg = 44; db = 14; }
      // streak continuation from the pixel above for blade shapes
      if (py > 0 && rng() < 0.45) { const ku = k - W * 4; d[k] = d[ku] + (rng() * 6 - 3); d[k + 1] = d[ku + 1] + (rng() * 6 - 3); d[k + 2] = d[ku + 2]; d[k + 3] = 255; continue; }
      d[k] = r + dr + (rng() * 8 - 4); d[k + 1] = gg + dg + (rng() * 8 - 4); d[k + 2] = b + db;
      if (rain) { d[k] *= 0.82; d[k + 1] *= 0.86; d[k + 2] *= 0.95; }
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // markings
  g.fillStyle = 'rgba(250,250,245,0.96)';
  const lw = Math.max(2, Math.round(0.12 * PPM));
  const line = (x0, z0, x1, z1) => {
    const [a, b] = toPx(Math.min(x0, x1), Math.min(z0, z1)); const [cc, dd] = toPx(Math.max(x0, x1), Math.max(z0, z1));
    g.fillRect(Math.round(a - lw / 2), Math.round(b - lw / 2), Math.round(cc - a + lw), Math.round(dd - b + lw));
  };
  line(-halfW, -halfL, halfW, -halfL); line(-halfW, halfL, halfW, halfL);
  line(-halfW, -halfL, -halfW, halfL); line(halfW, -halfL, halfW, halfL);
  const gl = halfL - field.E;
  line(-halfW, -gl, halfW, -gl); line(-halfW, gl, halfW, gl);
  // brick marks (X)
  const brick = gl - field.E * 1.1;
  for (const s of [-1, 1]) {
    const [bx, bz] = toPx(0, s * brick);
    g.save(); g.translate(bx, bz); g.rotate(Math.PI / 4);
    g.fillRect(-PPM * 0.5, -lw / 2, PPM, lw); g.fillRect(-lw / 2, -PPM * 0.5, lw, PPM); g.restore();
  }
  // end-zone pylons area tint stripes
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z0 = s * (gl + 0.6 + i * field.E / 6);
      const [, pz] = toPx(0, z0);
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.fillRect(toPx(-halfW, 0)[0], pz, field.W * PPM, field.E / 12 * PPM);
    }
  }
  // centre logo: navy ellipse + ring + text
  const [cx, cz] = toPx(0, 0);
  g.save(); g.translate(cx, cz);
  const rx = Math.min(halfW * 0.62, 11) * PPM, rz = rx * 0.55;
  g.fillStyle = 'rgba(12,30,88,0.9)'; g.beginPath(); g.ellipse(0, 0, rx, rz, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(235,240,255,0.85)'; g.lineWidth = PPM * 0.35; g.beginPath(); g.ellipse(0, 0, rx * 0.93, rz * 0.9, 0, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(40,110,240,0.9)'; g.lineWidth = PPM * 0.25; g.beginPath(); g.ellipse(0, 0, rx * 0.8, rz * 0.75, 0, 0, Math.PI * 2); g.stroke();
  g.rotate(Math.PI);
  g.fillStyle = 'rgba(240,244,255,0.95)'; g.font = `800 ${Math.round(rz * 0.9)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('WUL', 0, 0);
  g.restore();
  // pixelate small details: slight darker edges near boards
  const t = tex(c, { aniso: 8 });
  return t;
}

// ---------------------------------------------------------------------------
// Athlete textures
// ---------------------------------------------------------------------------
export function jerseyTextures(team, number, name) {
  const mk = (back) => {
    const c = canvas(64, 64), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = hex(team.jersey); g.fillRect(0, 0, 64, 64);
    // side panels
    g.fillStyle = hex(team.panel); g.fillRect(0, 0, 9, 64); g.fillRect(55, 0, 9, 64);
    g.fillStyle = hex(team.trim); g.fillRect(9, 0, 2, 64); g.fillRect(53, 0, 2, 64);
    // collar
    g.fillStyle = hex(team.panel);
    if (back) g.fillRect(18, 0, 28, 4); else { g.beginPath(); g.moveTo(20, 0); g.lineTo(32, 10); g.lineTo(44, 0); g.fill(); }
    // hem
    g.fillStyle = hex(team.trim); g.fillRect(0, 60, 64, 4);
    g.fillStyle = team.num; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (back) {
      g.font = `800 9px ${FONT}`; g.fillText(name.slice(0, 9), 32, 10);
      g.font = `800 30px ${FONT}`; g.strokeStyle = hex(team.trim); g.lineWidth = 2;
      g.strokeText(String(number), 32, 38); g.fillText(String(number), 32, 38);
    } else {
      g.font = `800 16px ${FONT}`; g.fillText(String(number), 40, 26);
      g.fillStyle = hex(team.panel); g.fillRect(16, 20, 8, 8);
    }
    return tex(c, { mip: false });
  };
  return { front: mk(false), back: mk(true) };
}

export function faceTexture(skin, hair, gender, rng) {
  const c = canvas(32, 32), g = c.getContext('2d');
  const sh = (hexs, k) => { const n = parseInt(hexs.slice(1), 16); const r = Math.min(255, (n >> 16) * k) | 0, gg = Math.min(255, ((n >> 8) & 255) * k) | 0, b = Math.min(255, (n & 255) * k) | 0; return `rgb(${r},${gg},${b})`; };
  const p = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  p(0, 0, 32, 32, skin);
  p(0, 0, 3, 32, sh(skin, 0.85)); p(29, 0, 3, 32, sh(skin, 0.85));   // side shading
  p(0, 27, 32, 5, sh(skin, 0.86));                                  // jaw shadow
  p(0, 0, 32, gender === 'female' ? 7 : 5, hair); p(0, 5, 3, 6, hair); p(29, 5, 3, 6, hair);
  // brows (thick, slightly angled)
  p(6, 11, 8, 2, sh(hair, 1.0)); p(18, 11, 8, 2, sh(hair, 1.0)); p(12, 10, 2, 1, hair); p(18, 10, 2, 1, hair);
  // eyes
  p(7, 14, 6, 3, '#f6f2ee'); p(19, 14, 6, 3, '#f6f2ee');
  p(9, 14, 3, 3, '#3a2416'); p(21, 14, 3, 3, '#3a2416'); p(10, 15, 1, 1, '#0a0605'); p(22, 15, 1, 1, '#0a0605');
  p(7, 13, 6, 1, sh(skin, 0.6)); p(19, 13, 6, 1, sh(skin, 0.6));
  // nose
  p(15, 15, 2, 6, sh(skin, 0.9)); p(14, 20, 4, 2, sh(skin, 0.72));
  // mouth
  p(12, 24, 8, 1, sh(skin, 0.55)); p(13, 25, 6, 1, sh(skin, 0.8));
  // cheek warmth
  p(6, 19, 4, 2, sh(skin, 0.94)); p(22, 19, 4, 2, sh(skin, 0.94));
  if (gender === 'male' && rng() < 0.3) { p(6, 22, 20, 8, 'rgba(40,25,15,0.18)'); }
  if (gender === 'female') { p(7, 13, 6, 1, '#1a120c'); p(19, 13, 6, 1, '#1a120c'); }
  return tex(c, { mip: false });
}

export function skinSideTexture(skin, hair) {
  const c = canvas(16, 16), g = c.getContext('2d');
  g.fillStyle = skin; g.fillRect(0, 0, 16, 16);
  g.fillStyle = hair; g.fillRect(0, 0, 16, 4);
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(6, 7, 3, 4); // ear
  return tex(c, { mip: false });
}

// ---------------------------------------------------------------------------
// Stadium textures
// ---------------------------------------------------------------------------
export function ledRibbon(words, bg = '#0c1f5c', fg = '#e9f0ff', accent = '#ff3b30', h = 32) {
  const c = canvas(1024, h), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, bg); grd.addColorStop(1, '#07123a');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, h);
  g.font = `800 ${Math.round(h * 0.78)}px ${FONT}`; g.textBaseline = 'middle';
  let x = 10;
  let i = 0;
  while (x < 1024) {
    const w = words[i % words.length];
    if (w === '*') { g.fillStyle = accent; g.fillRect(x, h * 0.3, h * 0.4, h * 0.4); x += h * 0.9; }
    else { g.fillStyle = i % 5 === 0 ? accent : fg; g.fillText(w, x, h * 0.55); x += g.measureText(w).width + h * 0.9; }
    i++;
  }
  return tex(c, { repeat: [1, 1] });
}

export function bannerTexture(lines, opts = {}) {
  const W = opts.w || 128, H = opts.h || 256;
  const c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = opts.bg || '#132a6e'; g.fillRect(0, 0, W, H);
  g.fillStyle = opts.edge || '#c8202a'; g.fillRect(0, 0, W * 0.06, H);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(W * 0.06, 0, 3, H);
  g.fillStyle = opts.fg || '#e8eeff'; g.textAlign = 'left'; g.textBaseline = 'top';
  const fs = opts.fs || Math.round(W * 0.2);
  g.font = `800 ${fs}px ${FONT}`;
  lines.forEach((l, i) => g.fillText(l, W * 0.14, H * 0.08 + i * fs * 1.05));
  if (opts.figure) {
    // simple athlete silhouette catching a disc
    g.fillStyle = 'rgba(230,236,255,0.85)';
    const cx = W * 0.55, cy = H * 0.72, s = W / 128;
    g.beginPath(); g.arc(cx, cy - 34 * s, 7 * s, 0, 7); g.fill();
    g.fillRect(cx - 6 * s, cy - 26 * s, 12 * s, 26 * s);
    g.save(); g.translate(cx, cy - 22 * s); g.rotate(-0.9); g.fillRect(0, -3 * s, 30 * s, 6 * s); g.restore();
    g.save(); g.translate(cx, cy - 20 * s); g.rotate(2.6); g.fillRect(0, -3 * s, 22 * s, 6 * s); g.restore();
    g.save(); g.translate(cx - 3 * s, cy); g.rotate(1.9); g.fillRect(0, -3 * s, 30 * s, 7 * s); g.restore();
    g.save(); g.translate(cx + 3 * s, cy); g.rotate(0.7); g.fillRect(0, -3 * s, 30 * s, 7 * s); g.restore();
    g.beginPath(); g.ellipse(cx + 26 * s, cy - 50 * s, 9 * s, 3.5 * s, -0.4, 0, 7); g.fill();
  }
  if (opts.logo) drawWulLogo(g, W / 2, H * 0.55, W * 0.36);
  return tex(c);
}

export function drawWulLogo(g, x, y, r, sub = false) {
  g.save(); g.translate(x, y);
  g.strokeStyle = '#4b8cff'; g.lineWidth = r * 0.08;
  g.beginPath(); g.arc(0, -r * 0.2, r * 0.6, Math.PI, 0); g.stroke();
  g.beginPath(); g.ellipse(0, -r * 0.2, r * 0.6, r * 0.22, 0, Math.PI, 0); g.stroke();
  g.beginPath(); g.moveTo(0, -r * 0.8); g.lineTo(0, -r * 0.2); g.stroke();
  g.fillStyle = '#eef3ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${Math.round(r * 0.75)}px ${FONT}`; g.fillText('WUL', 0, r * 0.25);
  if (sub) { g.font = `700 ${Math.round(r * 0.22)}px ${FONT}`; g.fillStyle = '#9fc1ff'; g.fillText('WORLD ULTIMATE LEAGUE', 0, r * 0.75); }
  g.restore();
}

export function flagTexture(colors) {
  const c = canvas(32, 20), g = c.getContext('2d');
  colors.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * 20 / colors.length, 32, 20 / colors.length + 1); });
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(4, 6, 8, 8);
  return tex(c, { mip: false });
}

export function windowsTexture(seed, base = '#5d7598') {
  const rng = mulberry(seed);
  const c = canvas(64, 128), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 128);
  for (let y = 2; y < 128; y += 5) for (let x = 2; x < 64; x += 4) {
    const v = rng();
    g.fillStyle = v < 0.5 ? 'rgba(200,225,255,0.55)' : v < 0.8 ? 'rgba(140,170,210,0.5)' : 'rgba(40,60,90,0.5)';
    g.fillRect(x, y, 2, 3);
  }
  return tex(c, { repeat: [1, 1] });
}

export function suiteTexture() {
  const c = canvas(256, 32), g = c.getContext('2d');
  g.fillStyle = '#16233f'; g.fillRect(0, 0, 256, 32);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = '#7ea6d9'; g.fillRect(x + 2, 6, 12, 18);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 2, 6, 12, 4);
    g.fillStyle = '#0c1424'; g.fillRect(x, 0, 2, 32);
  }
  g.fillStyle = '#c62a2f'; g.fillRect(0, 28, 256, 4);
  return tex(c, { repeat: [1, 1] });
}

export function cloudTexture(seed) {
  const rng = mulberry(seed);
  const c = canvas(128, 64), g = c.getContext('2d');
  const blobs = [];
  for (let i = 0; i < 9; i++) blobs.push([20 + rng() * 88, 30 + rng() * 14, 10 + rng() * 16]);
  // pixel-art cloud: shade layers
  for (const [col, dy, k] of [['#b9cbe8', 3, 1], ['#e3ecfa', 0, 0.92], ['#ffffff', -3, 0.7]]) {
    g.fillStyle = col;
    for (const [x, y, r] of blobs) { g.beginPath(); g.arc(Math.round(x), Math.round(y + dy), Math.round(r * k), 0, 7); g.fill(); }
  }
  // posterize alpha edges
  const im = g.getImageData(0, 0, 128, 64);
  for (let i = 3; i < im.data.length; i += 4) im.data[i] = im.data[i] > 100 ? 255 : 0;
  g.putImageData(im, 0, 0);
  return tex(c, { mip: false });
}

export function discTopTexture() {
  const c = canvas(64, 64), g = c.getContext('2d');
  g.fillStyle = '#f7f8fb'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#d9dde6'; g.lineWidth = 2; g.beginPath(); g.arc(32, 32, 24, 0, 7); g.stroke(); g.beginPath(); g.arc(32, 32, 18, 0, 7); g.stroke();
  drawWolfMark(g, 21, 22, 2, '#1f56d6', '#ffffff');
  g.strokeStyle = '#d3262c'; g.lineWidth = 2; g.beginPath(); g.arc(32, 32, 29, 0, 7); g.stroke();
  return tex(c);
}

export function arrowTexture() {
  const c = canvas(32, 64), g = c.getContext('2d');
  g.fillStyle = 'rgba(120,220,255,0.95)';
  for (let i = 0; i < 4; i++) {
    const y = 50 - i * 14;
    g.beginPath(); g.moveTo(4, y + 8); g.lineTo(16, y); g.lineTo(28, y + 8); g.lineTo(28, y + 12); g.lineTo(16, y + 4); g.lineTo(4, y + 12); g.fill();
  }
  return tex(c, { mip: false });
}

export function videoBoardCanvas() { return canvas(512, 224); }
export function drawVideoBoard(c, s) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#1c3a9a'); grd.addColorStop(1, '#0a1748');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // LED grid
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  g.strokeStyle = '#ff4b3a'; g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12);
  if (s.mode === 'logo') {
    drawWulLogo(g, W / 2, H * 0.48, H * 0.5, true);
  } else {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 34px ${FONT}`; g.fillStyle = '#9fc1ff'; g.fillText(s.left, W * 0.25, H * 0.25);
    g.fillStyle = '#ffb4a8'; g.fillText(s.right, W * 0.75, H * 0.25);
    g.font = `800 96px ${FONT}`; g.fillStyle = '#fff';
    g.fillText(String(s.a), W * 0.25, H * 0.6); g.fillText(String(s.b), W * 0.75, H * 0.6);
    g.font = `800 30px ${FONT}`; g.fillStyle = '#ffd34d'; g.fillText(s.banner || 'WORLD ULTIMATE LEAGUE', W / 2, H * 0.88);
    g.fillStyle = '#fff'; g.font = `800 40px ${FONT}`; g.fillText('-', W / 2, H * 0.58);
  }
}

// HUD portrait (2D pixel face)
export function drawPortrait(c, app) {
  const g = c.getContext('2d');
  const S = c.width / 24;
  g.imageSmoothingEnabled = false;
  const grd = g.createLinearGradient(0, 0, 0, c.height); grd.addColorStop(0, '#3a6fd8'); grd.addColorStop(1, '#0c1d4f');
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * S, y * S, w * S, h * S); };
  const skin = app.skinCss, hair = app.hairCss;
  // shoulders / jersey
  px(3, 20, 18, 4, app.jerseyCss); px(9, 20, 6, 2, app.panelCss); px(3, 21, 3, 3, app.panelCss); px(18, 21, 3, 3, app.panelCss);
  px(10, 17, 4, 4, skin);
  // head
  px(7, 6, 10, 12, skin);
  px(6, 10, 1, 3, skin); px(17, 10, 1, 3, skin);
  // hair by style
  const st = app.hair;
  if (st === 'buzz') px(7, 5, 10, 2, hair);
  else if (st === 'mohawk') { px(11, 2, 3, 5, hair); }
  else { px(6, 3, 12, 4, hair); px(6, 6, 2, 4, hair); px(16, 6, 2, 4, hair); }
  if (st === 'curly') { px(5, 2, 3, 3, hair); px(9, 1, 3, 3, hair); px(13, 1, 3, 3, hair); px(16, 2, 3, 3, hair); }
  if (st === 'long' || st === 'ponytail') { px(5, 6, 2, 11, hair); px(17, 6, 2, 11, hair); }
  if (st === 'bun') px(9, 0, 6, 3, hair);
  // eyes
  px(9, 10, 2, 2, '#fff'); px(13, 10, 2, 2, '#fff'); px(10, 10, 1, 2, '#1a120c'); px(14, 10, 1, 2, '#1a120c');
  px(9, 9, 2, 1, hair); px(13, 9, 2, 1, hair);
  px(11, 12, 2, 2, 'rgba(0,0,0,0.15)'); px(10, 15, 4, 1, '#8a3b33');
}

// Cylindrical jersey wrap: u=0 front, 0.25 left side (+x), 0.5 back, 0.75 right side
export function jerseyWrap(team, number, name) {
  const W = 128, H = 64;
  const c = canvas(W, H), g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const J = hex(team.jersey), Pn = hex(team.panel), Tr = hex(team.trim);
  g.fillStyle = J; g.fillRect(0, 0, W, H);
  // clean side panels with a small stepped (pixel) edge
  g.fillStyle = Pn;
  for (const cx of [32, 96]) for (let y = 30; y < H; y += 4) { const w = 4 + Math.min(4, (y - 30) / 6) + ((y / 4) % 2); g.fillRect(cx - w, y, w * 2, 4); }
  // soft cloth shading toward the sides
  for (const cx of [32, 96]) { g.fillStyle = 'rgba(40,50,80,0.10)'; g.fillRect(cx - 14, 0, 28, 30); g.fillStyle = Pn; }
  // shoulder yoke
  g.fillStyle = Pn; g.fillRect(0, 0, W, 4);
  // v-neck collar at the front (wraps seam at u=0)
  g.fillStyle = Pn;
  for (const ox of [0, W]) { g.beginPath(); g.moveTo(ox - 11, 0); g.lineTo(ox, 12); g.lineTo(ox + 11, 0); g.lineTo(ox + 7, 0); g.lineTo(ox, 8); g.lineTo(ox - 7, 0); g.fill(); }
  // back collar
  g.fillRect(56, 0, 16, 3);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = team.num;
  // back: name + big number
  g.font = `800 40px ${FONT}`; g.fillText(String(number), 64, 30);
  // front: chest number (left of centre) and crest (right chest)
  g.font = `800 17px ${FONT}`; g.fillText(String(number), 116, 30);
  drawWolfMark(g, 5, 16, 1, Pn, '#ffffff');
  // hem
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, H - 2, W, 2);
  return tex(c, { mip: false });
}
export function sleeveTexture(team) {
  const c = canvas(32, 16), g = c.getContext('2d');
  g.fillStyle = hex(team.panel); g.fillRect(0, 0, 32, 16);
  g.fillStyle = hex(team.jersey); for (let x = 0; x < 32; x += 4) g.fillRect(x, 0, 4, (x / 4) % 2 ? 2 : 3);
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 13, 32, 3);
  g.fillStyle = '#ffffff'; g.fillRect(4, 6, 3, 3); // small crest patch on the outer sleeve
  return tex(c, { mip: false });
}
export function shortsLegTexture(team, number, withNum = true) {
  const c = canvas(64, 32), g = c.getContext('2d');
  g.fillStyle = hex(team.shorts); g.fillRect(0, 0, 64, 32);
  // jagged side stripe on the outside of the leg (u=0.25 is +x side; mirrored mesh for the other leg)
  g.fillStyle = hex(team.panel);
  g.fillRect(14, 0, 5, 32);
  // number on the front of the leg
  g.fillStyle = '#f2f4f8'; g.font = `800 11px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (withNum) g.fillText(String(number), 56, 21);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, 64, 2);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 29, 64, 3);
  return tex(c, { mip: false });
}
export function sockTexture(team) {
  const c = canvas(16, 16), g = c.getContext('2d');
  g.fillStyle = '#f4f5f8'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = hex(team.panel); g.fillRect(0, 4, 16, 2); g.fillRect(4, 6, 2, 5);
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, 16, 1);
  return tex(c, { mip: false });
}
export function shoeTexture(team) {
  const c = canvas(32, 16), g = c.getContext('2d');
  g.fillStyle = '#f4f4f6'; g.fillRect(0, 0, 32, 16);
  g.fillStyle = '#1a2348'; g.fillRect(0, 0, 32, 4); g.fillRect(0, 12, 32, 4); g.fillRect(12, 4, 8, 8);
  g.fillStyle = hex(team.panel); g.fillRect(4, 6, 6, 3); g.fillRect(22, 6, 6, 3);
  return tex(c, { mip: false });
}
export function shortsWrap(team) {
  const c = canvas(64, 16), g = c.getContext('2d');
  g.fillStyle = hex(team.shorts); g.fillRect(0, 0, 64, 16);
  g.fillStyle = hex(team.panel); g.fillRect(14, 0, 4, 16); g.fillRect(46, 0, 4, 16);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, 64, 2);
  return tex(c, { mip: false });
}

// ---------------------------------------------------------------------------
// CROWD SPRITE ATLAS — hand-placed pixel-art spectators (16x24 cells).
// 128 variants; rows 0-7 = seated / arms down, rows 8-15 = cheering, arms up.
// ---------------------------------------------------------------------------
export const CROWD_ATLAS = { cols: 16, rows: 16, cw: 16, ch: 24 };
export function crowdAtlas() {
  const { cols, cw, ch } = CROWD_ATLAS;
  const c = canvas(cols * cw, 16 * ch), g = c.getContext('2d');
  const rng = mulberry(31337);
  const shirts = ['#2f6cf0', '#1f4fc4', '#f3f1ea', '#e8e4da', '#d8322c', '#b52222', '#f28a2e', '#ffb03a', '#f6d050', '#ff7a3a',
    '#2a2c38', '#4a8cf0', '#e8603a', '#1b2a5a', '#f0c060', '#6aa0e8', '#ffffff', '#3fa34d', '#c9643e', '#8a8f9a'];
  const skins = ['#f6d3b8', '#e8b48f', '#d79a6e', '#b87a4f', '#8a5636', '#5e3a22'];
  const hairs = ['#1a120c', '#2a1a10', '#4a2c16', '#6b4520', '#c99a50', '#a33a1c', '#2a2a2a', '#bdbdbd'];
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; r = Math.min(255, r * k) | 0; gg = Math.min(255, gg * k) | 0; b = Math.min(255, b * k) | 0; return `rgb(${r},${gg},${b})`; };
  for (let v = 0; v < 128; v++) {
    const col = v % cols, row = Math.floor(v / cols);
    const shirt = shirts[Math.floor(rng() * shirts.length)], skin = skins[Math.floor(rng() * skins.length)];
    const hair = hairs[Math.floor(rng() * hairs.length)];
    const hat = rng() < 0.18 ? (rng() < 0.5 ? '#1f4fc4' : '#d8322c') : null;
    const longHair = rng() < 0.35, scarf = rng() < 0.22 ? (rng() < 0.5 ? '#1f56d6' : '#d3262c') : null;
    const wide = rng() < 0.4 ? 1 : 0;
    for (const up of [0, 1]) {
      const ox = col * cw, oy = (row + up * 8) * ch;
      const p = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(ox + x, oy + y, w, h); };
      const bob = up ? 0 : 1;
      const out = 'rgba(20,18,30,0.85)';
      // outline silhouette first (1px larger)
      p(4 - wide, 9 + bob, 8 + wide * 2, 15 - bob, out);
      p(4, 1 + bob, 8, 9, out);
      if (up) { p(1 - wide, 0, 3, 11, out); p(12 + wide, 0, 3, 11, out); } else { p(2 - wide, 11 + bob, 3, 9, out); p(11 + wide, 11 + bob, 3, 9, out); }
      // torso with side shading
      p(5 - wide, 10 + bob, 6 + wide * 2, 14 - bob, shirt);
      p(5 - wide, 10 + bob, 2, 14 - bob, shade(shirt, 1.12));
      p(9 + wide, 10 + bob, 2, 14 - bob, shade(shirt, 0.72));
      if (scarf) { p(5 - wide, 10 + bob, 6 + wide * 2, 2, scarf); p(6, 12 + bob, 2, 3, scarf); }
      // neck + head
      p(7, 9 + bob, 2, 1, shade(skin, 0.85));
      p(5, 2 + bob, 6, 7, skin);
      p(10, 3 + bob, 1, 6, shade(skin, 0.8));
      p(6, 5 + bob, 1, 1, '#1b130e'); p(9, 5 + bob, 1, 1, '#1b130e');
      p(7, 7 + bob, 2, 1, shade(skin, 0.7));
      // hair / hat
      if (hat) { p(4, 1 + bob, 8, 3, hat); p(4, 3 + bob, 9, 1, shade(hat, 0.75)); }
      else { p(5, 1 + bob, 6, 2, hair); p(5, 2 + bob, 1, 3, hair); p(10, 2 + bob, 1, 3, hair); if (longHair) { p(4, 3 + bob, 1, 6, hair); p(11, 3 + bob, 1, 6, hair); } }
      // arms
      if (up) {
        p(2 - wide, 1, 2, 10, shade(shirt, 0.95)); p(12 + wide, 1, 2, 10, shade(shirt, 0.8));
        p(2 - wide, 0, 2, 2, skin); p(12 + wide, 0, 2, 2, skin);
      } else {
        p(3 - wide, 12 + bob, 2, 7, shade(shirt, 0.95)); p(11 + wide, 12 + bob, 2, 7, shade(shirt, 0.78));
        p(3 - wide, 18 + bob, 2, 2, skin); p(11 + wide, 18 + bob, 2, 2, skin);
      }
    }
  }
  const t = tex(c, { mip: true });
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  return t;
}

// original wolf-head team mark (pixel art) used on jerseys and the disc
export function drawWolfMark(g, x, y, s, fill = '#1f56d6', light = '#ffffff') {
  const P = [
    '..X.....X..',
    '.XXX...XXX.',
    '.XXXXXXXXX.',
    'XXXXXXXXXXX',
    'XXLXXXXXLXX',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '..XXXLXXX..',
    '...XXXXX...',
    '....XXX....',
  ];
  for (let r = 0; r < P.length; r++) for (let c2 = 0; c2 < P[r].length; c2++) {
    const ch = P[r][c2]; if (ch === '.') continue;
    g.fillStyle = ch === 'L' ? light : fill; g.fillRect(x + c2 * s, y + r * s, s, s);
  }
}

// curly hair texture: dark base with lighter curl highlights (tiles on hair clumps)
export function curlTexture(hair) {
  const c = canvas(16, 16), g = c.getContext('2d');
  const rng = mulberry(5150);
  const n = parseInt(hair.replace('#', ''), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
  const col = (k) => `rgb(${Math.min(255, r * k) | 0},${Math.min(255, gg * k) | 0},${Math.min(255, b * k) | 0})`;
  g.fillStyle = col(0.8); g.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rng() * 14), y = Math.floor(rng() * 14);
    g.fillStyle = col(1.45); g.fillRect(x, y, 2, 1); g.fillRect(x + 1, y + 1, 1, 1);
    g.fillStyle = col(0.55); g.fillRect(x, y + 2, 2, 1);
  }
  const t = tex(c, { mip: false }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
