// ============================================================================
// AI — offense (handlers, stack cuts, throw decisions), defense (man marking,
// interceptions), disc pursuit, jump/dive timing. Same physics as the human.
// ============================================================================
import { solveThrow } from './physics.js';
import { accelStep } from './movement.js';

const hyp = Math.hypot;
const ctl = (g, a) => a.isHuman && !g.autoHuman;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function assignDefense(g, defTeam) {
  if (g.practice) return;
  const D = g.teams[defTeam].athletes, O = g.teams[1 - defTeam].athletes;
  for (const o of O) o.ai.mark = null;
  const pairs = [];
  for (const d of D) for (const o of O) pairs.push([hyp(d.pos.x - o.pos.x, d.pos.z - o.pos.z) + (o.hasDisc ? -2 : 0), d, o]);
  pairs.sort((a, b) => a[0] - b[0]);
  const ud = new Set(), uo = new Set();
  for (const [, d, o] of pairs) {
    if (ud.has(d) || uo.has(o)) continue;
    ud.add(d); uo.add(o); d.ai.mark = o; d.ai.perceived.x = o.pos.x; d.ai.perceived.z = o.pos.z;
  }
}

function moveTo(a, x, z, sprint, arrive = 0.35, cap = 1) {
  const dx = x - a.pos.x, dz = z - a.pos.z, d = hyp(dx, dz);
  a.want.face = null;
  if (d < arrive) { a.want.x = a.want.z = 0; a.want.sprint = false; return true; }
  // sprint hysteresis
  if (a.ai.tired && a.sprintE > 40) a.ai.tired = false;
  if (!a.ai.tired && a.sprintE < 6) a.ai.tired = true;
  const sp = sprint && !a.ai.tired;
  const ms = a.maxSpeed(sp) * cap;
  const v = Math.min(ms, d * 2.2 + 0.3);
  a.want.x = dx / d * v; a.want.z = dz / d * v; a.want.sprint = sp;
  return false;
}

function inField(g, p, m = 1) { const f = g.field; p.x = clamp(p.x, -f.hw + m, f.hw - m); p.z = clamp(p.z, -f.hl + m, f.hl - m); return p; }

function discAnchor(g) {
  if (g.dmode === 'held' && g.holder) return g.holder.pos;
  if (g.dmode === 'ground' && g.pickup) return g.pickup;
  if (g.dmode === 'air' && g.predN) { const i = g.predN - 1; return { x: g.pred[i * 4], z: g.pred[i * 4 + 2] }; }
  return g.disc.p;
}

// plan & trigger jump / dive when the disc arrives
function planAerial(g, a, ip) {
  if (!ip || a.y > 0.01 || a.dive || a.recoverT > 0) return;
  const dist = hyp(ip.x - a.pos.x, ip.z - a.pos.z);
  const willing = g.settings.difficulty === 'easy' ? 0.5 : g.settings.difficulty === 'hard' ? 1 : 0.8;
  if (ip.y > a.attrs.reach - 0.25 && ip.y < a.attrs.reach + 0.65 && ip.t < 0.3 && dist < 1.4) { g.startJump(a); return; }
  if (ip.y < 1.15 && ip.t < 0.42 && dist > 1.2 && dist < 3.6 && (dist - 0.7) > a.speedH * ip.t && Math.random() < willing * 0.25) {
    g.startDive(a, ip.x - a.pos.x, ip.z - a.pos.z);
  }
}

