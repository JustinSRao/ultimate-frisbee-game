// ============================================================================
// DISC PHYSICS — flying-disc aerodynamics (Hummel-style coefficients)
// Pure math, no Three.js dependency, fixed timestep.
// World: x = lateral, y = up, z = field length.
// ============================================================================

export const DISC = {
  mass: 0.175, area: 0.0568, rho: 1.23, diam: 0.274, inertia: 0.00164,
  CL0: 0.12, CLa: 1.4, CD0: 0.065, CDa: 2.72, a0: -0.052, CM0: -0.08, CMa: 0.43,
  g: 9.81,
  rollScale: 0.06,   // gameplay scaling of gyroscopic precession roll
};

export function v3(x = 0, y = 0, z = 0) { return { x, y, z }; }
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function norm(a) { const l = Math.hypot(a.x, a.y, a.z) || 1; a.x /= l; a.y /= l; a.z /= l; return a; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// Rotate vector v around unit axis k by angle a (Rodrigues), in place
function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v);
  const cx = k.y * v.z - k.z * v.y, cy = k.z * v.x - k.x * v.z, cz = k.x * v.y - k.y * v.x;
  v.x = v.x * c + cx * s + k.x * d * (1 - c);
  v.y = v.y * c + cy * s + k.y * d * (1 - c);
  v.z = v.z * c + cz * s + k.z * d * (1 - c);
  return v;
}

export class DiscState {
  constructor() {
    this.p = v3(); this.v = v3(); this.n = v3(0, 1, 0);
    this.spin = 60; this.spinDir = 1; // +1 clockwise seen from above (RH backhand)
    this.wobble = 0; this.t = 0; this.grounded = false;
  }
  copy(o) {
    Object.assign(this.p, o.p); Object.assign(this.v, o.v); Object.assign(this.n, o.n);
    this.spin = o.spin; this.spinDir = o.spinDir; this.wobble = o.wobble; this.t = o.t; this.grounded = o.grounded;
    return this;
  }
}

const _vh = v3(), _ld = v3(), _ax = v3();

// One aerodynamic step. wind = {x,z}. Returns true if ground contact happened this step.
export function stepDisc(s, dt, wind) {
  if (s.grounded) {
    // skid & roll to a stop
    const sp = Math.hypot(s.v.x, s.v.z);
    if (sp > 0.01) { const k = Math.max(0, 1 - 7 * dt / Math.max(sp, 0.3)); s.v.x *= k; s.v.z *= k; }
    else { s.v.x = 0; s.v.z = 0; }
    s.p.x += s.v.x * dt; s.p.z += s.v.z * dt; s.p.y = 0.016;
    s.n.x += (0 - s.n.x) * 0.2; s.n.y += (1 - s.n.y) * 0.2; s.n.z += (0 - s.n.z) * 0.2; norm(s.n);
    s.spin *= Math.max(0, 1 - 2 * dt);
    s.t += dt;
    return false;
  }
  const vrx = s.v.x - (wind ? wind.x : 0), vry = s.v.y, vrz = s.v.z - (wind ? wind.z : 0);
  const sp = Math.hypot(vrx, vry, vrz);
  let fx = 0, fy = -DISC.mass * DISC.g, fz = 0;
  if (sp > 0.2) {
    _vh.x = vrx / sp; _vh.y = vry / sp; _vh.z = vrz / sp;
    const dn = dot(_vh, s.n);
    const alpha = Math.asin(clamp(-dn, -1, 1));
    // lift: linear until stall (~0.45 rad), then declines
    let CL = DISC.CL0 + DISC.CLa * alpha;
    if (alpha > 0.45) CL = DISC.CL0 + DISC.CLa * 0.45 - (alpha - 0.45) * 1.6;
    if (alpha < -0.45) CL = DISC.CL0 - DISC.CLa * 0.45 + (-0.45 - alpha) * 1.6;
    const CD = DISC.CD0 + DISC.CDa * (alpha - DISC.a0) * (alpha - DISC.a0);
    const q = 0.5 * DISC.rho * DISC.area * sp * sp;
    _ld.x = s.n.x - _vh.x * dn; _ld.y = s.n.y - _vh.y * dn; _ld.z = s.n.z - _vh.z * dn; norm(_ld);
    fx += _ld.x * q * CL - _vh.x * q * CD;
    fy += _ld.y * q * CL - _vh.y * q * CD;
    fz += _ld.z * q * CL - _vh.z * q * CD;
    // pitching moment -> gyroscopic precession => roll about velocity axis
    const CM = DISC.CM0 + DISC.CMa * alpha;
    const M = CM * q * DISC.diam;
    const omega = Math.max(12, s.spin);
    const roll = (M / (DISC.inertia * omega)) * DISC.rollScale;
    // spinDir +1 (clockwise from above, RHBH): positive moment rolls disc so it fades LEFT
    _ax.x = _vh.x; _ax.y = _vh.y; _ax.z = _vh.z;
    rotAxis(s.n, _ax, roll * s.spinDir * dt);
    // wobble from poor spin (cosmetic + small random drift)
    if (s.wobble > 0) s.wobble = Math.max(0, s.wobble - dt * 0.6);
  }
  s.v.x += fx / DISC.mass * dt; s.v.y += fy / DISC.mass * dt; s.v.z += fz / DISC.mass * dt;
  s.p.x += s.v.x * dt; s.p.y += s.v.y * dt; s.p.z += s.v.z * dt;
  s.spin *= (1 - 0.03 * dt);
  s.t += dt;
  if (s.p.y <= 0.016) {
    s.p.y = 0.016; s.grounded = true;
    s.v.y = 0; s.v.x *= 0.45; s.v.z *= 0.45;
    return true;
  }
  return false;
}

