// ============================================================================
// TOUCH: phone / tablet controls.
//   left thumb : virtual joystick (push to the edge or double-tap it = sprint)
//   right side : drag to look; while holding the disc, swipe to throw
//                (BH/FH toggle button, or put a second finger down = forehand)
//   buttons    : Jump, Dive, Call (Q), Disc cam, Pause, emotes during celebrations
// Phones get landscape-only, a reduced HUD and Low graphics by default.
// ============================================================================
import { getItem } from './storage.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function initTouch(app) {
  const coarse = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  const ctl = { active: false, apply() { } };
  if (!coarse && !/[?&]touch=1/.test(location.search)) return ctl;
  ctl.active = true;
  const phone = Math.min(screen.width, screen.height) < 600 || /[?&]phone=1/.test(location.search);
  document.body.classList.add('touch'); if (phone) document.body.classList.add('phone');
  // first run on a phone: Low graphics (crowd density, shadows, render scale)
  if (phone && !getItem('wul-ultimate-v1')) { app.store.settings.graphics = 'low'; app.save(app.store); app.rebuildStadium(); }
  try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { }

  const $ = (id) => document.getElementById(id);
  const root = $('touch'), stick = $('stick'), knob = $('stickKnob');
  let stickId = null, sx = 0, sy = 0, vx = 0, vy = 0, sprint = false, lastStickTap = 0, tapSprint = false;
  let lookId = null, lx = 0, ly = 0;
  let swipeId = null, fh = false, secondFinger = false;
  const pending = { jump: false, dive: false, call: false };
  const R = 60; // joystick radius in px

  // ---- joystick
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault(); app.audio.init();
    const t = e.changedTouches[0]; stickId = t.identifier;
    const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2;
    const now = performance.now(); tapSprint = now - lastStickTap < 300; lastStickTap = now;
    moveStick(t);
  }, { passive: false });
  function moveStick(t) {
    let dx = t.clientX - sx, dy = t.clientY - sy; const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    vx = dx / R; vy = dy / R;
    sprint = tapSprint || Math.hypot(vx, vy) > 0.97;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.classList.toggle('sprint', sprint);
  }
  const endStick = () => { stickId = null; vx = vy = 0; sprint = false; tapSprint = false; knob.style.transform = ''; stick.classList.remove('sprint'); };

  // ---- buttons
  const btn = (id, fn) => { const el = $(id); el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); app.audio.init(); el.classList.add('down'); fn(); }, { passive: false }); el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('down'); }, { passive: false }); };
  btn('tJump', () => pending.jump = true);
  btn('tDive', () => pending.dive = true);
  btn('tCall', () => pending.call = true);
  btn('tCam', () => app.toggleDiscCam());
  btn('tPause', () => app.pause());
  btn('tFh', () => { fh = !fh; $('tFh').textContent = fh ? 'FH' : 'BH'; $('tFh').classList.toggle('fh', fh); });

  // ---- right side: look / swipe throw (on the game canvas)
  const canvas = app.canvas;
  const canThrow = () => { const g = app.game, h = g && g.human; return h && h.hasDisc && (g.state === 'live' || (g.state === 'pull' && g.puller === h)); };
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); app.audio.init();
    if (app.mode !== 'play' || app.paused) return;
    for (const t of e.changedTouches) {
      if (swipeId !== null && t.identifier !== swipeId) { secondFinger = true; if (app.swipe) app.swipe.kind = 'fh'; continue; }
      if (lookId !== null || swipeId !== null) continue;
      if (canThrow()) {
        swipeId = t.identifier; secondFinger = false;
        const kind = fh ? 'fh' : 'bh';
        app.swipe = { kind, pts: [{ x: 0, y: 0, t: performance.now() }], vx: 0, vy: 0, ox: t.clientX, oy: t.clientY, touch: true };
        app.game.human.throwAnim = { kind, stage: 'wind', w: 0.1 };
      } else { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { e.preventDefault(); moveStick(t); }
      else if (t.identifier === swipeId && app.swipe) {
        e.preventDefault();
        const s = app.store.settings.swipeScale, sw = app.swipe;
        sw.vx = (t.clientX - sw.ox) * s; sw.vy = (t.clientY - sw.oy) * s;
        sw.pts.push({ x: sw.vx, y: sw.vy, t: performance.now() }); if (sw.pts.length > 200) sw.pts.splice(1, 1);
      } else if (t.identifier === lookId) {
        e.preventDefault();
        const sens = 0.0055 * app.store.settings.sensitivity, dx = t.clientX - lx, dy = t.clientY - ly; lx = t.clientX; ly = t.clientY;
        app.cam.yaw -= dx * sens;
        app.cam.pitch = clamp(app.cam.pitch + dy * sens * (app.store.settings.invertY ? -1 : 1), -0.32, 0.85);
      }
    }
  }, { passive: false });
  const onEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) endStick();
      if (t.identifier === lookId) lookId = null;
      if (t.identifier === swipeId) { swipeId = null; if (app.swipe && app.mode === 'play') app.finishSwipe(); }
    }
  };
  window.addEventListener('touchend', onEnd); window.addEventListener('touchcancel', onEnd);

  // ---- emotes during goal celebrations
  const emBox = $('tEmotes'); let emKey = '';
  function updateEmotes() {
    const g = app.game, h = g && g.human;
    let list = [];
    if (app.mode === 'play' && g && g.state === 'goal' && g.lastGoal) {
      if (g.lastGoal.scorer === h) list = [[1, 'SPIKE'], [2, 'DROP KICK'], [3, 'SIX-SEVEN'], [4, 'MOON']];
      else if (g.lastGoal.assist === h) list = [[5, 'BOW & ARROW']];
    }
    const key = list.map(x => x[0]).join();
    if (key !== emKey) {
      emKey = key; emBox.innerHTML = '';
      for (const [n, label] of list) {
        const b = document.createElement('div'); b.className = 'tbtn'; b.textContent = label;
        b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (!app.game.emote(app.game.human, n)) app.audio.play('ui'); }, { passive: false });
        emBox.appendChild(b);
      }
      emBox.classList.toggle('on', list.length > 0);
    }
  }

  // called every frame from readInput(); `by` = yaw the stick's "up" points along
  ctl.apply = (input, by) => {
    const on = app.mode === 'play' && !app.paused;
    root.classList.toggle('on', on);
    if (!on) { endStick(); return; }
    updateEmotes();
    const f = -vy, r = vx;
    if (Math.abs(f) + Math.abs(r) > 0.05 && Math.abs(input.mx) + Math.abs(input.mz) < 0.01) {
      const fx = Math.sin(by), fz = Math.cos(by), rx = -Math.cos(by), rz = Math.sin(by);
      let mx = fx * f + rx * r, mz = fz * f + rz * r; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      input.mx = mx; input.mz = mz; input.sprint = sprint;
    }
    if (pending.jump) { input.jump = true; pending.jump = false; }
    if (pending.dive) { input.dive = true; pending.dive = false; }
    if (pending.call) { input.call = true; pending.call = false; }
  };
  window.__touch = { get state() { return { vx, vy, sprint, fh, lookId, swipeId }; } };
  return ctl;
}
