// ============================================================================
// MAIN — renderer, camera, input & swipe throwing, HUD, menus, game loop
// ============================================================================
import * as THREE from 'three';
import { Stadium } from './stadium.js';
import { AthleteView } from './athleteView.js';
import { PixelPipeline } from './post.js';
import { Game, DT } from '../../shared/game.js';
import { Audio } from './audio.js';
import { loadSaved, save } from './storage.js';
import { TEAMS, TEAM_KEYS, teamLogo, DEFAULTS, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, WIND_DIRS, makeAttrs } from '../../shared/config.js';
import { MS_TO_MPH } from '../../shared/weather.js';
import { discTopTexture, arrowTexture, drawPortrait } from './textures.js';
import { voxelize, sampler } from './voxel.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const store = loadSaved();
const audio = new Audio();
audio.vol = store.settings.volume; audio.muted = store.settings.muted;

// ---------------------------------------------------------------- renderer
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('loading').textContent = 'WebGL is not available in this browser.';
  throw e;
}
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const pipe = new PixelPipeline(renderer);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa9cff3, 220, 1200);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 3200);
const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x7c9a4e, 1.55); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c0, 3.0);
sun.position.set(26, 75, -34); sun.castShadow = true;
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 200; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun); scene.add(sun.target);

let quality = store.settings.graphics;
let stadium = new Stadium(scene, quality);
// art-pixel size scales with window height (reference look ~ 400 art pixels tall)
// Sunny-Time-style: render the whole world at one coarse resolution and scale up with no smoothing
const PIXROWS = { high: 330, medium: 300, low: 260 };
let dynScale = 1, fpsAcc = 0, fpsN = 0;
// adaptive resolution: if the frame rate stays low, render the pixel buffer at a coarser scale
function adapt(dt) {
  fpsAcc += dt; fpsN++;
  if (fpsAcc < 4) return;
  const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
  if (fps < 40 && dynScale < 1.6) { dynScale = Math.min(1.6, dynScale + 0.15); resize(); }
  else if (fps > 57 && dynScale > 1) { dynScale = Math.max(1, dynScale - 0.1); resize(); }
}
function applyQuality() {
  quality = store.settings.graphics;
  const sm = quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 0;
  renderer.shadowMap.enabled = sm > 0;
  if (sm) { sun.shadow.mapSize.set(sm, sm); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  pipe.mat.uniforms.dither.value = quality === 'low' ? 0 : 1;
  pipe.mat.uniforms.outline.value = quality === 'low' ? 0 : 0.45;
  resize();
}
function rebuildStadium() {
  scene.remove(stadium.group);
  stadium.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  stadium = new Stadium(scene, store.settings.graphics);
  if (game) stadium.setField(game.field, game.weather.rain > 0.4);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  pipe.setSize(w, h, Math.max(1, h / (PIXROWS[quality] || 330)) * dynScale);
  const sc = $('swipe'); sc.width = w; sc.height = h;
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- dynamic objects
const discGroup = new THREE.Group();
{
  // micro-voxel disc: domed top with the crest, rolled rim, hollow underside
  const top = sampler(discTopTexture());
  const g = voxelize([-0.14, -0.022, -0.14, 0.14, 0.022, 0.14], 0.0095, (x, y, z) => {
    const r = Math.hypot(x, z); if (r > 0.137) return null;
    const dome = 0.012 - (r / 0.137) ** 2 * 0.008;
    if (r < 0.12) { if (y > dome || y < dome - 0.008) return null; }
    else if (y > 0.012 || y < -0.018) return null;
    if (r >= 0.12) return y < -0.006 ? [215, 218, 226] : [246, 247, 250];
    return top(x / 0.28 + 0.5, z / 0.28 + 0.5);
  }, { noise: 0.03, ao: 0.6 });
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); m.castShadow = true;
  discGroup.add(m); discGroup.scale.setScalar(1.15);
}
scene.add(discGroup);
const discTrail = (() => {
  const N = 14, pos = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  const l = new THREE.Line(g, m); l.frustumCulled = false; scene.add(l); return { l, pos, N, pts: [] };
})();

const ring = new THREE.Group();
{
  const r1 = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 48), new THREE.MeshBasicMaterial({ color: 0x38d6ff, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  const r2 = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 48), new THREE.MeshBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
  const r3 = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: 0x38d6ff, transparent: true, opacity: 0.12, depthWrite: false, fog: false }));
  for (const r of [r1, r2, r3]) { r.rotation.x = -Math.PI / 2; ring.add(r); }
  ring.position.y = 0.03; ring.renderOrder = 2;
}
scene.add(ring);
const headingMark = (() => {
  const sh = new THREE.Shape(); sh.moveTo(0, 0.98); sh.lineTo(-0.2, 0.74); sh.lineTo(0.2, 0.74); sh.lineTo(0, 0.98);
  const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.scale(1, 1, -1);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0.95, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  m.position.y = 0.035; m.renderOrder = 3; m.visible = false; scene.add(m); return m;
})();
const aimArrow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1), new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false, fog: false }));
aimArrow.geometry.translate(0, 0.5, 0); aimArrow.geometry.rotateX(-Math.PI / 2);
aimArrow.visible = false; scene.add(aimArrow);
const landMark = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.6, depthWrite: false }));
landMark.rotation.x = -Math.PI / 2; landMark.visible = false; scene.add(landMark);
const blobGeo = new THREE.CircleGeometry(0.42, 12); blobGeo.rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });

