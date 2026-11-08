import { Game } from '../../src/game.js';
import { DEFAULTS } from '../../src/config.js';
const c = {}; let incoming = 0;
for (let k = 0; k < 60; k++) {
  let res = null;
  const g = new Game({ ...DEFAULTS.settings, teamSize: 2, weatherPreset: 'sunny' }, DEFAULTS.athlete, 'match', (t, d) => {
    if (t === 'catch') res = res || (d.a.isHuman ? 'HUMAN CAUGHT' : 'other caught'); if (t === 'drop' && d.a.isHuman) res = res || 'human dropped'; if (t === 'incoming') incoming++;
  });
  const th = g.teams[0].athletes[1], h = g.human;
  for (const o of g.teams[1].athletes) o.pos = { x: 30, z: 30 };
  g.state = 'live'; g.offense = 0; g.give(th); th.pos = { x: 0, z: 0 }; th.facing = 0;
  h.pos = { x: 1, z: 8 }; h.facing = 0; h.vel = { x: 0, z: 5 };
  for (let i = 0; i < 60 * 6 && !res; i++) g.step({ mx: 0, mz: 1, sprint: false, jump: false, dive: false, call: i < 30, aimYaw: 0, faceYaw: 0 });
  c[res || 'no pass/ground'] = (c[res || 'no pass/ground'] || 0) + 1;
}
console.log('running away (back to thrower), 60 trials:', JSON.stringify(c), 'incoming cues:', incoming);