// decide who chases the disc while it is in the air
function assignChasers(g) {
  const ti = g.throwInfo; if (!ti) return;
  const offT = ti.isPull ? g.offense : ti.team;
  let bestOff = null, bestOffT = 1e9, recvT = 1e9;
  const ts = new Map();
  for (const a of g.all) {
    a.ai.chase = false;
    if (a === ti.from && !ti.isPull && ti.t < 1) continue;
    const ip = g.bestInterceptFor(a, 0);
    const t = ip ? ip.t : 1e9;
    ts.set(a, t);
    if (a.team === offT) { if (t < bestOffT) { bestOffT = t; bestOff = a; } if (a === ti.receiver) recvT = t; }
  }
  if (ti.isPull) {
    // receiving team: nearest one fields the pull
    if (bestOff && !ctl(g, bestOff)) bestOff.ai.chase = true;
    return;
  }
  const off = g.teams[offT].athletes;
  if (ti.receiver && !ctl(g, ti.receiver) && recvT < 1e8) ti.receiver.ai.chase = true;
  if (bestOff && !ctl(g, bestOff) && (!ti.receiver || recvT > bestOffT + 0.25 || ctl(g, ti.receiver) && recvT > 1e8)) bestOff.ai.chase = true;
  // defenders: contest if they can get there about as early as the offense
  const read = g.diff.read || 0.8;
  if (ti.t < (g.diff.react || 0.3)) return; // defenders need to read the throw first
  for (const d of g.teams[1 - offT].athletes) {
    if (ctl(g, d)) continue;
    const t = ts.get(d);
    const mk = d.ai.mark;
    const margin = mk === ti.receiver ? 0.15 * read : -0.1;
    if (d.ai.chaseRoll === undefined || d.ai.chaseThrow !== ti) { d.ai.chaseThrow = ti; d.ai.chaseRoll = Math.random(); }
    if (t < Math.min(bestOffT, recvT) + margin && (d.ai.chaseRoll < read || mk === ti.receiver)) d.ai.chase = true;
  }
}

export function aiOnThrow(g) { assignChasers(g); g.chaseT = 0; }

export function updateAI(g, dt) {
  const st = g.state;
  if (g.dmode === 'air') { g.chaseT = (g.chaseT || 0) + dt; if (g.chaseT > 0.3) { g.chaseT = 0; assignChasers(g); } }
  for (const a of g.all) {
    if (ctl(g, a)) continue;
    a.ai.decideT -= dt;
    if (st === 'lineup' || st === 'pull' || st === 'goal' || st === 'halftime' || st === 'over') {
      a.want.x = a.want.z = 0; a.want.sprint = false;
      if (st === 'lineup' || st === 'pull') a.want.face = a.dir > 0 ? 0 : Math.PI;
      else a.want.face = null;
      if (a.hasDisc && st === 'pull') { a.throwAnim = a.throwAnim || { kind: 'bh', stage: 'wind', w: 0.6 }; }
      continue;
    }
    if (a.team === g.offense) offenseAI(g, a, dt); else defenseAI(g, a, dt);
  }
}

// ------------------------------------------------------------------ offense
function offenseAI(g, a, dt) {
  const f = g.field, d = a.dir;
  if (a.anim !== 'celebrate') a.anim = '';
  if (a.hasDisc) { holderAI(g, a, dt); return; }
  a.ai.justThrew = Math.max(0, (a.ai.justThrew || 0) - dt);
  if (g.dmode === 'ground' && g.picker === a) { moveTo(a, g.pickup.x, g.pickup.z, true, 0.1); return; }
  if (g.dmode === 'air' && g.throwInfo && g.throwInfo.receiver === a && g.throwInfo.target && !g.throwInfo.isPull) {
    const ip = g.bestInterceptFor(a, 0);
    if (ip) { moveTo(a, ip.x, ip.z, true, 0.05); planAerial(g, a, ip); }
    else moveTo(a, g.throwInfo.target.x, g.throwInfo.target.z, true, 0.05);
    a.ai.state = 'post'; a.ai.timer = 0;
    return;
  }
  if (g.dmode === 'air' && a.ai.chase) {
    const ip = g.bestInterceptFor(a, 0);
    if (ip) { moveTo(a, ip.x, ip.z, true, 0.05); planAerial(g, a, ip); return; }
  }
  const A = discAnchor(g);
  const team = g.teams[a.team];
  if (a.role === 'handler') {
    const hs = team.athletes.filter(o => o.role === 'handler' && !ctl(g, o) && !o.hasDisc);
    const idx = Math.max(0, hs.indexOf(a));
    const inward = A.x > 0 ? -1 : 1;
    const nearSide = Math.abs(A.x) > f.hw - 7;
    let t;
    if (a.ai.justThrew > 0) t = { x: A.x + inward * 4, z: A.z + d * 9 };
    else if (idx % 2 === 0) t = { x: A.x + inward * 6, z: A.z - d * 4 };
    else t = nearSide ? { x: A.x + inward * 12, z: A.z - d * 1 } : { x: A.x - inward * 7, z: A.z - d * 2.5 };
    // don't retreat into own end zone too deep
    if (t.z * d < -f.gl + 2) t.z = d * (-f.gl + 2);
    inField(g, t, 1.5);
    const dist = hyp(t.x - a.pos.x, t.z - a.pos.z);
    moveTo(a, t.x, t.z, dist > 5 || a.ai.justThrew > 0, 0.6);
    if (g.dmode === 'held' && dist < 1) { a.want.face = Math.atan2(A.x - a.pos.x, A.z - a.pos.z); }
    return;
  }
  cutterAI(g, a, dt, A);
}

