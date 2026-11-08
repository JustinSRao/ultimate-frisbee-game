import { Game, GOAL_CELEBRATION } from '../../shared/game.js';
import { DEFAULTS } from '../../shared/config.js';
const g = new Game({ ...DEFAULTS.settings, teamSize: 5, weatherPreset: 'sunny' }, DEFAULTS.athlete, 'match', () => {});
g.state = 'live'; const h = g.human, mate = g.teams[0].athletes[1];
g.scoreGoal(h, mate);
console.log('scorer can 1/2/3/4:', [1,2,3,4].map(n => g.canEmote(h, n)), 'assist can 4/1:', g.canEmote(mate, 4), g.canEmote(mate, 1));
console.log('spike:', g.emote(h, 1));
let maxY = 0, minVy = 0, bounced = false;
for (let i = 0; i < 60 * 2.3; i++) { g.step(null); minVy = Math.min(minVy, g.disc.v.y); if (g.dmode === 'cosmetic' && g.disc.v.y > 1) bounced = true; }
console.log(' dmode', g.dmode, 'min vy', minVy.toFixed(1), 'bounced', bounced, 'emote cleared', !h.emote, 'anim', h.anim);
// drop kick needs disc in hand -> give back for test
g.give(h); g.dmode = 'dead';
console.log('dropkick:', g.emote(h, 2));
for (let i = 0; i < 60 * 1.2; i++) { g.step(null); maxY = Math.max(maxY, g.disc.p.y); }
console.log(' disc flew: maxY', maxY.toFixed(1), 'dist from kicker', Math.hypot(g.disc.p.x - h.pos.x, g.disc.p.z - h.pos.z).toFixed(1));
console.log('assist bow:', g.emote(mate, 4), 'scorer 67 while dropkick running:', g.emote(h, 3));
let t = g.stateT; while (g.state === 'goal') g.step(null);
console.log('celebration lasted', (g.stateT + 0).toFixed(1), 'state now', g.state, 'GOAL_CELEBRATION', GOAL_CELEBRATION);
