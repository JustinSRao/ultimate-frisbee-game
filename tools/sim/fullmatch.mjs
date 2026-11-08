// Times a full bot-vs-bot match (70 min, to 13) with the real headless Game.
import { Game } from '../../shared/game.js';
import { DEFAULTS } from '../../shared/config.js';
const n = +process.argv[2] || 5;
const t0 = performance.now();
const g = new Game({ ...DEFAULTS.settings, teamSize: n, duration: 70, weatherPreset: 'random' }, DEFAULTS.athlete, 'match', () => { });
g.autoHuman = true;
let steps = 0;
while (!g.over && steps < 60 * 60 * 30) { g.step(null); steps++; }
const ms = performance.now() - t0;
console.log(`${n}v${n} over=${g.over} score ${g.teams[0].score}-${g.teams[1].score} steps ${steps} (${(steps / 60 / 60).toFixed(1)} sim-min) in ${ms.toFixed(0)} ms -> ${(steps / ms).toFixed(0)} steps/ms`);