// rain particles (shader animated line streaks around the camera)
const rain = (() => {
  const N = 4000, pos = new Float32Array(N * 2 * 3), top = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * 60, y = Math.random() * 30, z = Math.random() * 60;
    pos.set([x, y, z, x, y, z], i * 6); top[i * 2] = 1; top[i * 2 + 1] = 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uAmt: { value: 0 } },
    vertexShader: `attribute float aTop; uniform float uT; uniform vec3 uCam; uniform vec2 uWind; uniform float uAmt; varying float vA;
      void main(){ vec3 p = position; float id = p.x * 7.13 + p.z * 3.7;
        vA = step(fract(id * 0.618), uAmt);
        p.y = mod(p.y - uT * 14.0, 30.0);
        p.x = mod(p.x + uWind.x * uT * 0.8 - uCam.x, 60.0) - 30.0 + uCam.x;
        p.z = mod(p.z + uWind.y * uT * 0.8 - uCam.z, 60.0) - 30.0 + uCam.z;
        p.y += uCam.y - 10.0 + aTop * 0.55;
        p.x += aTop * uWind.x * 0.04; p.z += aTop * uWind.y * 0.04;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: 'varying float vA; void main(){ if (vA < 0.5) discard; gl_FragColor = vec4(0.75,0.82,0.95,0.55); }',
  });
  const l = new THREE.LineSegments(g, m); l.frustumCulled = false; scene.add(l);
  return { l, m };
})();

// ---------------------------------------------------------------- state
let mode = 'menu'; // menu | play
let paused = false;
let game = null, attract = null;
let views = new Map();
let acc = 0, lastT = performance.now(), simTime = 0;
let cam = { yaw: 0, pitch: 0.08, pos: new THREE.Vector3(0, 6, -20), look: new THREE.Vector3(), shake: 0 };
const DEFAULT_PITCH = 0.08;
// Disc cam (like Rocket League's ball cam): camera stays behind you but swings to keep the disc in view
let discCam = !!store.settings.discCamDefault;
// While disc cam steers the camera, WASD is relative to the athlete's own heading (moveYaw), and the mouse turns that heading.
let moveYaw = 0, wasDiscCam = false;
function discCamActive(g) { return discCam && mode === 'play' && g && !g.autoHuman && !g.human.hasDisc && g.state !== 'goal' && g.state !== 'halftime' && g.state !== 'over'; }
let previewView = null, previewOn = false;

function sceneTeamDef(game, t) { return game.teams[t].kit || TEAMS[game.teams[t].key]; }

function buildViews(g) {
  for (const v of views.values()) { scene.remove(v.root); v.blob && scene.remove(v.blob); v.dispose(); }
  views.clear();
  for (const a of g.all) {
    const v = new AthleteView({
      team: sceneTeamDef(g, a.team), number: a.number, name: a.name, skin: a.skin, hairColor: a.hairColor,
      hairStyle: a.hairStyle, gender: a.gender, hand: a.hand, scale: a.attrs.scale, seed: a.id + 3,
    });
    scene.add(v.root);
    v.blob = new THREE.Mesh(blobGeo, blobMat); v.blob.renderOrder = 1; scene.add(v.blob);
    views.set(a, v);
  }
  buildLabels(g);
}

// ---------------------------------------------------------------- labels
let labelEls = new Map();
function buildLabels(g) {
  const box = $('labels'); box.innerHTML = ''; labelEls.clear();
  if (g.autoHuman) return;
  for (const a of g.all) {
    if (a.isHuman) continue;
    const el = document.createElement('div'); el.className = 'lab'; el.style.display = 'none';
    box.appendChild(el); labelEls.set(a, el);
  }
}
const _v = new THREE.Vector3();
function updateLabels(g) {
  const w = window.innerWidth, h = window.innerHeight;
  const human = g.human;
  for (const [a, el] of labelEls) {
    const friend = a.team === human.team;
    const isMark = !friend && human.ai.mark === a && g.offense !== human.team;
    let show = friend || isMark || (a.hasDisc && !friend);
    if (!show) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
    const v = views.get(a);
    v.headWorld(_v); _v.y += 0.45;
    _v.project(camera);
    if (_v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = ((_v.x + 1) / 2 * w) + 'px'; el.style.top = ((1 - _v.y) / 2 * h) + 'px';
    const txt = isMark ? 'YOUR MARK' : (friend ? a.name : '#' + a.number) + (friend && a.ai.state === 'cut' && g.offense === a.team ? ' ▲' : '');
    const cls = 'lab' + (isMark ? ' mark' : '') + (a.callT > 0 ? ' call' : '');
    if (el._t !== txt) { el.textContent = txt; el._t = txt; }
    if (el.className !== cls) el.className = cls;
  }
}

// ---------------------------------------------------------------- HUD
const segsSt = $('barSt'), segsSp = $('barSp');
for (let i = 0; i < 12; i++) { segsSt.appendChild(document.createElement('i')); segsSp.appendChild(document.createElement('i')); }
function setSegs(el, v) { const n = Math.round(v / 100 * 12); const c = el.children; for (let i = 0; i < 12; i++) { const on = i < n; if (c[i]._on !== on) { c[i].className = on ? 'on' : ''; c[i]._on = on; } } }
const LOGO = new Proxy({}, { get: (_, k) => teamLogo(k) });
let hudCache = {};
function setText(id, t) { if (hudCache[id] !== t) { $(id).textContent = t; hudCache[id] = t; } }

function setupHUD(g) {
  hudCache = {};
  const tL = TEAMS[g.teams[0].key], tR = TEAMS[g.teams[1].key];
  $('logoL').innerHTML = LOGO[tL.key]; $('logoR').innerHTML = LOGO[tR.key];
  setText('cityL', tL.city); setText('nameL', tL.name); setText('cityR', tR.city); setText('nameR', tR.name);
  $('sbL').style.background = `linear-gradient(180deg, ${tL.css}, ${tL.dark})`; $('sbR').style.background = `linear-gradient(180deg, ${tR.css}, ${tR.dark})`;
  $('scoreL').style.borderColor = tL.css; $('scoreR').style.borderColor = tR.css;
  $('logoP').innerHTML = LOGO[g.teams[0].key];
  const h = g.human;
  setText('pName', `#${h.number} ${h.name}`);
  setText('pRole', `${h.role.toUpperCase()} · ${h.build === 'taller' ? 'TALL' : 'SHORT'} · ${h.hand === 'right' ? 'RH' : 'LH'}`);
  const pc = $('portrait'); const td = g.teams[0].kit;
  drawPortrait(pc, { skinCss: h.skin, hairCss: h.hairColor, hair: h.hairStyle, jerseyCss: '#' + td.jersey.toString(16).padStart(6, '0'), panelCss: '#' + td.panel.toString(16).padStart(6, '0') });
  $('hint').textContent = g.practice ? 'PRACTICE · ESC = MENU' : '';
}

