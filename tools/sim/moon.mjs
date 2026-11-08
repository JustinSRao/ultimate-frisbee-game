import { Game } from '../../src/game.js';
import { DEFAULTS } from '../../src/config.js';
const g = new Game({ ...DEFAULTS.settings, teamSize: 5, weatherPreset: 'sunny' }, DEFAULTS.athlete, 'match', () => {});
g.state = 'live'; const h = g.human, mate = g.teams[0].athletes[1];
h.pos = { x: 0, z: 0 }; for (const o of g.teams[1].athletes) o.pos = { x: 0, z: 10 };
g.scoreGoal(h, mate); g.botEmotes = [];
console.log('scorer 4 (moon):', g.emote(h, 4), 'facing (should be ~π, back to opponents at +z):', h.facing.toFixed(2));
console.log('scorer 5:', g.canEmote(h, 5), 'assist 5 (bow):', g.emote(mate, 5), 'assist 4:', g.canEmote(mate, 4));