function cutterAI(g, a, dt, A) {
  const f = g.field, d = a.dir, team = g.teams[a.team];
  const cutters = team.athletes.filter(o => o.role === 'cutter' && !ctl(g, o) && !o.hasDisc);
  const i = Math.max(0, cutters.indexOf(a));
  const toGoal = f.gl - A.z * d;
  const nearGoal = toGoal < 16;
  const stackX = clamp(A.x * 0.35, -f.hw + 4, f.hw - 4);
  const zStack = nearGoal ? d * Math.min(f.gl + 2.5 + i * 2.6, f.hl - 1.5) : clamp(A.z + d * (9 + i * 3.3), -f.hl + 2, f.hl - 2);
  const ai = a.ai;
  if (!['stack', 'cut', 'post', 'clear'].includes(ai.state)) ai.state = 'stack';
  ai.timer += dt;
  const holder = g.holder;
  switch (ai.state) {
    case 'stack': {
      moveTo(a, stackX + (i % 2 ? 0.6 : -0.6), zStack, false, 0.5);
      if (a.speedH < 1) a.want.face = Math.atan2(A.x - a.pos.x, A.z - a.pos.z);
      const tokenFree = !team.cutToken || team.cutToken.ai.state !== 'cut';
      if (g.dmode === 'held' && holder && holder.team === a.team && tokenFree && g.holdT > 0.35 && Math.random() < dt * (g.practice ? 1.2 : 1.8)) {
        startCut(g, a, A, nearGoal, stackX);
      }
      break;
    }
    case 'cut': {
      const t = ai.target;
      const arrived = moveTo(a, t.x, t.z, true, 0.8);
      if (arrived || ai.timer > 2.4) { ai.state = 'post'; ai.timer = 0; }
      break;
    }
    case 'post': {
      // keep presenting, drift slightly
      moveTo(a, ai.target.x + Math.sin(g.time * 2) * 0.8, ai.target.z, false, 0.5);
      if (ai.timer > 0.9) { ai.state = 'clear'; ai.timer = 0; if (team.cutToken === a) team.cutToken = null; ai.clearSide = a.pos.x > stackX ? 1 : -1; }
      break;
    }
    case 'clear': {
      const tx = clamp(stackX + ai.clearSide * 7, -f.hw + 2, f.hw - 2);
      const done = moveTo(a, tx, zStack + d * 2, false, 1.2);
      if (done || ai.timer > 3) { ai.state = 'stack'; ai.timer = 0; }
      break;
    }
  }
}