function idxOf(g, key) { return g.teams[0].key === key ? 0 : 1; }
function updateHUD(g) {
  const iS = 0, iB = 1; // your team on the left
  if (g.practice) { setText('scoreL', '–'); setText('scoreR', '–'); setText('half', 'PRACTICE'); setText('clock', '∞'); }
  else {
    setText('scoreL', String(g.teams[iS].score)); setText('scoreR', String(g.teams[iB].score));
    const rem = g.displayClock(); const m = Math.floor(rem / 60), s = Math.floor(rem % 60);
    setText('clock', `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    setText('half', g.state === 'halftime' ? 'HALF' : g.half === 1 ? '1ST' : '2ND');
  }
  const offKey = g.teams[g.offense].key;
  setText('possTxt', g.practice ? 'PRACTICE MODE' : `POSSESSION: ${TEAMS[offKey].name}`);
  setText('possArr', g.offense === 0 && !g.practice ? '◀' : ''); setText('possArr2', g.offense === 1 && !g.practice ? '▶' : '');
  const cs = g.capState;
  let note = g.target !== g.origTarget ? `GAME TO ${g.target}` : '';
  if (cs.hard) note = 'HARD CAP · ' + note; else if (cs.pendingHard) note = 'HARD CAP ON'; else if (cs.soft) note = 'SOFT CAP · ' + note; else if (cs.pendingSoft) note = 'SOFT CAP ON'; else if (cs.pendingTime || cs.time) note = 'TIME CAP · ' + note;
  if (g.isUniverse()) note = 'UNIVERSE POINT';
  setText('capnote', g.practice ? '' : note);
  // wind
  const w = g.weather; const mph = Math.round(w.current * MS_TO_MPH);
  setText('windVal', `${mph} MPH`); setText('windDir', mph < 1 ? 'CALM' : `FROM ${w.dirLabel()}`);
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
  const rel = Math.atan2(w.wind.x * rx + w.wind.z * rz, w.wind.x * fx + w.wind.z * fz);
  $('windArrow').style.transform = `rotate(${rel}rad)`; $('windArrow').style.opacity = mph < 1 ? 0.3 : 1;
  const rainOn = w.rain > 0.15; if (hudCache.rain !== rainOn) { $('rainIcon').style.display = rainOn ? 'block' : 'none'; hudCache.rain = rainOn; }
  // player panel
  const h = g.human; setSegs(segsSt, h.endur); setSegs(segsSp, h.sprintE);
  // stall display
  let st = '';
  if (!g.practice && g.dmode === 'held' && g.holder && g.stall >= 1 && (g.holder === h || h.ai.mark === g.holder || hypot(h.pos.x - g.holder.pos.x, h.pos.z - g.holder.pos.z) < 3.5)) st = `STALL ${Math.floor(g.stall)}`;
  setText('stall', st);
  // prompt
  let pr = '';
  if (g.state === 'goal' && g.lastGoal && (g.lastGoal.scorer === h || g.lastGoal.assist === h)) pr = g.lastGoal.scorer === h ? 'EMOTE: 1 SPIKE · 2 DROP KICK · 3 SIX-SEVEN · 4 MOON' : 'EMOTE: 5 BOW & ARROW';
  else if (g.state === 'pull' && g.puller === h) pr = `SWIPE TO PULL · ${Math.ceil(Math.max(0, g.pullDeadline))}s`;
  else if (g.state === 'pull' || g.state === 'lineup') pr = g.offense === h.team ? 'RECEIVING THE PULL' : 'PULLING TEAM';
  else if (g.dmode === 'ground' && g.picker === h) pr = 'PICK UP THE DISC';
  else if (h.hasDisc && g.state === 'live') pr = 'SWIPE: LEFT = BACKHAND · RIGHT = FOREHAND';
  else if (g.dmode === 'air' && !h.hasDisc) pr = 'SPACE = JUMP · SHIFT = DIVE';
  else if (g.offense === h.team && g.dmode === 'held' && !g.practice) pr = h.callT > 0 ? 'CALLING FOR IT!' : 'Q = CALL FOR THE DISC';
  else if (g.offense !== h.team && !g.practice && h.ai.mark) pr = 'DEFENSE · STAY WITH YOUR MARK';
  setText('prompt', pr);
  // incoming-pass indicator: an arrow around the crosshair pointing at the disc (relative to the camera)
  const inc = $('incoming');
  if (g.dmode === 'air' && g.throwInfo && g.throwInfo.receiver === h && !g.throwInfo.isPull) {
    const D = g.disc.p; const dx = D.x - h.pos.x, dz = D.z - h.pos.z;
    const fx2 = Math.sin(cam.yaw), fz2 = Math.cos(cam.yaw), rx2 = -Math.cos(cam.yaw), rz2 = Math.sin(cam.yaw);
    const ang = Math.atan2(dx * rx2 + dz * rz2, dx * fx2 + dz * fz2);
    inc.style.display = 'block';
    inc.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
    $('incomingTxt').style.transform = `translateX(-50%) rotate(${-ang}rad)`;
  } else if (inc.style.display !== 'none') inc.style.display = 'none';
}
const hypot = Math.hypot;

let calloutT = 0;
function callout(text, kind = 'info', dur = 1.8) {
  const el = $('callout');
  el.textContent = text; el.className = kind; void el.offsetWidth; el.className = kind + ' show'; el.style.opacity = 1;
  calloutT = dur;
}

// ---------------------------------------------------------------- events
function onEvent(t, d) {
  switch (t) {
    case 'callout': callout(d.text, d.kind, d.dur); break;
    case 'throw': audio.play('release'); if (d.speed > 20) audio.play('flight'); if (d.isPull) stadium.cheer(0.45, 2); break;
    case 'huck': stadium.cheer(0.6, 2.5); audio.play('ooh'); break;
    case 'catch': audio.play('catch'); if (d.dive || d.high) { stadium.cheer(0.85, 2.5); audio.play('cheer', { v: 0.6 }); } break;
    case 'layout': cam.shake = 0.25; break;
    case 'drop': audio.play('drop'); audio.play('ooh'); break;
    case 'block': audio.play('block'); stadium.cheer(0.8, 2.5); audio.play('cheer', { v: 0.5 }); break;
    case 'ground': audio.play('ground'); break;
    case 'goal':
      audio.play('cheer', { v: 1 }); audio.play('horn'); stadium.cheer(1, 4.5); stadium.wave(false);
      { const g = game; stadium.setScoreboard(TEAMS[g.teams[0].key].name, TEAMS[g.teams[1].key].name, g.teams[0].score, g.teams[1].score, `${TEAMS[g.teams[d.team].key].name} SCORE!`); }
      break;
    case 'universe': audio.play('universe'); stadium.wave(true); stadium.cheer(0.9, 6); break;
    case 'halftime': audio.play('horn'); break;
    case 'stall': if (d.n >= 6) audio.play('stall', { n: d.n }); break;
    case 'sfx': if (d.a && d.a.isHuman || !d.a) audio.play(d.s); break;
    case 'call': audio.play('call'); break;
    case 'incoming': audio.play('call'); break;
    case 'emote': stadium.cheer(1, 2.5); if (d.kind === 'dropkick' || d.kind === 'spike') audio.play('cheer', { v: 0.6 }); break;
    case 'turnover': stadium.cheer(0.5, 1.5); break;
    case 'point': cam.snap = true; break;
    case 'pullReady': if (d.human) callout('YOUR PULL', 'info', 1.4); break;
    case 'over': audio.play('horn'); stadium.cheer(1, 8); setTimeout(showResults, 3200); break;
  }
}

// ---------------------------------------------------------------- input
const keys = new Set();
const input = { mx: 0, mz: 0, sprint: false, jump: false, dive: false, call: false, aimYaw: 0 };
// Minecraft-style sprint: double-tap W and keep holding it
let lastWTap = -1e9, sprintLatched = false;
let locked = false, lockFailed = false;
let drag = null; // camera drag (fallback)
let swipe = null; // { kind, pts:[{x,y,t}], cx, cy }
let swipeFade = null;

window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (k === 'escape') { if (mode === 'play') { if (paused) resume(); else pause(); } return; }
  if (['1', '2', '3', '4', '5'].includes(k) && mode === 'play' && !paused && game && game.state === 'goal') { if (!game.emote(game.human, +k)) audio.play('ui'); }
  if (k === 'c' && mode === 'play' && !paused && !e.repeat) { discCam = !discCam; callout(discCam ? 'DISC CAM ON' : 'DISC CAM OFF', 'info', 0.8); }
  if (k === 'm') { store.settings.muted = !store.settings.muted; audio.setMuted(store.settings.muted); save(store); callout(store.settings.muted ? 'SOUND OFF' : 'SOUND ON', 'info', 0.8); }
  if (!keys.has(k) && !e.repeat) {
    if (k === ' ') input.jump = true;
    if (k === 'shift') input.dive = true;
    if (k === 'q') input.call = true;
    if (k === 'w') { const now = performance.now(); if (now - lastWTap < 320) sprintLatched = true; lastWTap = now; }
  }
  keys.add(k);
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'w') sprintLatched = false; });
window.addEventListener('blur', () => { keys.clear(); sprintLatched = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => { if (mode === 'play') e.preventDefault(); });

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && mode === 'play' && !paused && !game.over) pause();
});
document.addEventListener('pointerlockerror', () => { lockFailed = true; locked = false; });

function tryLock() {
  if (locked || lockFailed) return;
  try {
    const p = canvas.requestPointerLock && canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { lockFailed = true; });
  } catch (e) { lockFailed = true; }
}

canvas.addEventListener('mousedown', (e) => {
  audio.init();
  if (mode !== 'play' || paused) return;
  const h = game.human;
  const wasLocked = locked;
  if (!locked && !lockFailed) { tryLock(); }
  const canThrow = h.hasDisc && (game.state === 'live' || (game.state === 'pull' && game.puller === h));
  if (canThrow && (wasLocked || lockFailed || e.button !== 0 || true)) {
    const fh = e.button === 2 || keys.has('f') || e.ctrlKey;
    const cx = locked ? window.innerWidth / 2 : e.clientX, cy = locked ? window.innerHeight / 2 : e.clientY;
    swipe = { kind: fh ? 'fh' : 'bh', pts: [{ x: 0, y: 0, t: performance.now() }], vx: 0, vy: 0, ox: cx, oy: cy, button: e.button };
    h.throwAnim = { kind: swipe.kind, stage: 'wind', w: 0.1 };
    e.preventDefault();
    return;
  }
  if (!locked) drag = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mousemove', (e) => {
  if (mode !== 'play' || paused) return;
  const sens = 0.0026 * store.settings.sensitivity;
  if (swipe) {
    const s = store.settings.swipeScale;
    if (locked) { swipe.vx += e.movementX * s; swipe.vy += e.movementY * s; }
    else { swipe.vx = (e.clientX - swipe.ox) * s; swipe.vy = (e.clientY - swipe.oy) * s; }
    swipe.pts.push({ x: swipe.vx, y: swipe.vy, t: performance.now() });
    if (swipe.pts.length > 200) swipe.pts.splice(1, 1);
    return;
  }
  let dx = 0, dy = 0;
  if (locked) { dx = e.movementX; dy = e.movementY; }
  else if (drag) { dx = e.clientX - drag.x; dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; }
  else return;
  if (discCamActive(game)) { moveYaw -= dx * sens; return; }
  cam.yaw -= dx * sens;
  cam.pitch = clamp(cam.pitch + dy * sens * (store.settings.invertY ? -1 : 1), -0.32, 0.85);
});
window.addEventListener('mouseup', (e) => {
  drag = null;
  if (swipe && mode === 'play') finishSwipe();
});

function analyzeSwipe(sw) {
  const H = window.innerHeight;
  const pts = sw.pts; const end = pts[pts.length - 1];
  const cx = end.x, cy = -end.y; // y up
  const len = Math.hypot(cx, cy);
  const L = len / H;
  const power = clamp((L - 0.03) / (0.42 - 0.03), 0, 1);
  const off = Math.atan2(cx, cy); // 0 = up/forward, + = right
  // curvature: mean signed perpendicular offset from the chord, normalised
  let acc = 0, n = 0;
  if (len > 1) {
    for (const p of pts) { const px = p.x, py = -p.y; const cr = (cx * py - cy * px) / len; acc += cr; n++; }
  }
  const bulge = n ? acc / n / Math.max(len, 1) : 0; // + = bulges left of chord
  const turn = Math.abs(bulge) > 0.055 ? Math.sign(bulge) : 0; // +1 = left-to-right curved gesture
  return { L, power, off, bulge, turn };
}
function classify(kind, hand, turn) {
  // Requested mappings (right-handed): BH: L->R = OI, R->L = IO. FH: L->R = IO, R->L = OI. Left-handers mirrored.
  if (!turn) return { label: 'FLAT', curve: 0 };
  const t = hand === 'right' ? turn : -turn;
  let label;
  if (kind === 'bh') label = t > 0 ? 'OI' : 'IO'; else label = t > 0 ? 'IO' : 'OI';
  // physical bend direction (+1 = curves right): RHBH OI curves left, IO right; RHFH OI right, IO left; mirrored for LH
  let curve = kind === 'bh' ? (label === 'OI' ? -1 : 1) : (label === 'OI' ? 1 : -1);
  if (hand === 'left') curve = -curve;
  return { label, curve };
}
function finishSwipe() {
  const sw = swipe; swipe = null;
  const g = game, h = g.human;
  const an = analyzeSwipe(sw);
  if (an.L < 0.03 || !h.hasDisc) { if (h.throwAnim && h.throwAnim.stage === 'wind') h.throwAnim = null; swipeFade = { pts: sw.pts, t: 0.3, ox: sw.ox, oy: sw.oy, cancel: true }; return; }
  const cl = classify(sw.kind, h.hand, an.turn);
  const yaw = cam.yaw - an.off;
  const loft = clamp((DEFAULT_PITCH - cam.pitch) * 0.85, -0.12, 0.6);
  h.facing = yaw;
  g.humanThrow({ kind: sw.kind, power: an.power, yaw, curve: cl.curve, loft, label: `${sw.kind === 'bh' ? 'BACKHAND' : 'FOREHAND'} ${cl.label}` });
  swipeFade = { pts: sw.pts, t: 0.45, ox: sw.ox, oy: sw.oy, label: `${sw.kind === 'bh' ? 'BACKHAND' : 'FOREHAND'} · ${cl.label}` };
}

// ---------------------------------------------------------------- swipe overlay
const sctx = $('swipe').getContext('2d');
function drawSwipe(dt) {
  const W = sctx.canvas.width, H = sctx.canvas.height;
  sctx.clearRect(0, 0, W, H);
  const draw = (sw, alpha, live) => {
    const ox = locked || !sw.ox ? W / 2 : sw.ox, oy = locked || !sw.oy ? H / 2 : sw.oy;
    const pts = sw.pts; if (pts.length < 2) return;
    sctx.lineCap = 'round'; sctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      sctx.strokeStyle = `rgba(120,225,255,${alpha * (0.25 + 0.75 * k)})`;
      sctx.lineWidth = 3 + 9 * k;
      sctx.beginPath(); sctx.moveTo(ox + pts[i - 1].x, oy + pts[i - 1].y); sctx.lineTo(ox + pts[i].x, oy + pts[i].y); sctx.stroke();
    }
    sctx.fillStyle = `rgba(255,255,255,${alpha})`; sctx.beginPath(); sctx.arc(ox, oy, 5, 0, 7); sctx.fill();
    const e = pts[pts.length - 1];
    sctx.beginPath(); sctx.arc(ox + e.x, oy + e.y, 7, 0, 7); sctx.fill();
    if (live) {
      const an = analyzeSwipe(sw);
      const cl = classify(sw.kind, game.human.hand, an.turn);
      // power gauge arc
      sctx.lineWidth = 6; sctx.strokeStyle = 'rgba(10,25,70,0.7)';
      sctx.beginPath(); sctx.arc(ox, oy, 34, -Math.PI * 0.75, Math.PI * 0.75 - Math.PI * 1.5 + Math.PI * 1.5, false); sctx.stroke();
      const pc = an.power; sctx.strokeStyle = pc > 0.8 ? '#ff6a4d' : pc > 0.45 ? '#ffd34d' : '#6dff9a';
      sctx.beginPath(); sctx.arc(ox, oy, 34, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * pc); sctx.stroke();
      sctx.font = '800 18px "Saira Condensed", sans-serif'; sctx.textAlign = 'center'; sctx.fillStyle = '#fff';
      sctx.shadowColor = '#000'; sctx.shadowBlur = 4;
      const kind = sw.kind === 'bh' ? 'BACKHAND' : 'FOREHAND';
      const pw = pc < 0.25 ? 'DISH' : pc < 0.55 ? 'PASS' : pc < 0.8 ? 'LONG' : 'HUCK';
      sctx.fillText(`${kind} · ${cl.label} · ${pw}`, ox, oy + 62);
      sctx.shadowBlur = 0;
    } else if (sw.label) {
      sctx.font = '800 18px "Saira Condensed", sans-serif'; sctx.textAlign = 'center'; sctx.fillStyle = `rgba(255,255,255,${alpha})`;
      sctx.fillText(sw.label, ox, oy + 62);
    }
  };
  if (swipe) draw(swipe, 1, true);
  if (swipeFade) { swipeFade.t -= dt; if (swipeFade.t <= 0) swipeFade = null; else draw(swipeFade, swipeFade.t / 0.45, false); }
}

// ---------------------------------------------------------------- game lifecycle
function newGame(modeName) {
  if (attract) { attract = null; }
  const settings = { ...store.settings };
  game = new Game(settings, store.athlete, modeName, onEvent);
  stadium.setField(game.field, game.weather.rain > 0.4);
  buildViews(game);
  setupHUD(game);
  const d = game.teams[0].dir;
  cam.yaw = d > 0 ? 0 : Math.PI; cam.pitch = DEFAULT_PITCH; cam.snap = true;
  stadium.setScoreboard(TEAMS[game.teams[0].key].name, TEAMS[game.teams[1].key].name, 0, 0, 'WORLD ULTIMATE LEAGUE');
  stadium.wave(false);
  acc = 0;
}

function startAttract() {
  const a = TEAM_KEYS[Math.floor(Math.random() * TEAM_KEYS.length)]; let b = TEAM_KEYS[Math.floor(Math.random() * TEAM_KEYS.length)]; if (b === a) b = a === 'blaze' ? 'skyline' : 'blaze';
  const s = { ...DEFAULTS.settings, teamSize: 5, weatherPreset: 'sunny', difficulty: 'normal', team: a, opponent: b };
  attract = new Game(s, { ...DEFAULTS.athlete }, 'match', function (t, d) { if (t === 'goal') stadium.cheer(1, 3.5); });
  attract.autoHuman = true;
  game = attract;
  stadium.setField(game.field, false);
  buildViews(game);
}

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('on');
  if (id) $(id).classList.add('on');
  previewOn = id === 'menuAthlete';
}
let returnTo = 'menuMain';

function startMatch(kind) {
  audio.init();
  save(store);
  mode = 'play'; paused = false;
  newGame(kind);
  show(null);
  $('hud').classList.add('on');
  $('lockTip').style.display = 'none';
  tryLock();
}
function pause() {
  if (mode !== 'play') return;
  paused = true; swipe = null;
  if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) { }
  show('menuPause'); returnTo = 'menuPause';
}
function resume() {
  paused = false; show(null); lastT = performance.now();
  tryLock();
}
function toMenu() {
  mode = 'menu'; paused = false;
  if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) { }
  $('hud').classList.remove('on');
  startAttract();
  show('menuMain'); returnTo = 'menuMain';
  updateQuickSub();
}
function showResults() {
  if (!game || !game.over || mode !== 'play') return;
  if (document.pointerLockElement) try { document.exitPointerLock(); } catch (e) { }
  const g = game, w = g.winner;
  const human = w === 0;
  $('resTitle').textContent = `${TEAMS[g.teams[w].key].name} WIN${human ? ' — VICTORY!' : ''}`;
  $('resScore').textContent = `${TEAMS[g.teams[0].key].name} ${g.teams[0].score} – ${g.teams[1].score} ${TEAMS[g.teams[1].key].name} · game to ${g.target}`;
  const st = g.stats;
  const rows = [['Your goals', st.humanGoals], ['Your assists', st.humanAssists], ['Your catches', st.humanCatches], ['Your throws', st.humanThrows],
  ['Team completions', `${st.completions} / ${st.throws}`], ['Turnovers (you / them)', `${st.turnovers[0]} / ${st.turnovers[1]}`], ['Blocks (you / them)', `${st.blocks[0]} / ${st.blocks[1]}`],
  ['Real time played', `${Math.floor(g.clock / 60)}m ${Math.floor(g.clock % 60)}s`]];
  $('resStats').innerHTML = rows.map(r => `<div class="stat"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
  show('results'); returnTo = 'results';
}

// ---------------------------------------------------------------- menus
function segRow(label, opts, get, set) {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<label>${label}</label>`;
  const seg = document.createElement('div'); seg.className = 'seg';
  for (const [v, t] of opts) {
    const b = document.createElement('button'); b.textContent = t;
    if (get() === v) b.classList.add('on');
    b.onclick = () => { set(v); audio.init(); audio.play('ui'); for (const c of seg.children) c.classList.remove('on'); b.classList.add('on'); save(store); onSettingsChanged(); };
    seg.appendChild(b);
  }
  row.appendChild(seg); return row;
}
function teamRow(label, get, set) {
  const row = document.createElement('div'); row.className = 'row'; row.style.alignItems = 'flex-start';
  row.innerHTML = `<label>${label}</label>`;
  const grid = document.createElement('div'); grid.className = 'teamgrid';
  for (const k of TEAM_KEYS) {
    const t = TEAMS[k]; const b = document.createElement('button');
    b.className = 'teambtn' + (get() === k ? ' on' : ''); b.title = `${t.city} ${t.name}`;
    b.innerHTML = `<svg viewBox="0 0 40 40">${teamLogo(k)}</svg><span><i>${t.city}</i>${t.name}</span><b style="background:#${t.jersey.toString(16).padStart(6, '0')};border-color:${t.css}"></b>`;
    b.onclick = () => { audio.init(); audio.play('ui'); set(k); save(store); onSettingsChanged(); };
    grid.appendChild(b);
  }
  row.appendChild(grid); return row;
}
function buildSetup() {
  const S = store.settings, box = $('setupRows'); box.innerHTML = '';
  box.append(
    segRow('TEAM SIZE', [2, 3, 4, 5, 6, 7].map(n => [n, `${n}v${n}`]), () => S.teamSize, v => S.teamSize = v),
    segRow('DURATION', [[100, '100 MIN · TO 15'], [70, '70 MIN · TO 13']], () => S.duration, v => S.duration = v),
    segRow('RULES', [['wfdf', 'WFDF CHAMPIONSHIP'], ['usau', 'USA ULTIMATE CAPS'], ['simple', 'SIMPLIFIED (NO CAPS)']], () => S.rules, v => S.rules = v),
    segRow('AI DIFFICULTY', [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']], () => S.difficulty, v => S.difficulty = v),
    teamRow('YOUR TEAM', () => S.team, v => { S.team = v; if (S.opponent === v) S.opponent = TEAM_KEYS[(TEAM_KEYS.indexOf(v) + 1) % TEAM_KEYS.length]; buildSetup(); }),
    teamRow('OPPONENT', () => S.opponent || 'blaze', v => { if (v !== S.team) { S.opponent = v; buildSetup(); } }),
    segRow('WEATHER', [['sunny', 'ALWAYS SUNNY'], ['random', 'RANDOM'], ['windy', 'ALWAYS WINDY'], ['rainy', 'ALWAYS RAINY'], ['custom', 'CUSTOM']], () => S.weatherPreset, v => { S.weatherPreset = v; buildSetup(); }),
  );
  if (S.weatherPreset === 'custom') box.append(
    segRow('WIND', [['off', 'OFF'], ['random', 'RANDOM'], ['on', 'ALWAYS ON'], ['custom', 'MANUAL']], () => S.wind, v => { S.wind = v; buildSetup(); }),
    ...(S.wind === 'custom' ? [segRow('WIND FROM', WIND_DIRS.map(d => [d, d]), () => S.windDir, v => S.windDir = v), segRow('WIND SPEED', [3, 6, 10, 15, 20].map(n => [n, n + ' MPH']), () => S.windSpeed, v => S.windSpeed = v)] : []),
    segRow('RAIN', [['off', 'OFF'], ['random', 'RANDOM'], ['on', 'ALWAYS ON']], () => S.rain, v => S.rain = v),
  );
  box.append(segRow('PASS ASSIST', [['assisted', 'ASSISTED'], ['semi', 'SEMI'], ['manual', 'MANUAL']], () => S.assist, v => S.assist = v));
}
function buildAthlete() {
  const A = store.athlete, box = $('athRows'); box.innerHTML = '';
  const nameRow = document.createElement('div'); nameRow.className = 'row';
  nameRow.innerHTML = `<label>NAME</label><input type="text" maxlength="14" id="inName"><label style="width:auto;margin-left:6px">#</label><input type="number" min="0" max="99" id="inNum" style="width:70px">`;
  box.append(nameRow);
  setTimeout(() => {
    const n = $('inName'), u = $('inNum');
    n.value = A.name; u.value = A.number;
    n.oninput = () => { A.name = n.value.toUpperCase().slice(0, 14) || 'PLAYER'; save(store); rebuildPreview(); };
    u.oninput = () => { A.number = clamp(parseInt(u.value) || 0, 0, 99); save(store); rebuildPreview(); };
  });
  const sw = (label, list, get, set) => {
    const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<label>${label}</label>`;
    const seg = document.createElement('div'); seg.className = 'seg';
    list.forEach((c, i) => { const b = document.createElement('div'); b.className = 'swatch' + (get() === i ? ' on' : ''); b.style.background = c; b.onclick = () => { set(i); save(store); for (const x of seg.children) x.classList.remove('on'); b.classList.add('on'); rebuildPreview(); }; seg.appendChild(b); });
    row.appendChild(seg); return row;
  };
  box.append(
    segRow('ROLE', [['handler', 'HANDLER'], ['cutter', 'CUTTER']], () => A.role, v => A.role = v),
    segRow('BUILD', [['taller', 'TALLER'], ['shorter', 'SHORTER']], () => A.height, v => A.height = v),
    segRow('APPEARANCE', [['male', 'MALE'], ['female', 'FEMALE']], () => A.gender, v => A.gender = v),
    segRow('THROWING HAND', [['right', 'RIGHT'], ['left', 'LEFT']], () => A.hand, v => A.hand = v),
    sw('SKIN TONE', SKIN_TONES, () => A.skin, v => A.skin = v),
    sw('HAIR COLOR', HAIR_COLORS, () => A.hairColor, v => A.hairColor = v),
    segRow('HAIRSTYLE', HAIR_STYLES.map(h => [h, h.toUpperCase()]), () => A.hair, v => A.hair = v),
  );
  updateAthNote();
}
function updateAthNote() {
  const A = store.athlete, at = makeAttrs(A.role, A.height);
  $('athNote').innerHTML = `<b>${A.role.toUpperCase()}</b>: ${A.role === 'handler' ? 'longer, more accurate throws and better breaks/wind control; slower and less stamina.' : 'faster sprint and much better stamina; shorter, less accurate throws.'}<br>` +
    `<b>${A.height.toUpperCase()}</b>: ${A.height === 'taller' ? 'higher reach & skying, top-speed bonus on long runs; slower acceleration and cuts, harder low catches.' : 'explosive acceleration and sharp cuts, easier low catches; lower reach.'}<br>` +
    `Sprint ${at.sprint.toFixed(1)} m/s · Accel ${at.accel.toFixed(1)} m/s² · Max throw ${at.maxThrow.toFixed(0)} m/s · Reach ${at.reach.toFixed(2)} m`;
}
function buildSettings() {
  const S = store.settings, box = $('setRows'); box.innerHTML = '';
  box.append(segRow('GRAPHICS', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']], () => S.graphics, v => { S.graphics = v; applyQuality(); rebuildStadium(); }));
  const slider = (label, min, max, step, get, set, fmt) => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label>${label}</label>`;
    const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = get();
    const sp = document.createElement('span'); sp.textContent = fmt(get());
    r.oninput = () => { set(parseFloat(r.value)); sp.textContent = fmt(get()); save(store); };
    row.append(r, sp); return row;
  };
  box.append(
    slider('MOUSE SENSITIVITY', 0.2, 3, 0.05, () => S.sensitivity, v => S.sensitivity = v, v => v.toFixed(2) + '×'),
    slider('SWIPE SENSITIVITY', 0.4, 2.5, 0.05, () => S.swipeScale, v => S.swipeScale = v, v => v.toFixed(2) + '×'),
    segRow('INVERT LOOK Y', [[false, 'OFF'], [true, 'ON']], () => S.invertY, v => S.invertY = v),
    segRow('DISC CAM AT START', [[false, 'OFF'], [true, 'ON']], () => !!S.discCamDefault, v => { S.discCamDefault = v; discCam = v; }),
    slider('VOLUME', 0, 1, 0.05, () => S.volume, v => { S.volume = v; audio.setVolume(v); }, v => Math.round(v * 100) + '%'),
    segRow('SOUND', [[false, 'ON'], [true, 'MUTED']], () => S.muted, v => { S.muted = v; audio.setMuted(v); }),
    segRow('PASS ASSIST', [['assisted', 'ASSISTED'], ['semi', 'SEMI'], ['manual', 'MANUAL']], () => S.assist, v => S.assist = v),
    segRow('STALL SPEED', [[1.0, '1 COUNT / SEC'], [1.25, 'RELAXED (1.25s)'], [1.5, 'EASY (1.5s)']], () => S.stallSeconds, v => S.stallSeconds = v),
  );
}
function onSettingsChanged() {
  updateQuickSub();
  if (game && mode === 'play') { game.settings.assist = store.settings.assist; game.settings.stallSeconds = store.settings.stallSeconds; }
  if (previewOn) { rebuildPreview(); updateAthNote(); }
}
function updateQuickSub() {
  const S = store.settings; $('quickSub').textContent = `${S.teamSize}v${S.teamSize} · ${S.duration} MIN · ${S.difficulty.toUpperCase()}`;
  const a = TEAMS[S.team] || TEAMS.skyline, b = TEAMS[S.opponent === S.team ? 'blaze' : (S.opponent || 'blaze')] || TEAMS.blaze;
  $('menuTitle').innerHTML = `ULTIMATE<br><em>${a.name}</em> vs ${b.name}`;
}

function rebuildPreview() {
  if (previewView) { scene.remove(previewView.root); previewView.dispose(); previewView = null; }
  const A = store.athlete;
  const at = makeAttrs(A.role, A.height);
  previewView = new AthleteView({ team: TEAMS[store.settings.team], number: A.number, name: A.name, skin: SKIN_TONES[A.skin], hairColor: HAIR_COLORS[A.hairColor], hairStyle: A.hair, gender: A.gender, hand: A.hand, scale: at.scale, seed: 99 });
  scene.add(previewView.root);
  previewView.root.visible = previewOn;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  audio.init(); audio.play('ui');
  const act = b.dataset.act;
  switch (act) {
    case 'quick': startMatch('match'); break;
    case 'setup': buildSetup(); show('menuSetup'); break;
    case 'start': startMatch('match'); break;
    case 'practice': startMatch('practice'); break;
    case 'athlete': buildAthlete(); show('menuAthlete'); rebuildPreview(); break;
    case 'settings': buildSettings(); show('menuSettings'); break;
    case 'controls': show('menuControls'); break;
    case 'back': show(mode === 'play' && paused ? 'menuPause' : returnTo === 'results' ? 'results' : 'menuMain'); if (previewView) previewView.root.visible = false; break;
    case 'resume': resume(); break;
    case 'restart': startMatch(game && game.practice ? 'practice' : 'match'); break;
    case 'menu': toMenu(); break;
  }
});
canvas.addEventListener('click', () => { if (mode === 'play' && !paused && !locked) tryLock(); });

// ---------------------------------------------------------------- camera
const _t = new THREE.Vector3(), _d = new THREE.Vector3();
function updateCamera(g, dt, alpha) {
  if (mode === 'play' && !g.autoHuman) {
    const h = g.human;
    // fallback camera keys
    const ks = 2.2 * dt * store.settings.sensitivity;
    if (keys.has('arrowleft')) cam.yaw += ks; if (keys.has('arrowright')) cam.yaw -= ks;
    if (keys.has('arrowup')) cam.pitch = clamp(cam.pitch - ks * 0.6, -0.32, 0.85); if (keys.has('arrowdown')) cam.pitch = clamp(cam.pitch + ks * 0.6, -0.32, 0.85);
    const px = h.prev.x + (h.pos.x - h.prev.x) * alpha, pz = h.prev.z + (h.pos.z - h.prev.z) * alpha, py = h.prev.y + (h.y - h.prev.y) * alpha;
    if (discCamActive(g)) {
      const D = discGroup.position;
      const dx = D.x - px, dz = D.z - pz, dist = Math.hypot(dx, dz);
      if (dist > 1.2) {
        const want = Math.atan2(dx, dz);
        const dyaw = Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw));
        cam.yaw += dyaw * Math.min(1, dt * 7);
        const elev = Math.atan2(D.y - 1.6, Math.max(dist, 2));
        const wantPitch = clamp(DEFAULT_PITCH - elev * 0.85, -0.3, 0.55);
        cam.pitch += (wantPitch - cam.pitch) * Math.min(1, dt * 5);
      }
    } else if (discCam && h.hasDisc) {
      cam.pitch += (DEFAULT_PITCH - cam.pitch) * Math.min(1, dt * 4);
    }
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    const dist = 5.5, cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const tgtY = 1.5 + py * 0.5;
    _t.set(px - fx * dist * cp, tgtY + 0.62 + sp * dist, pz - fz * dist * cp);
    // keep above the turf and inside the bowl
    _t.y = Math.max(0.45, _t.y);
    _t.x = clamp(_t.x, -42, 42); _t.z = clamp(_t.z, -68, 68);
    const k = cam.snap ? 1 : 1 - Math.exp(-dt * 14);
    cam.pos.lerp(_t, k);
    _d.set(px + fx * 6.0, tgtY + 0.5 - sp * 3.2, pz + fz * 6.0);
    cam.look.lerp(_d, cam.snap ? 1 : 1 - Math.exp(-dt * 18));
    cam.snap = false;
  } else if (previewOn && previewView) {
    const t = performance.now() / 1000;
    previewView.root.position.set(0, 0, 0); previewView.root.rotation.y = t * 0.6;
    cam.pos.set(Math.sin(0.4) * 3.4, 1.5, Math.cos(0.4) * 3.4 - 0.3);
    cam.look.set(-0.9, 1.05, 0);
  } else {
    // cinematic attract camera following the disc
    const D = g.disc.p, t = performance.now() / 1000;
    const a = t * 0.05;
    _t.set(Math.sin(a) * 30 + D.x * 0.3, 13 + Math.sin(t * 0.13) * 4, Math.cos(a) * 38 + D.z * 0.3);
    cam.pos.lerp(_t, 1 - Math.exp(-dt * 0.8));
    _d.set(D.x * 0.8, 1.5, D.z * 0.8);
    cam.look.lerp(_d, 1 - Math.exp(-dt * 1.5));
  }
  camera.position.copy(cam.pos);
  if (cam.shake > 0) { cam.shake -= dt; camera.position.y += Math.sin(performance.now() * 0.06) * cam.shake * 0.12; }
  camera.lookAt(cam.look);
}

