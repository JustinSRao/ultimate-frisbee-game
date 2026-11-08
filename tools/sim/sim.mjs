import { Game, DT } from '../../shared/game.js';
import { DEFAULTS } from '../../shared/config.js';
globalThis.localStorage = undefined;
for (const n of [2,5,7]) {
const ev = {}; const log=[];
const g = new Game({...DEFAULTS.settings, teamSize:n}, DEFAULTS.athlete, 'match', (t,d)=>{ ev[t]=(ev[t]||0)+1; if(t==='callout') log.push(d.text); });
g.autoHuman = true;
const t0=Date.now();
let steps=0;
while(!g.over && steps < 60*60*25){ g.step(null); steps++; }
console.log(`${n}v${n}`,'real min', (steps/3600).toFixed(1), 'score', g.teams[0].score, g.teams[1].score, 'over', g.over, 'ms', Date.now()-t0);
console.log(JSON.stringify(ev));
console.log(JSON.stringify(g.stats));
const c={}; for(const l of log) c[l]=(c[l]||0)+1; console.log(JSON.stringify(c));
}
