import { Game } from '../../shared/game.js';
import { DEFAULTS } from '../../shared/config.js';
const log=[];
const g = new Game({...DEFAULTS.settings}, DEFAULTS.athlete, 'practice', (t,d)=>{ if(t==='callout'||t==='throw'||t==='catch') log.push(t+':'+(d.text||d.a?.name)); });
const h=g.human; const r=g.teams[0].athletes[1];
g.humanThrow({ kind:'bh', power:0.4, yaw: Math.atan2(r.pos.x-h.pos.x, r.pos.z-h.pos.z), curve:0, loft:0, label:'t'});
for(let i=0;i<60*20;i++){ g.step({mx:0,mz:0,sprint:false,jump:false,call:false,aimYaw:0}); if(i%60==0) log.push(`t${i/60} state ${g.state} dmode ${g.dmode} holder ${g.holder&&g.holder.name} holdT ${g.holdT.toFixed(1)} anim ${g.holder&&JSON.stringify(g.holder.throwAnim)} plan ${g.holder&&!!g.holder.ai.plan}`); }
console.log(log.slice(0,30).join('\n'));
