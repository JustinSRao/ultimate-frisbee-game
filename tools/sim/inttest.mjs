import { Game } from '../../shared/game.js';
import { DEFAULTS } from '../../shared/config.js';
function trial(off, early) {
  let res = null;
  const g = new Game({ ...DEFAULTS.settings, teamSize: 2, weatherPreset: 'sunny' }, DEFAULTS.athlete, 'match', (t, d) => {
    if (t === 'block' && d.a.isHuman) res = res || 'BLOCKED'; if (t === 'catch') res = res || (d.a.isHuman ? 'INTERCEPTED' : 'completed');
  });
  const th = g.teams[1].athletes[0], rc = g.teams[1].athletes[1], h = g.human, bot = g.teams[0].athletes[1];
  bot.pos = { x: 30, z: 30 };
  g.state = 'live'; g.offense = 1; g.give(th); th.pos = { x: 0, z: 0 }; th.facing = Math.PI;
  rc.pos = { x: 0, z: -18 }; h.pos = { x: off, z: -9 }; h.facing = -Math.PI / 2;
  th.throwAnim = { kind: 'bh', stage: 'wind', w: 1, t: 0 };
  th.ai.plan = { kind: 'bh', yaw: Math.PI, elev: 0.05, speed: 15, bank: 0, quality: 1, receiver: rc }; th.ai.decideT = 99;
  let dove = false;
  for (let i = 0; i < 240 && !res; i++) {
    const inp = { mx: 0, mz: 0, sprint: false, jump: false, dive: false, call: false, aimYaw: 0 };
    if (!dove && g.dmode === 'air') { const D = g.disc.p; if (D.z < -9 + early) { inp.mx = -Math.sign(off); inp.dive = true; dove = true; } }
    g.step(inp);
  }
  return res || 'missed';
}
for (const off of [1.0, 1.5, 2.0]) for (const early of [6, 3, 1]) {
  const c = {}; for (let k = 0; k < 40; k++) { const r = trial(off, early); c[r] = (c[r] || 0) + 1; }
  console.log(`lane offset ${off}m, dive when disc ${early}m away`, JSON.stringify(c));
}