// Build a release state.
// yaw: heading (0 = +z), elev: velocity pitch (rad), speed (m/s), bank (rad, + = right edge down -> curves right),
// nose: attitude relative to velocity (rad, + = nose up), spinDir: +1 / -1
export function launch(s, pos, yaw, elev, speed, bank, nose, spinDir, spin = 62) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const ce = Math.cos(elev), se = Math.sin(elev);
  const d = v3(fx * ce, se, fz * ce);
  s.p.x = pos.x; s.p.y = pos.y; s.p.z = pos.z;
  s.v.x = d.x * speed; s.v.y = d.y * speed; s.v.z = d.z * speed;
  // base normal perpendicular to d in vertical plane
  const n = v3(-fx * se, ce, -fz * se);
  // nose up: tilt normal back (toward -d)
  const cn = Math.cos(nose), sn = Math.sin(nose);
  n.x = n.x * cn - d.x * sn; n.y = n.y * cn - d.y * sn; n.z = n.z * cn - d.z * sn;
  // bank: tilt toward thrower's right. right = forward x up = (-fz, 0, fx)
  const rx = -fz, rz = fx;
  const cb = Math.cos(bank), sb = Math.sin(bank);
  n.x = n.x * cb + rx * sb; n.y = n.y * cb; n.z = n.z * cb + rz * sb;
  norm(n);
  s.n.x = n.x; s.n.y = n.y; s.n.z = n.z;
  s.spin = spin; s.spinDir = spinDir; s.t = 0; s.grounded = false; s.wobble = spin < 45 ? 1 : 0;
  return s;
}

// Simulate forward and record positions. Returns count. buf: Float32Array (x,y,z,t)*N
const _sim = new DiscState();
export function predict(state, wind, buf, maxT = 6, dt = 1 / 60, every = 2) {
  _sim.copy(state);
  let n = 0, i = 0;
  const maxN = buf.length / 4;
  while (_sim.t < maxT && n < maxN) {
    if (i % every === 0) { buf[n * 4] = _sim.p.x; buf[n * 4 + 1] = _sim.p.y; buf[n * 4 + 2] = _sim.p.z; buf[n * 4 + 3] = _sim.t - state.t; n++; }
    const hit = stepDisc(_sim, dt, wind);
    i++;
    if (hit || _sim.grounded) { buf[n * 4] = _sim.p.x; buf[n * 4 + 1] = _sim.p.y; buf[n * 4 + 2] = _sim.p.z; buf[n * 4 + 3] = _sim.t - state.t; n++; break; }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Throw solver: find yaw/speed/elev so the disc reaches `target` (x,y,z) height.
// Uses the very same physics (with the supplied wind estimate).
// ---------------------------------------------------------------------------
const _s2 = new DiscState();
export const noseFor = (sp) => Math.max(-0.03, Math.min(0.07, 0.07 - (sp - 10) * 0.005));
function flyTo(from, yaw, elev, speed, bank, nose, spinDir, wind, D, tx, tz) {
  launch(_s2, from, yaw, elev, speed, bank, noseFor(speed), spinDir);
  const dx = tx - from.x, dz = tz - from.z;
  const ux = dx / D, uz = dz / D;
  let prevAlong = 0;
  for (let i = 0; i < 600; i++) {
    stepDisc(_s2, 1 / 60, wind);
    const rx = _s2.p.x - from.x, rz = _s2.p.z - from.z;
    const along = rx * ux + rz * uz;
    if (along >= D) {
      const lat = rx * uz - rz * ux; // + = left of line? (cross)
      return { reached: true, h: _s2.p.y, lat, t: _s2.t, along };
    }
    if (_s2.grounded) {
      const lat = rx * uz - rz * ux;
      return { reached: false, h: 0, lat, t: _s2.t, along };
    }
    if (along < prevAlong - 0.5 && i > 30) break;
    prevAlong = along;
  }
  return { reached: false, h: 0, lat: 0, t: _s2.t, along: prevAlong };
}

export function solveThrow(from, target, opt) {
  const nose = 0; const { maxSpeed = 26, bank = 0, spinDir = 1, wind = null, loft = 0 } = opt;
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.max(1.5, Math.hypot(dx, dz));
  const th = target.y;
  let yaw = Math.atan2(dx, dz);
  // initial elev heuristic: longer throws higher
  let elev = clamp(0.03 + D * 0.0022 + loft * 0.3 + (th - from.y) / D * 0.6, -0.08, 0.7);
  let speed = 10, res = null;
  for (let pass = 0; pass < 7; pass++) {
    // bisection on speed for height at distance D
    let lo = 4, hi = maxSpeed;
    res = flyTo(from, yaw, elev, hi, bank, nose, spinDir, wind, D, target.x, target.z);
    if (!res.reached || res.h < th - 0.4) {
      // out of range at this elevation: raise and retry
      if (elev < 0.55) { elev += 0.08; continue; }
      speed = hi; break;
    }
    for (let it = 0; it < 11; it++) {
      const mid = (lo + hi) / 2;
      const r = flyTo(from, yaw, elev, mid, bank, nose, spinDir, wind, D, target.x, target.z);
      if (!r.reached || r.h < th) lo = mid; else hi = mid;
    }
    speed = hi;
    res = flyTo(from, yaw, elev, speed, bank, nose, spinDir, wind, D, target.x, target.z);
    // lateral correction
    if (Math.abs(res.lat) > 0.25) { yaw -= Math.atan2(res.lat, D) * 0.95; continue; }
    break;
  }
  return { yaw, elev, speed, nose: noseFor(speed), bank, t: res ? res.t : D / 12, ok: !!(res && res.reached), D };
}

// Rough maximum range for a thrower (used by AI evaluation)
export function maxRange(maxSpeed) { return maxSpeed * 2.6; }
