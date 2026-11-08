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