// ---------------------------------------------------------------- per-frame view sync
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _hp = new THREE.Vector3();
let discSpinAngle = 0, stepT = 0;
function syncViews(g, dt, alpha) {
  for (const [a, v] of views) {
    const x = a.prev.x + (a.pos.x - a.prev.x) * alpha, z = a.prev.z + (a.pos.z - a.prev.z) * alpha, y = a.prev.y + (a.y - a.prev.y) * alpha;
    v.root.position.set(x + (a.hasDisc ? a.lunge.x * 0.5 : 0), Math.max(0, y), z + (a.hasDisc ? a.lunge.z * 0.5 : 0));
    let df = a.facing - v.root.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df));
    v.root.rotation.y += df * Math.min(1, dt * 20);
    v.animate(a, dt);
    if (v.blob) { v.blob.visible = quality === 'low'; v.blob.position.set(x, 0.02, z); }
  }
  const h = g.human;
  ring.visible = mode === 'play' && !g.autoHuman;
  if (!ring.visible) headingMark.visible = false;
  if (ring.visible) {
    const v = views.get(h);
    ring.position.x = v.root.position.x; ring.position.z = v.root.position.z;
    const s = 1 + Math.sin(performance.now() * 0.006) * 0.04; ring.scale.set(s, s, s);
    headingMark.visible = discCamActive(g);
    if (headingMark.visible) { headingMark.position.x = ring.position.x; headingMark.position.z = ring.position.z; headingMark.rotation.y = moveYaw; }
  }
  // disc
  const D = g.disc;
  if ((g.dmode === 'held' || g.dmode === 'dead') && g.holder) {
    const v = views.get(g.holder);
    v.handWorld(_hp);
    discGroup.position.copy(_hp);
    const f = g.holder.facing;
    discGroup.rotation.set(0, f, 0); discGroup.rotateZ(g.holder.hand === 'right' ? -0.2 : 0.2); discGroup.rotateX(0.1);
    discGroup.scale.setScalar(1.6);
    discTrail.pts.length = 0;
  } else {
    discGroup.scale.setScalar(1.35);
    const dp = g.discPrev || D.p;
    discGroup.position.set(dp.x + (D.p.x - dp.x) * alpha, dp.y + (D.p.y - dp.y) * alpha, dp.z + (D.p.z - dp.z) * alpha);
    _n.set(D.n.x, D.n.y, D.n.z).normalize();
    _q.setFromUnitVectors(_up, _n);
    discSpinAngle += D.spin * dt * 0.25 * D.spinDir;
    discGroup.quaternion.copy(_q); discGroup.rotateY(discSpinAngle);
    if (g.dmode === 'air') { discTrail.pts.push(discGroup.position.clone()); if (discTrail.pts.length > discTrail.N) discTrail.pts.shift(); }
    else discTrail.pts.length = 0;
  }
  const tp = discTrail.pts;
  for (let i = 0; i < discTrail.N; i++) { const p = tp[Math.min(i, tp.length - 1)] || discGroup.position; discTrail.pos[i * 3] = p.x; discTrail.pos[i * 3 + 1] = p.y; discTrail.pos[i * 3 + 2] = p.z; }
  discTrail.l.geometry.attributes.position.needsUpdate = true; discTrail.l.visible = tp.length > 2;
  // aim arrow while swiping
  if (swipe && mode === 'play') {
    const an = analyzeSwipe(swipe);
    const yaw = cam.yaw - an.off;
    const v = views.get(h);
    aimArrow.visible = an.L > 0.02;
    aimArrow.position.set(v.root.position.x, 0.05, v.root.position.z);
    aimArrow.rotation.set(0, yaw + Math.PI, 0);
    aimArrow.scale.set(1, 1, 1.5 + an.power * 6);
    h.want.face = yaw;
    if (h.throwAnim && h.throwAnim.stage === 'wind') h.throwAnim.w = Math.min(1, 0.2 + an.power);
  } else aimArrow.visible = false;
  // footstep sounds for the human
  if (mode === 'play' && !g.autoHuman && h.speedH > 1 && h.y === 0) {
    stepT += dt * (1.6 + h.speedH * 0.2) * 2;
    if (stepT > 1) { stepT = 0; audio.play('step', { v: Math.min(1.2, h.speedH / 6) }); }
  }
}

