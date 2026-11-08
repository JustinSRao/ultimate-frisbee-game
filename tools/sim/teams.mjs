import { Game } from '../../src/game.js';
import { DEFAULTS, TEAM_KEYS, kitsClash } from '../../src/config.js';
let clashes = 0;
for (const a of TEAM_KEYS) for (const b of TEAM_KEYS) if (a !== b && kitsClash(a, b)) clashes++;
console.log('teams', TEAM_KEYS.length, 'clashing pairs (use away kit):', clashes);
const g = new Game({ ...DEFAULTS.settings, team: 'glacier', opponent: 'skyline' }, DEFAULTS.athlete, 'match', () => {});
console.log(g.teams.map(t => t.key + (t.kit.alt ? '(away kit)' : '')));
g.autoHuman = true; for (let i = 0; i < 60 * 120; i++) g.step(null); console.log('2 min sim ok, score', g.teams[0].score, g.teams[1].score);
