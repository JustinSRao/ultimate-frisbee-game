import { Game } from '../../src/game.js';
import { DEFAULTS } from '../../src/config.js';
function trial(mode, kind, delay) {
  let res = null;
  const g = new Game({ ...DEFAULTS.settings, teamSize: 2, weatherPreset: 'sunny' }, DEFAULTS.athlete, 'match', (t, d) => {
    if (t === 'block') res = res || (d.a.isHuman ? 'HUMAN_BLOCK' : 'bot_block'); if (t === 'catch' && d.a.isHuman) res = res || 'INTERCEPT'; if (t === 'catch' && !d.a.isHuman) res = res || 'completed';
    if (t === 'callout' && d.text.includes('FOUL ON THE MARK')) res = 'FOUL';
  });
  const th = g.teams[1].athletes[0], rc = g.teams[1].athletes[1], h = g.human;
  g.state = 'live'; g.offense = 1; g.give(th);
  th.pos = { x: 0, z: 0 }; th.facing = Math.PI; // attacking -z
  rc.pos = { x: 0, z: -14 }; rc.vel = { x: 0, z: 0 };
  h.pos = { x: 1.1 * -1, z: -0.6 }; // human on the mark, slightly downfield
  // force a throw of the given kind toward the receiver
  const rp = () => g.releasePoint(th);
  th.throwAnim = { kind, stage: 'wind', w: 1, t: 0 };
  const r0 = rp(); const yaw = Math.atan2(rc.pos.x - r0.x, rc.pos.z - r0.z);
  th.ai.plan = { kind, yaw, elev: 0.06, speed: 15, bank: 0, quality: 1, receiver: rc };
  th.ai.decideT = 99;
  for (let i = 0; i < 180 && !res; i++) {
    const inp = { mx: 0, mz: 0, sprint: false, jump: false, dive: false, call: false, aimYaw: 0 };
    if (i === delay && mode !== 'none') {
      const p = rp(); let dx = p.x - h.pos.x, dz = p.z - h.pos.z;
      if (mode === 'wrong') { dx = -dx; }
      const l = Math.hypot(dx, dz); inp.mx = dx / l; inp.mz = dz / l; inp.dive = true;
    }
    g.step(inp);
  }
  return res || (g.dmode === 'ground' ? 'ground' : 'none');
}
for (const kind of ['fh', 'bh']) for (const mode of ['right', 'wrong', 'none']) for (const delay of [8, 13, 30]) {
  const c = {}; for (let k = 0; k < 40; k++) { const r = trial(mode, kind, delay); c[r] = (c[r] || 0) + 1; }
  console.log(kind, mode.padEnd(5), 'dive@' + (delay / 60).toFixed(2) + 's', JSON.stringify(c));
}