// ---------------------------------------------------------------- main loop
function readInput() {
  const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
  const r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  const dc = discCamActive(game);
  if (dc && !wasDiscCam) moveYaw = game.human.facing;   // keep running the way you were facing
  if (!dc) moveYaw = cam.yaw;
  wasDiscCam = dc;
  const by = dc ? moveYaw : cam.yaw;
  input.faceYaw = dc ? moveYaw : null;
  const fx = Math.sin(by), fz = Math.cos(by), rx = -Math.cos(by), rz = Math.sin(by);
  let mx = fx * f + rx * r, mz = fz * f + rz * r;
  const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  input.mx = mx; input.mz = mz; input.sprint = sprintLatched && keys.has('w');
  input.aimYaw = cam.yaw;
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const g = game;
  if (!g) return;
  const running = (mode === 'menu' ? !previewOn : !paused) && !window.__freezeSim;
  if (running) {
    acc += dt;
    let steps = 0;
    readInput();
    while (acc >= DT && steps < 6) {
      g.step(mode === 'play' ? input : null);
      input.jump = false; input.dive = false; input.call = false;
      acc -= DT; steps++;
    }
    if (steps >= 6) acc = 0;
    simTime += dt;
    // keep facing during swipe (applyHuman resets want.face)
  }
  const alpha = clamp(acc / DT, 0, 1);
  for (const v of views.values()) v.root.visible = !previewOn;
  discGroup.visible = !previewOn;
  if (previewView) previewView.root.visible = previewOn;
  if (previewOn && previewView) previewView.animate({ speedH: 0, accelLean: 0, turnLean: 0, anim: '', y: 0 }, dt);
  syncViews(g, running ? dt : 0, alpha);
  updateCamera(g, dt, alpha);
  // weather visuals
  const w = g.weather;
  rain.m.uniforms.uT.value = simTime; rain.m.uniforms.uCam.value.copy(camera.position);
  rain.m.uniforms.uWind.value.set(w.wind.x, w.wind.z);
  const rq = quality === 'high' ? 1 : quality === 'medium' ? 0.6 : 0.3;
  rain.m.uniforms.uAmt.value = w.rain * rq; rain.l.visible = w.rain > 0.02;
  pipe.mat.uniforms.rain.value = w.rain;
  sun.intensity = 3.0 * (1 - w.rain * 0.55); hemi.intensity = 1.55 * (1 - w.rain * 0.25);
  scene.fog.near = 220 - w.rain * 150; scene.fog.far = 1200 - w.rain * 600;
  if (!!stadium.rainTurf !== (w.rain > 0.4) && game) stadium.setField(game.field, w.rain > 0.4);
  stadium.update(dt, now / 1000, w.wind, w.rain, camera.position);
  audio.ambience(stadium.excite, w.current, w.rain);
  { const ad = (game && game.teams && mode === 'play') ? game.teams[game.human.team].dir : 1;
    sun.target.position.set(cam.look.x * 0.5, 0, cam.look.z * 0.5); sun.position.set(sun.target.position.x + 30 * ad, 78, sun.target.position.z - 40 * ad); }
  if (mode === 'play') { updateHUD(g); updateLabels(g); }
  { const on = mode === 'play' && discCam; const el = $('camMode'); const t = on ? (discCamActive(game) ? 'DISC CAM' : 'DISC CAM · AIMING') : ''; if (el._t !== t) { el.textContent = t; el._t = t; el.style.display = t ? 'block' : 'none'; } }
  if (calloutT > 0) { calloutT -= dt; if (calloutT <= 0) $('callout').style.opacity = 0; }
  drawSwipe(dt);
  $('lockTip').style.display = mode === 'play' && !paused && !locked && !lockFailed && !swipe ? 'block' : 'none';
  pipe.mat.uniforms.uTime.value = now / 1000;
  pipe.render(scene, camera);
  if (document.visibilityState === 'visible') adapt(dt);
}