function startCut(g, a, A, nearGoal, stackX) {
  const f = g.field, d = a.dir, team = g.teams[a.team];
  const ai = a.ai;
  // where is my defender?
  let def = null; for (const o of g.teams[1 - a.team].athletes) if (o.ai.mark === a) def = o;
  let side = def ? Math.sign(a.pos.x - def.pos.x) || 1 : (Math.random() < 0.5 ? -1 : 1);
  if (Math.random() < 0.3) side = -side;
  const defUnder = def && (def.pos.z - a.pos.z) * d < -0.5; // defender between me and disc
  const range = g.holder ? g.holder.attrs.maxThrow * 2.0 : 40;
  let deep = !nearGoal && Math.random() < (defUnder ? 0.45 : 0.15);
  let t;
  if (nearGoal) {
    t = { x: side * (2 + Math.random() * (f.hw - 3)), z: d * (f.gl + 1.2 + Math.random() * (f.E - 3)) };
    if (Math.random() < 0.4) t = { x: A.x + side * (4 + Math.random() * 4), z: A.z + d * (4 + Math.random() * 4) };
  } else if (deep) {
    const dz = Math.min(22 + Math.random() * 10, range - 4);
    t = { x: stackX + side * (3 + Math.random() * 6), z: A.z + d * dz };
  } else {
    t = { x: A.x + side * (5 + Math.random() * 4), z: A.z + d * (5 + Math.random() * 6) };
  }
  if (Math.abs(t.x) > f.hw - 2) t.x = A.x - side * (5 + Math.random() * 3);
  inField(g, t, 1.5);
  // avoid the humans' space
  for (const h of g.humans || [g.human]) {
    if (!h || !ctl(g, h)) continue;
    if (h.team === a.team && hyp(h.pos.x - t.x, h.pos.z - t.z) < 5) t.x = clamp(t.x - Math.sign(h.pos.x - t.x || 1) * 6, -g.field.hw + 2, g.field.hw - 2);
  }
  ai.target = t; ai.state = 'cut'; ai.timer = 0; ai.deep = deep;
  team.cutToken = a;
}

// ------------------------------------------------------------------ holder
// time for athlete r to reach (x,z) using the real acceleration model
function reachTime(r, x, z) {
  const v = { x: r.vel.x, z: r.vel.z };
  let px = r.pos.x, pz = r.pos.z;
  const vm = r.maxSpeed(!r.ai.tired);
  for (let i = 0; i < 300; i++) {
    const dx = x - px, dz = z - pz, d = hyp(dx, dz);
    if (d < 0.75) return i / 60;
    accelStep(v, dx / d * vm, dz / d * vm, r.attrs, 1 / 60);
    px += v.x / 60; pz += v.z / 60;
  }
  return 5;
}

// where will receiver r be after t seconds (bots follow their cut path; humans extrapolated)
function receiverPosAt(g, r, t) {
  if (!ctl(g, r) && r.ai.target && (r.ai.state === 'cut' || r.ai.state === 'post')) {
    const dx = r.ai.target.x - r.pos.x, dz = r.ai.target.z - r.pos.z, d = hyp(dx, dz);
    if (d < 0.3) return { x: r.pos.x, z: r.pos.z };
    const v0 = (r.vel.x * dx + r.vel.z * dz) / d, vm = r.maxSpeed(true), ac = r.attrs.accel * (v0 < 0 ? 0.8 : 1);
    const tA = Math.max(0, (vm - v0) / ac);
    let s = t < tA ? v0 * t + 0.5 * ac * t * t : v0 * tA + 0.5 * ac * tA * tA + vm * (t - tA);
    s = Math.max(0, Math.min(d, s * 0.9));
    return { x: r.pos.x + dx / d * s, z: r.pos.z + dz / d * s };
  }
  const k = ctl(g, r) ? 0.85 : 0.5;
  return { x: r.pos.x + r.vel.x * t * k, z: r.pos.z + r.vel.z * t * k };
}

function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
  let t = ((px - ax) * vx + (pz - az) * vz) / l2; t = clamp(t, 0, 1);
  return { d: hyp(px - (ax + vx * t), pz - (az + vz * t)), t };
}

