// ============================================================================
// ATHLETE ACCELERATION MODEL — shared by the simulation and AI prediction.
// Velocity change is split into a component along the current heading
// (accelerate with `accel`, brake with `decel`) and a lateral component
// (cutting grip, reduced for taller builds via turnPenalty).
// ============================================================================
export function accelStep(v, wx, wz, at, dt, scale = 1) {
  const vx = v.x, vz = v.z;
  const sp = Math.hypot(vx, vz);
  if (sp < 0.4) {
    let dx = wx - vx, dz = wz - vz; const dl = Math.hypot(dx, dz), m = at.accel * scale * dt;
    if (dl > m) { dx *= m / dl; dz *= m / dl; }
    v.x += dx; v.z += dz; return;
  }
  const ux = vx / sp, uz = vz / sp;
  const wPar = wx * ux + wz * uz;
  const pX = wx - ux * wPar, pZ = wz - uz * wPar; // desired lateral velocity
  let dPar = wPar - sp;
  const lim = dPar < 0 ? at.decel : at.accel * (1 - 0.35 * Math.min(1, sp / 8));
  const mPar = lim * scale * dt;
  if (dPar > mPar) dPar = mPar; else if (dPar < -mPar) dPar = -mPar;
  let pl = Math.hypot(pX, pZ); const mLat = (10.5 / at.turnPenalty) * scale * dt;
  let lx = pX, lz = pZ; if (pl > mLat) { lx *= mLat / pl; lz *= mLat / pl; }
  v.x += ux * dPar + lx; v.z += uz * dPar + lz;
}

// Top speed for an athlete-like object { attrs, sprintE, endur, sprintTime } (same formula the Game uses).
export function maxSpeedOf(a, sprint, rain = 0) {
  const at = a.attrs;
  let s = sprint && a.sprintE > 1 ? at.sprint : at.run;
  if (sprint && a.sprintTime > 2) s *= 1 + at.longRunBonus;
  s *= 0.86 + 0.14 * (a.endur / 100);
  if (rain > 0.3) s *= 0.98; // slippery turf
  return s;
}

// One free-running step (no disc, no dive, on the ground). Mirrors Game.moveAthlete's normal branch.
// Used by clients to predict their own athlete between server snapshots.
export function runStep(a, inp, dt, rain, field) {
  const ms = maxSpeedOf(a, inp.sprint, rain);
  const wx = inp.mx * ms, wz = inp.mz * ms;
  accelStep(a.vel, wx, wz, a.attrs, dt, rain > 0.4 ? 0.93 : 1);
  a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
  const sp = Math.hypot(a.vel.x, a.vel.z);
  let tf = a.facing;
  if (inp.faceYaw !== null && inp.faceYaw !== undefined) tf = inp.faceYaw;
  else if (sp > 0.6) tf = Math.atan2(a.vel.x, a.vel.z);
  const df = Math.atan2(Math.sin(tf - a.facing), Math.cos(tf - a.facing));
  a.facing += df * Math.min(1, dt * 9);
  a.speedH = sp;
  if (field) {
    a.pos.x = Math.max(-field.hw - 6, Math.min(field.hw + 6, a.pos.x));
    a.pos.z = Math.max(-field.hl - 6, Math.min(field.hl + 6, a.pos.z));
  }
}