// ---------------------------------------------------------------- boot
function boot() {
  applyQuality();
  startAttract();
  updateQuickSub();
  rebuildPreview(); previewView.root.visible = false;
  $('loading').style.display = 'none';
  requestAnimationFrame((t) => { lastT = t; frame(t); });
}
// expose for automated testing
window.__ult = { dbg() { const out = []; for (const [a, el] of labelEls) { const v = views.get(a); v.headWorld(_v); const w = _v.clone(); _v.y += 0.45; _v.project(camera); out.push([a.name, a.team, w.x.toFixed(1), w.y.toFixed(1), w.z.toFixed(1), _v.x.toFixed(2), _v.y.toFixed(2), _v.z.toFixed(3)].join(',')); } return out; }, get game() { return game; }, startMatch, toMenu, pause, resume, analyzeSwipe, classify, cam, keys, input, get mode() { return mode; }, stadium: () => stadium, finishSwipeTest(kind, pts) { swipe = { kind, pts, vx: 0, vy: 0, ox: innerWidth / 2, oy: innerHeight / 2 }; game.human.throwAnim = { kind, stage: 'wind', w: 0.5 }; finishSwipe(); } };
const fontLoad = (document.fonts && document.fonts.load) ? Promise.all([document.fonts.load('800 20px "Saira Condensed"'), document.fonts.load('700 20px "Saira Condensed"')]).catch(() => { }) : Promise.resolve();
Promise.race([fontLoad, new Promise(r => setTimeout(r, 2500))]).then(boot);