function holderAI(g, a, dt) {
  const f = g.field, d = a.dir;
  a.want.x = a.want.z = 0;
  if (g.state !== 'live') return;
  const ta = a.throwAnim;
  if (ta && ta.stage === 'wind') {
    ta.t = (ta.t || 0) + dt; ta.w = Math.min(1, ta.t / 0.22);
    if (ta.t > 0.24 && a.ai.plan) {
      const p = a.ai.plan; a.ai.plan = null;
      g.executeThrow(a, p, { receiver: p.receiver });
      a.ai.justThrew = 1.6;
    }
    return;
  }
  a.want.face = d > 0 ? 0 : Math.PI;
  if (g.holdT < (g.diff.think || 0.35) + 0.2) return;
  if (a.ai.decideT > 0) return;
  a.ai.decideT = 0.2;
  const opp = g.teams[1 - a.team].athletes;
  let marker = null; for (const o of opp) if (hyp(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < 2.5) marker = o;
  const maxR = a.attrs.maxThrow * 2.05;
  let best = null, bestS = -1e9;
  for (const r of g.teams[a.team].athletes) {
    if (r === a) continue;
    if (r.dive || r.recoverT > 0) continue;
    const d0 = hyp(r.pos.x - a.pos.x, r.pos.z - a.pos.z);
    const tEst = d0 / 15 + 0.25;
    const L = (r.ai.state === 'cut' && r.ai.target && !ctl(g, r)) ? { x: r.ai.target.x, z: r.ai.target.z }
      : { x: r.pos.x + r.vel.x * tEst * (ctl(g, r) ? 0.9 : 0.5), z: r.pos.z + r.vel.z * tEst * (ctl(g, r) ? 0.9 : 0.5) };
    inField(g, L, 0.8);
    const dist = hyp(L.x - a.pos.x, L.z - a.pos.z);
    if (dist < 4 || dist > maxR) continue;
    const gain = (L.z - a.pos.z) * d;
    let minDef = 9, lane = 9, risk = 0;
    const recvT = ctl(g, r) ? hyp(r.pos.x - L.x, r.pos.z - L.z) / r.maxSpeed(true) : reachTime(r, L.x, L.z);
    if (!ctl(g, r) && recvT > tEst + 0.6) continue; // receiver can't get there in time
    for (const o of opp) {
      const ox = o.pos.x + o.vel.x * tEst * 0.5, oz = o.pos.z + o.vel.z * tEst * 0.5;
      const dd = hyp(ox - L.x, oz - L.z);
      if (dd < minDef) minDef = dd;
      if (o !== marker) { const sd = segDist(o.pos.x, o.pos.z, a.pos.x, a.pos.z, L.x, L.z); lane = Math.min(lane, sd.d / (0.4 + sd.t * 0.6)); }
      const defT = Math.max(0, hyp(o.pos.x - L.x, o.pos.z - L.z) - 0.8) / o.maxSpeed(true) + (g.diff.react || 0.3);
      if (defT < Math.max(recvT, tEst) + 0.2) risk += 2.6;
    }
    let s = gain * 0.09 + Math.min(minDef, 7) * 0.45 + Math.min(lane, 5) * 0.35 - dist * 0.012 - risk;
    if (lane < 2.0) s -= 2.6;
    if (minDef < 2.4) s -= 2.0;
    const inEZ = L.z * d > f.gl + 0.5 && L.z * d < f.hl - 0.5;
    if (inEZ) s += 2.4;
    if (r.isHuman) s += (g.practice ? 2.5 : 0.55) + (r.callT > 0 ? 1.8 : 0);
    if (r.ai.state === 'cut' || r.ai.state === 'post') s += 0.6;
    if (gain < -2) s -= 0.4;
    s += g.gauss() * 0.3 * (g.diff.noise || 1);
    if (s > bestS) { bestS = s; best = { r, L, dist, inEZ }; }
  }
  const nRecv = g.teams[a.team].athletes.length - 1;
  const thr = (g.practice ? 1.6 : 2.7 - (nRecv <= 2 ? 0.8 : 0)) - g.stall * 0.28 - (g.stall > 7 ? 2 : 0);
  if (!best || (bestS < thr && g.stall < 8)) {
    // pivot / look around
    if (marker) a.want.face = Math.atan2(-(marker.pos.x - a.pos.x), d * 4);
    return;
  }
  planThrow(g, a, best, marker);
}

function planThrow(g, a, best, marker) {
  const { r } = best;
  const rh = a.hand === 'right' ? 1 : -1;
  // throw direction & marker side
  const dx = best.L.x - a.pos.x, dz = best.L.z - a.pos.z;
  const yaw0 = Math.atan2(dx, dz);
  let bank = 0, kind;
  const rightX = -Math.cos(yaw0), rightZ = Math.sin(yaw0); // right vector of the throw line
  let markerSide = 0, inLane = false;
  if (marker) {
    const mx = marker.pos.x - a.pos.x, mz = marker.pos.z - a.pos.z;
    markerSide = Math.sign(mx * rightX + mz * rightZ); // + = marker on the right
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(mx, mz) - yaw0), Math.cos(Math.atan2(mx, mz) - yaw0)));
    inLane = ang < 0.5;
  }
  // RH: backhand releases on the left, forehand on the right — choose the side away from the marker
  if (markerSide > 0) kind = rh > 0 ? 'bh' : 'fh'; else if (markerSide < 0) kind = rh > 0 ? 'fh' : 'bh';
  else kind = Math.random() < 0.5 ? 'bh' : 'fh';
  if (inLane) bank = markerSide > 0 ? 0.24 : -0.24; // launch away, bend back around the mark
  else bank = (Math.random() - 0.5) * 0.12;
  if (best.dist > 32) bank += (rh > 0 === (kind === 'bh') ? -0.08 : 0.08); // OI hucks hold their line
  a.facing = yaw0;
  a.throwAnim = { kind, stage: 'wind', w: 0, t: 0 };
  const rp = g.releasePoint(a);
  const w = g.weather.wind, wr = g.diff.windRead || 0.75;
  const spinDir = (kind === 'bh') === (rh > 0) ? 1 : -1;
  const tgt = { x: best.L.x, y: r.attrs.reach * 0.58, z: best.L.z };
  const opt = { maxSpeed: a.attrs.maxThrow, bank, spinDir, wind: { x: w.x * wr, z: w.z * wr }, loft: best.dist > 30 ? 0.35 : best.dist < 14 ? 0.12 : 0.05 };
  let sol = null, t = best.dist / 14;
  const P0 = receiverPosAt(g, r, t + 0.3);
  tgt.x = P0.x; tgt.z = P0.z; inField(g, tgt, 0.8);
  for (let k = 0; k < 5; k++) {
    sol = solveThrow(rp, tgt, opt);
    const tr = reachTime(r, tgt.x, tgt.z) + 0.3; // + windup delay
    if (tr <= sol.t - 0.1 || ctl(g, r)) break;
    // receiver would be late: pull the target back toward where the receiver can actually get to
    const back = receiverPosAt(g, r, sol.t + 0.3);
    tgt.x += (back.x - tgt.x) * 0.6; tgt.z += (back.z - tgt.z) * 0.6;
    opt.loft = Math.min(0.3, opt.loft + 0.06); // and float it a little more
  }
  // lead the receiver away from the closest defender
  let nd = null, ndd = 1e9;
  for (const o of g.teams[1 - a.team].athletes) { const dd = hyp(o.pos.x - tgt.x, o.pos.z - tgt.z); if (dd < ndd) { ndd = dd; nd = o; } }
  if (nd && ndd < 3 && !ctl(g, r)) {
    const ax = tgt.x - nd.pos.x, az = tgt.z - nd.pos.z, al = hyp(ax, az) || 1, k = (3 - ndd) * 0.35;
    tgt.x += ax / al * k; tgt.z += az / al * k; inField(g, tgt, 0.8);
    sol = solveThrow(rp, tgt, opt);
  }
  // execution error — same attribute model as the human
  const at = a.attrs;
  const sigma = 0.02 * at.throwErr * (0.8 + 0.2 * (g.diff.noise || 1)) * (1 + g.weather.rain * 0.6) * (1 + g.weather.current / 9 * at.windCtrl) * (0.6 + best.dist / (at.maxThrow * 2.1)) * (inLane ? 1.15 / at.breakSkill : 1);
  a.ai.plan = {
    kind, yaw: sol.yaw + g.gauss() * sigma, elev: sol.elev + g.gauss() * sigma * 0.5,
    speed: Math.min(at.maxThrow, sol.speed) * (1 + g.gauss() * sigma * 0.4), bank: bank + g.gauss() * sigma, quality: 1 - sigma * 4, receiver: r, tgt, sol,
  };
  a.facing = yaw0; a.want.face = yaw0;
  a.throwAnim = { kind, stage: 'wind', w: 0, t: 0 };
}

// ------------------------------------------------------------------ defense
function defenseAI(g, a, dt) {
  const mk = a.ai.mark;
  const react = g.diff.react || 0.3;
  if (a.anim !== 'celebrate' && a.anim !== 'dejected') a.anim = '';
  if (mk) {
    const k = Math.min(1, dt / react);
    a.ai.perceived.x += (mk.pos.x + mk.vel.x * react * 0.5 - a.ai.perceived.x) * k;
    a.ai.perceived.z += (mk.pos.z + mk.vel.z * react * 0.5 - a.ai.perceived.z) * k;
  }
  if (g.dmode === 'air' && a.ai.chase) {
    const ip = g.bestInterceptFor(a, 0);
    if (ip) { moveTo(a, ip.x, ip.z, true, 0.05); planAerial(g, a, ip); return; }
  }
  if (!mk) { const A = discAnchor(g); moveTo(a, A.x, A.z - 5 * (g.teams[g.offense].dir), false, 2); return; }
  const od = mk.dir; // offense attack direction
  if (mk.hasDisc && g.dmode === 'held') {
    // mark: force forehand (stand on thrower's backhand side)
    const hs = mk.hand === 'right' ? 1 : -1;
    const tx = mk.pos.x + od * hs * 1.1, tz = mk.pos.z + od * 0.6;
    moveTo(a, tx, tz, hyp(tx - a.pos.x, tz - a.pos.z) > 3, 0.12);
    if (hyp(tx - a.pos.x, tz - a.pos.z) < 1.5) { a.want.face = Math.atan2(mk.pos.x - a.pos.x, mk.pos.z - a.pos.z); a.anim = 'mark'; }
    // read the thrower's wind-up and occasionally lay out into the release lane
    const ta = mk.throwAnim;
    if (ta && ta.stage === 'wind' && !ta.markRead && (ta.w > 0.6 || (ta.t || 0) > 0.12)) {
      ta.markRead = true;
      const chance = { easy: 0.02, normal: 0.05, hard: 0.09 }[g.settings.difficulty] ?? 0.05;
      if (Math.random() < chance && !a.dive && a.recoverT <= 0) {
        const rp = g.releasePoint(mk);
        g.startDive(a, rp.x - a.pos.x, rp.z - a.pos.z);
      }
    }
    return;
  }
  const A = discAnchor(g);
  const P = a.ai.perceived;
  const tdx = A.x - P.x, tdz = A.z - P.z, td = hyp(tdx, tdz) || 1;
  const deepBias = td > 18 ? 2.6 : td > 10 ? 1.6 : 1.0;
  const ux = tdx / td, uz = tdz / td;
  const tx = P.x + ux * 0.9, tz = P.z + uz * 0.9 + od * deepBias;
  const dist = hyp(tx - a.pos.x, tz - a.pos.z);
  // a guarding defender reacts to the cutter, so tracks at slightly less than full speed
  moveTo(a, tx, tz, mk.speedH > 4.2 || dist > 2.5, 0.3, g.settings.difficulty === 'hard' ? 0.95 : g.settings.difficulty === 'easy' ? 0.86 : 0.91);
  if (a.speedH < 2) { a.anim = 'guard'; a.want.face = Math.atan2(A.x - a.pos.x, A.z - a.pos.z); }
}
