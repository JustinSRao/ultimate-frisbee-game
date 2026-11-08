// ============================================================================
// GAME SIMULATION — athletes, disc, catching, rules engine, match clock, caps
// Independent from rendering. Fixed timestep (1/60 s).
// ============================================================================
import { DiscState, launch, stepDisc, predict, solveThrow, noseFor } from './physics.js';
import { TEAMS, TEAM_KEYS, teamKit, kitsClash, FIELDS, makeAttrs, botNames, mulberry, SKIN_TONES, HAIR_COLORS, HAIR_STYLES } from './config.js';
import { Weather } from './weather.js';
import { updateAI, assignDefense, aiOnThrow } from './ai.js';
import { accelStep, maxSpeedOf } from './movement.js';

export const DT = 1 / 60;
export const GOAL_CELEBRATION = 10; // seconds the scoring team celebrates (match clock is paused)
export const EMOTES = { 1: { kind: 'spike', dur: 2.2, who: 'scorer' }, 2: { kind: 'dropkick', dur: 2.3, who: 'scorer' }, 3: { kind: 'sixseven', dur: 2.6, who: 'scorer' }, 4: { kind: 'moon', dur: 2.8, who: 'scorer' }, 5: { kind: 'bow', dur: 2.4, who: 'assist' } };
const GRAV = 9.81 * 1.2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const hyp = Math.hypot;

export class Athlete {
  constructor(game, team, idx, o) {
    this.game = game; this.team = team; this.idx = idx; this.id = team * 10 + idx;
    Object.assign(this, o); // role, build, gender, hand, isHuman, name, number, skin, hairColor, hairStyle
    this.attrs = makeAttrs(this.role, this.build);
    this.pos = { x: 0, z: 0 }; this.vel = { x: 0, z: 0 }; this.y = 0; this.vy = 0;
    this.prev = { x: 0, z: 0, y: 0, f: 0 };
    this.facing = 0; this.speedH = 0; this.accelLean = 0; this.turnLean = 0;
    this.sprintE = 100; this.endur = 100; this.sprintTime = 0;
    this.hasDisc = false; this.throwAnim = null; this.dive = null; this.recoverT = 0; this.reach = null; this.reachTwo = false;
    this.anim = ''; this.animT = 0; this.callT = 0; this.catchCD = 0; this.pivotLunge = 0; this.lunge = { x: 0, z: 0 };
    this.want = { x: 0, z: 0, sprint: false, face: null }; // movement intent (world velocity dir * desired speed)
    this.ai = { state: 'idle', target: { x: 0, z: 0 }, timer: 0, mark: null, perceived: { x: 0, z: 0 }, react: 0, jumpPlan: null, decideT: 0 };
    this.recent = []; // recent positions for contact speed
    this.stats = { goals: 0, assists: 0, catches: 0, throws: 0 };
  }
  get dir() { return this.game.teams[this.team].dir; }
  maxSpeed(sprint) { return maxSpeedOf(this, sprint, this.game.weather.rain); }
}

export class Game {
  // opts.humans: [{ id, team, slot, cfg }] (cfg = athlete customization). Default: one local human, team 0 slot 0.
  // opts.localId: which human is `this.human` (the camera/HUD athlete on a client). opts.seed: rng seed.
  constructor(settings, athleteCfg, mode, emit, opts = {}) {
    this.settings = settings; this.mode = mode; // 'match' | 'practice'
    this.emit = emit || (() => { });
    this.rng = mulberry(opts.seed ?? ((Date.now() & 0xffff) + 7));
    this.practice = mode === 'practice';
    const n = this.practice ? 3 : settings.teamSize;
    this.n = n;
    this.field = { ...FIELDS[this.practice ? 5 : n] };
    const f = this.field; f.hl = f.L / 2; f.hw = f.W / 2; f.gl = f.hl - f.E; f.brick = f.gl - f.E * 1.1;
    this.weather = new Weather(this.practice ? { ...settings, weatherPreset: 'sunny' } : settings, this.rng);
    this.diff = { easy: { react: 0.48, read: 0.6, noise: 1.6, windRead: 0.45, think: 0.55 }, normal: { react: 0.3, read: 0.8, noise: 1.0, windRead: 0.75, think: 0.35 }, hard: { react: 0.17, read: 0.95, noise: 0.6, windRead: 0.92, think: 0.22 } }[settings.difficulty] || {};
    const humanTeamKey = settings.team;
    let otherKey = settings.opponent && TEAMS[settings.opponent] ? settings.opponent : 'blaze';
    if (otherKey === humanTeamKey) otherKey = TEAM_KEYS[(TEAM_KEYS.indexOf(humanTeamKey) + 1) % TEAM_KEYS.length];
    this.teams = [
      { key: humanTeamKey, score: 0, dir: 1, athletes: [], kit: teamKit(humanTeamKey) },
      { key: otherKey, score: 0, dir: -1, athletes: [], kit: teamKit(otherKey, kitsClash(humanTeamKey, otherKey)) },
    ];
    // build rosters
    const names = botNames(this.rng, 2 * n);
    const humanSpecs = (opts.humans && opts.humans.length ? opts.humans : [{ id: 'local', team: 0, slot: 0, cfg: athleteCfg }])
      .filter(hs => !(this.practice && hs.team !== 0));
    const usedNums = new Set(humanSpecs.map(hs => hs.cfg.number));
    const mkBot = (team, i) => {
      let num; do { num = 1 + Math.floor(this.rng() * 98); } while (usedNums.has(num)); usedNums.add(num);
      const handlerCount = n <= 3 ? 1 : n <= 5 ? 2 : 3;
      const female = this.rng() < 0.45;
      return new Athlete(this, team, i, {
        isHuman: false, name: names.pop(), number: num,
        role: i < handlerCount + (team === 0 && athleteCfg.role === 'handler' ? 0 : 0) ? 'handler' : 'cutter',
        build: this.rng() < 0.5 ? 'taller' : 'shorter', gender: female ? 'female' : 'male', hand: this.rng() < 0.12 ? 'left' : 'right',
        skin: SKIN_TONES[Math.floor(this.rng() * SKIN_TONES.length)], hairColor: HAIR_COLORS[Math.floor(this.rng() * 6)],
        hairStyle: female ? ['ponytail', 'bun', 'long', 'short', 'curly'][Math.floor(this.rng() * 5)] : ['short', 'curly', 'buzz', 'mohawk', 'short'][Math.floor(this.rng() * 5)],
      });
    };
    const mkHuman = (team, i, hs) => {
      const c = hs.cfg || {};
      return new Athlete(this, team, i, {
        isHuman: true, ctrl: hs.id, name: String(c.name || 'PLAYER').slice(0, 14), number: c.number ?? 0, role: c.role === 'cutter' ? 'cutter' : 'handler',
        build: c.height === 'shorter' ? 'shorter' : 'taller', gender: c.gender === 'female' ? 'female' : 'male', hand: c.hand === 'left' ? 'left' : 'right',
        skin: SKIN_TONES[c.skin] || SKIN_TONES[2], hairColor: HAIR_COLORS[c.hairColor] || HAIR_COLORS[0], hairStyle: HAIR_STYLES.includes(c.hair) ? c.hair : 'short',
      });
    };
    for (let t = 0; t < (this.practice ? 1 : 2); t++) {
      const taken = new Map();
      for (const hs of humanSpecs) if (hs.team === t) {
        if (taken.size >= n) break;
        let slot = clamp(hs.slot | 0, 0, n - 1);
        while (taken.has(slot)) slot = (slot + 1) % n; // two humans asked for one slot: next free one
        taken.set(slot, hs);
      }
      for (let i = 0; i < n; i++) this.teams[t].athletes.push(taken.has(i) ? mkHuman(t, i, taken.get(i)) : mkBot(t, i));
    }
    this.humans = this.teams.flatMap(t => t.athletes.filter(a => a.ctrl));
    this.human = this.humans.find(a => a.ctrl === (opts.localId ?? 'local')) || this.humans[0] || this.teams[0].athletes[0];
    // bot roles: ensure handler count per team
    for (const t of this.teams) {
      const hc = n <= 3 ? 1 : n <= 5 ? 2 : 3;
      let have = t.athletes.filter(a => a.role === 'handler').length;
      for (const a of t.athletes) { if (!a.isHuman && have > hc && a.role === 'handler') { a.role = 'cutter'; a.attrs = makeAttrs('cutter', a.build); have--; } }
      for (const a of t.athletes) { if (!a.isHuman && have < hc && a.role === 'cutter') { a.role = 'handler'; a.attrs = makeAttrs('handler', a.build); have++; } }
    }
    this.all = [...this.teams[0].athletes, ...this.teams[1].athletes];

    // disc
    this.disc = new DiscState();
    this.dmode = 'held'; this.holder = null; this.thrower = null; this.throwInfo = null;
    this.pred = new Float32Array(4 * 400); this.predN = 0; this.predAge = 0;
    this.lastIn = { x: 0, z: 0 };
    this.stall = 0; this.holdT = 0;

    // match state
    const dur = settings.duration;
    this.target = this.practice ? 999 : (dur === 70 ? 13 : 15);
    this.origTarget = this.target;
    this.durationMin = dur;
    this.softCapMin = dur - 10; this.hardCapMin = dur;
    this.clock = 0; // real seconds of play
    this.half = 1; this.halfDone = false;
    this.capState = { soft: false, hard: false, time: false, pendingSoft: false, pendingHard: false, pendingTime: false };
    this.state = 'init'; this.stateT = 0;
    this.offense = 0;
    this.pullCount = 0;
    this.firstReceiver = 0;
    this.messages = [];
    this.over = false; this.winner = -1;
    this.stats = { completions: 0, throws: 0, turnovers: [0, 0], blocks: [0, 0], humanCatches: 0, humanThrows: 0, humanGoals: 0, humanAssists: 0 };
    this.time = 0;
    if (this.practice) this.startPractice(); else this.startPoint(0 /*receiving team*/);
  }

  // fav: the team this is good news for (clients colour it good/bad from their own side)
  msg(text, kind = 'info', dur = 1.8, fav) {
    if (fav !== undefined) kind = fav === 0 ? 'good' : 'bad';
    this.emit('callout', { text, kind, dur, fav });
  }

  // ------------------------------------------------------------------ points
  startPoint(receiving) {
    const f = this.field;
    const pulling = 1 - receiving;
    this.offense = receiving;
    // pulling team stands on its defended goal line; receiving team on its own
    const R = this.teams[receiving], P = this.teams[pulling];
    this.state = 'lineup'; this.stateT = 0;
    this.dmode = 'held'; this.throwInfo = null; this.stall = 0;
    for (const a of this.all) { a.hasDisc = false; a.vel.x = a.vel.z = 0; a.y = 0; a.vy = 0; a.dive = null; a.throwAnim = null; a.anim = ''; a.reach = null; a.recoverT = 0; a.endur = Math.min(100, a.endur + 12); a.sprintE = 100; }
    const line = (team, z) => {
      const list = team.athletes; const m = list.length;
      // the human lines up near the middle of the line
      const order = list.slice();
      const hi = order.findIndex(a => a.isHuman);
      if (hi >= 0) { const [hh] = order.splice(hi, 1); order.splice(Math.floor((m - 1) / 2), 0, hh); }
      order.forEach((a, i) => {
        const x = m === 1 ? 0 : (-f.hw * 0.75 + (f.hw * 1.5) * i / (m - 1));
        a.pos.x = x; a.pos.z = z; a.facing = team.dir > 0 ? 0 : Math.PI;
      });
    };
    line(R, -R.dir * f.gl - R.dir * 0.5);
    line(P, -P.dir * f.gl - P.dir * 0.5);
    // puller: human pulls on every other pull of the human team
    let puller;
    const hp = P.athletes.filter(a => a.isHuman && !this.autoHuman);
    if (hp.length && this.pullCount % 2 === 0) puller = hp[Math.floor(this.pullCount / 2) % hp.length];
    else puller = P.athletes.reduce((b, a) => (!a.isHuman && (!b || Math.abs(a.pos.x) < Math.abs(b.pos.x))) ? a : b, null);
    // put puller centered
    const swap = P.athletes.reduce((b, a) => Math.abs(a.pos.x) < Math.abs(b.pos.x) ? a : b);
    if (swap !== puller) { const tx = swap.pos.x; swap.pos.x = puller.pos.x; puller.pos.x = tx; }
    this.pullCount++;
    this.puller = puller;
    this.give(puller);
    for (const a of this.all) { a.prev.x = a.pos.x; a.prev.z = a.pos.z; }
    assignDefense(this, pulling); // pulling team defends: assign after pull too
    this.pullDeadline = 15; // 75 simulated seconds at 5x
    const uni = this.teams[0].score === this.target - 1 && this.teams[1].score === this.target - 1;
    if (uni) { this.msg('UNIVERSE POINT', 'universe', 3.5); this.emit('universe'); }
    this.emit('point', { receiving, pulling, universe: uni });
  }

  startPractice() {
    const f = this.field;
    this.state = 'live'; this.offense = 0;
    this.teams[0].dir = 1;
    this.teams[0].athletes.forEach((a, i) => { a.pos.x = (i - 1) * 8; a.pos.z = -f.gl + 6 + (i === 0 ? 0 : 10); a.facing = 0; a.prev.x = a.pos.x; a.prev.z = a.pos.z; });
    this.give(this.human);
  }

  give(a) {
    for (const o of this.all) o.hasDisc = false;
    a.hasDisc = true; this.holder = a; this.dmode = 'held'; this.holdT = 0; this.stall = 0;
    a.throwAnim = null;
  }

  // ------------------------------------------------------------------ main step
  // input: the local human's input (single player). inputs: { [ctrlId]: input } for every human (online server).
  step(input, inputs) {
    const dt = DT;
    this.time += dt; this.stateT += dt;
    this.weather.update(dt);
    if (!this.practice && this.state !== 'halftime' && this.state !== 'over' && this.state !== 'goal') {
      this.clock += dt; this.checkTimeCaps();
    }
    for (const a of this.all) { a.prev.x = a.pos.x; a.prev.z = a.pos.z; a.prev.y = a.y; a.prev.f = a.facing; a.reach = null; }
    this.discPrev = { x: this.disc.p.x, y: this.disc.p.y, z: this.disc.p.z };

    switch (this.state) {
      case 'lineup':
        if (this.stateT > 1.2) { this.state = 'pull'; this.stateT = 0; this.emit('pullReady', { human: this.puller.isHuman, puller: this.puller }); }
        break;
      case 'pull':
        this.pullDeadline -= dt;
        if (this.puller.isHuman && !this.autoHuman && this.pullDeadline <= 0) { this.msg('PULL CLOCK EXPIRED — AUTO PULL', 'warn'); this.aiPull(this.puller); }
        else if ((!this.puller.isHuman || this.autoHuman) && this.stateT > 2.6 + this.rng() * 0.02) this.aiPull(this.puller);
        break;
      case 'goal':
        this.updateEmotes(DT);
        if (this.stateT > GOAL_CELEBRATION) { for (const a of this.all) a.emote = null; this.afterGoal(); }
        break;
      case 'halftime':
        if (this.stateT > 5) { this.state = 'lineup'; this.startPoint(this.firstReceiver === 0 ? 1 : 0); this.half = 2; }
        break;
      case 'turnover':
        break;
    }
    // human input
    if (inputs) { for (const h of this.humans) if (h.isHuman) this.applyHuman(inputs[h.ctrl] || null, dt, h); }
    else this.applyHuman(input, dt, this.human);
    // AI
    if (this.state !== 'over') updateAI(this, dt);
    // physics for athletes
    for (const a of this.all) this.moveAthlete(a, dt);
    this.separate();
    // disc
    this.updateDisc(dt);
    // stall
    this.updateStall(dt);
    // timers
    for (const a of this.all) {
      if (a.callT > 0) a.callT -= dt;
      if (a.catchCD > 0) a.catchCD -= dt;
      if (a.animT > 0) { a.animT -= dt; if (a.animT <= 0) a.anim = ''; }
      if (a.throwAnim && a.throwAnim.stage === 'release') { a.throwAnim.t += dt; if (a.throwAnim.t > 0.45) a.throwAnim = null; }
      a.recent.push(a.pos.x, a.pos.z); if (a.recent.length > 40) a.recent.splice(0, 2);
    }
  }

  // ------------------------------------------------------------------ human
  applyHuman(inp, dt, h = this.human) {
    if (this.autoHuman || !h || !h.isHuman) return;
    if (!inp) { h.want.x = h.want.z = 0; return; }
    if (this.state === 'goal' || this.state === 'halftime' || this.state === 'over' || this.state === 'lineup') { h.want.x = h.want.z = 0; return; }
    h.want.sprint = inp.sprint;
    const ms = h.maxSpeed(inp.sprint);
    h.want.x = inp.mx * ms; h.want.z = inp.mz * ms;
    h.want.face = inp.faceYaw ?? null; // disc cam: body keeps its heading while strafing / backpedalling
    h.lookYaw = undefined;
    if (this.dmode === 'air' && this.throwInfo && this.throwInfo.receiver === h) {
      // look back over the shoulder at a pass thrown to you
      const D = this.disc.p, rel = Math.atan2(D.x - h.pos.x, D.z - h.pos.z) - h.facing;
      h.lookYaw = clamp(Math.atan2(Math.sin(rel), Math.cos(rel)), -1.3, 1.3);
    }
    if (h.hasDisc) {
      // pivot: movement keys only lunge (no travel)
      const tl = { x: inp.mx * 0.6, z: inp.mz * 0.6 };
      h.lunge.x += (tl.x - h.lunge.x) * Math.min(1, dt * 10); h.lunge.z += (tl.z - h.lunge.z) * Math.min(1, dt * 10);
      h.pivotLunge = hyp(h.lunge.x, h.lunge.z);
      h.want.x = h.want.z = 0; h.want.face = inp.aimYaw;
    } else { h.lunge.x *= 0.8; h.lunge.z *= 0.8; h.pivotLunge = 0; }
    // keep players behind their line before the pull
    if (inp.jump) this.humanJump(h);
    if (inp.dive) this.humanDive(inp, h);
    if (inp.call && !h.hasDisc && this.offense === h.team) { h.callT = 1.6; this.emit('call', { a: h }); }
  }

  humanJump(h = this.human) {
    if (h.y > 0.01 || h.dive || h.recoverT > 0 || h.hasDisc) return;
    this.startJump(h);
  }

  // dive any time: in the direction you're steering, otherwise the way you're facing
  humanDive(inp, h = this.human) {
    if (h.dive || h.recoverT > 0 || h.hasDisc || h.y > 0.3) return;
    if (this.state === 'lineup' || this.state === 'pull' || this.state === 'goal' || this.state === 'halftime' || this.state === 'over') return;
    let dx = inp.mx, dz = inp.mz;
    if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(h.facing); dz = Math.cos(h.facing); }
    this.startDive(h, dx, dz);
  }

  startJump(a) {
    if (a.y > 0.01 || a.dive) return;
    a.vy = a.attrs.jumpV * (0.85 + 0.15 * a.endur / 100); a.y = 0.01;
    a.endur = Math.max(0, a.endur - 0.4);
    this.emit('sfx', { s: 'jump', a });
  }
  startDive(a, dx, dz) {
    if (a.dive || a.y > 0.3) return;
    const l = hyp(dx, dz) || 1;
    const sp = Math.min(9.2, Math.max(5.5, hyp(a.vel.x, a.vel.z) + 3));
    a.vel.x = dx / l * sp; a.vel.z = dz / l * sp; a.vy = 1.6; a.y = 0.02;
    a.facing = Math.atan2(dx, dz);
    a.dive = { t: 0, ground: false, dx: dx / l, dz: dz / l };
    a.sprintE = Math.max(0, a.sprintE - 15); a.endur = Math.max(0, a.endur - 0.8);
    this.emit('sfx', { s: 'dive', a });
  }

  // predicted earliest reachable interception point for athlete a
  bestInterceptFor(a, extraReach = 0) {
    const reachH = 0.85 + extraReach;
    const top = a.attrs.reach + 0.55, ms = a.maxSpeed(true);
    for (let i = 0; i < this.predN; i++) {
      const px = this.pred[i * 4], py = this.pred[i * 4 + 1], pz = this.pred[i * 4 + 2], pt = this.pred[i * 4 + 3] - this.predAge;
      if (pt < 0) continue;
      if (py > top) continue;
      const d = hyp(px - a.pos.x, pz - a.pos.z);
      if (d - reachH <= ms * pt * 0.95 + 0.2) return { x: px, y: py, z: pz, t: pt, dist: d };
    }
    return null;
  }

  // ------------------------------------------------------------------ movement
  moveAthlete(a, dt) {
    const at = a.attrs;
    // airborne vertical
    if (a.y > 0 || a.vy > 0) {
      a.vy -= GRAV * dt; a.y += a.vy * dt;
      if (a.y <= 0) {
        a.y = 0; a.vy = 0;
        if (a.dive) a.dive.ground = true;
        else this.emit('sfx', { s: 'land', a });
      }
    }
    if (a.dive) {
      a.dive.t += dt;
      if (a.dive.ground) { const k = Math.max(0, 1 - 9 * dt); a.vel.x *= k; a.vel.z *= k; }
      if (a.dive.t > 0.95) { a.dive = null; a.recoverT = 0.45; a.anim = 'recover'; a.animT = 0.45; }
      a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
      a.speedH = hyp(a.vel.x, a.vel.z);
      return;
    }
    if (a.recoverT > 0) { a.recoverT -= dt; a.vel.x *= 0.8; a.vel.z *= 0.8; a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt; a.speedH = hyp(a.vel.x, a.vel.z); return; }
    let wx = a.want.x, wz = a.want.z;
    if (a.hasDisc) { wx = 0; wz = 0; } // pivot rule: cannot run with the disc
    const frozen = (this.state === 'pull' || this.state === 'lineup') && !this.practice;
    if (frozen) { wx = 0; wz = 0; }
    const sp = hyp(a.vel.x, a.vel.z), wsp = hyp(wx, wz);
    let scale = a.y > 0 ? 0.1 : 1;
    if (a.hasDisc) { const k = Math.max(0, 1 - 9 * dt / Math.max(sp, 0.01)); a.vel.x *= k; a.vel.z *= k; }
    else accelStep(a.vel, wx, wz, at, dt, scale * (this.weather.rain > 0.4 ? 0.93 : 1));
    const oldSp = sp;
    a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
    a.speedH = hyp(a.vel.x, a.vel.z);
    a.accelLean += (((a.speedH - oldSp) / dt) * 0.15 - a.accelLean) * Math.min(1, dt * 6);
    // facing
    let tf = a.facing;
    if (a.want.face !== null && a.want.face !== undefined) tf = a.want.face;
    else if (a.speedH > 0.6) tf = Math.atan2(a.vel.x, a.vel.z);
    const df = Math.atan2(Math.sin(tf - a.facing), Math.cos(tf - a.facing));
    a.turnLean += (clamp(df * 2, -1, 1) * Math.min(1, a.speedH / 6) - a.turnLean) * Math.min(1, dt * 6);
    a.facing += df * Math.min(1, dt * (a.hasDisc ? 10 : 9));
    // stamina
    const sprinting = a.want.sprint && wsp > at.run * 1.02 && a.speedH > at.run * 0.9;
    if (sprinting) { a.sprintE = Math.max(0, a.sprintE - at.sprintDrain * dt); a.endur = Math.max(0, a.endur - at.enduranceDrain * dt); a.sprintTime += dt; }
    else {
      a.sprintTime = 0;
      const rest = a.speedH < 2 ? 1.4 : a.speedH < 4.5 ? 0.9 : 0.35;
      a.sprintE = Math.min(100, a.sprintE + at.sprintRegen * dt * rest * (0.5 + 0.5 * a.endur / 100));
      if (a.speedH < 3) a.endur = Math.min(100, a.endur + at.enduranceRegen * dt * 0.4);
      else if (a.speedH > 4.5) a.endur = Math.max(0, a.endur - at.enduranceDrain * dt * 0.12);
    }
    // stay inside the stadium floor
    a.pos.x = clamp(a.pos.x, -this.field.hw - 6, this.field.hw + 6);
    a.pos.z = clamp(a.pos.z, -this.field.hl - 6, this.field.hl + 6);
    if (this.state === 'pull' && a.isHuman) {
      const lineZ = -a.dir * this.field.gl;
      if ((a.pos.z - lineZ) * a.dir > 0.2) a.pos.z = lineZ + a.dir * 0.2;
    }
  }

  separate() {
    const L = this.all;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = hyp(dx, dz), min = 0.55;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        const wa = a.hasDisc ? 0 : 1, wb = b.hasDisc ? 0 : 1;
        const s = wa + wb || 1;
        a.pos.x -= nx * push * 2 * wa / s; a.pos.z -= nz * push * 2 * wa / s;
        b.pos.x += nx * push * 2 * wb / s; b.pos.z += nz * push * 2 * wb / s;
        if (this.state === 'live' && a.team !== b.team && this.dmode === 'held') this.checkPick(a, b);
      }
    }
  }

  checkPick(a, b) {
    // defender (off) collides with an offensive player who is not their assignment, while within 3 m of their mark
    const def = a.team !== this.offense ? a : b, off = def === a ? b : a;
    const mk = def.ai.mark;
    if (!mk || mk === off || off.hasDisc || (def.isHuman && !this.autoHuman)) return;
    if (def.speedH < 3.5 || mk.speedH < 3 || off.speedH < 2.5) return; // only when a defender is chasing a cutting mark
    if (hyp(mk.pos.x - def.pos.x, mk.pos.z - def.pos.z) > 3) return;
    if ((this.lastPick || -99) > this.time - 20) return;
    this.lastPick = this.time;
    this.msg('PICK — DEFENDER RECOVERS', 'warn', 1.6);
    def.pos.x = mk.pos.x + (def.pos.x - off.pos.x) * 0.3; def.pos.z = mk.pos.z - mk.dir * 1.2;
    this.emit('sfx', { s: 'whistle' });
  }

  // ------------------------------------------------------------------ throwing
  releasePoint(a) {
    const f = a.facing, hs = a.hand === 'right' ? -1 : 1;
    const fx = Math.sin(f), fz = Math.cos(f), rx = -fz, rz = fx;
    const fh = a.throwAnim && a.throwAnim.kind === 'fh';
    // backhand releases in front, slightly to the throwing side; forehand releases low and out on the throwing side
    const side = hs, lat = fh ? 0.7 : 0.55, fwd = fh ? 0.35 : 0.4;
    return {
      x: a.pos.x + a.lunge.x + fx * fwd - rx * side * lat,
      y: (fh ? 0.85 : 1.0) * a.attrs.scale,
      z: a.pos.z + a.lunge.z + fz * fwd - rz * side * lat,
    };
  }

  // Generic throw: p = { kind:'bh'|'fh', yaw, elev, speed, bank, quality }
  executeThrow(a, p, info = {}) {
    if (!a.hasDisc) return;
    a.throwAnim = { kind: p.kind, stage: 'release', t: 0, w: 1 };
    const rp = this.releasePoint(a);
    const rh = a.hand === 'right';
    const spinDir = (p.kind === 'bh') === rh ? 1 : -1; // RHBH clockwise
    const spin = 48 + 18 * (p.quality ?? 1);
    launch(this.disc, rp, p.yaw, p.elev, p.speed, p.bank, p.nose ?? noseFor(p.speed), spinDir, spin);
    a.hasDisc = false; this.holder = null; this.dmode = 'air'; this.thrower = a;
    this.throwInfo = { from: a, team: a.team, isPull: !!info.isPull, receiver: info.receiver || p.receiver || null, target: p.tgt || info.target || null, t: 0, touched: [], blocked: false, attempted: new Map(), contested: false, label: info.label || '' };
    this.predN = predict(this.disc, this.weather.wind, this.pred, 7, 1 / 60, 2); this.predAge = 0;
    this.lastIn.x = clamp(rp.x, -this.field.hw, this.field.hw); this.lastIn.z = clamp(rp.z, -this.field.hl, this.field.hl);
    a.lunge.x = a.lunge.z = 0;
    this.stall = 0;
    this.stats.throws++;
    a.stats.throws++;
    if (a === this.human) this.stats.humanThrows++;
    this.emit('throw', { a, speed: p.speed, isPull: !!info.isPull, label: info.label });
    if (this.throwInfo.receiver && this.throwInfo.receiver.isHuman && !info.isPull) this.emit('incoming', { from: a, receiver: this.throwInfo.receiver });
    if (!info.isPull && p.speed > 22) this.emit('huck');
    aiOnThrow(this);
  }

  // Human swipe throw. sw = { kind, power 0..1, yawOffset (rad, + = right), curve:-1|0|1 (disc curve dir), loft (rad), label }
  humanThrow(sw, h = this.human) {
    if (!h || !h.hasDisc) return;
    if (this.state === 'pull' && this.puller !== h) return;
    if (this.state !== 'live' && this.state !== 'pull') return;
    const isPull = this.state === 'pull';
    const at = h.attrs;
    const assist = isPull ? 0 : ({ assisted: 0.85, semi: 0.5, manual: 0 }[this.settings.assist] ?? 0.85);
    let yaw = sw.yaw;
    let speed = 7 + Math.pow(sw.power, 1.1) * (at.maxThrow - 7);
    let elev = clamp(0.05 + sw.loft + sw.power * 0.05 + (isPull ? 0.18 : 0), -0.12, 0.75);
    let bank = sw.curve * (0.18 + 0.12 * sw.power) * (0.8 + 0.2 * at.breakSkill);
    // aim assistance: find plausible receiver in the swipe direction
    let receiver = null;
    if (assist > 0 && !this.practice || assist > 0 && this.practice) {
      const cone = assist > 0.7 ? 0.38 : 0.2;
      const intendedD = 4 + sw.power * (at.maxThrow * 2.1 - 4);
      let best = 1e9;
      for (const r of this.teams[h.team].athletes) {
        if (r === h) continue;
        const t0 = hyp(r.pos.x - h.pos.x, r.pos.z - h.pos.z) / 15;
        const lx = r.pos.x + r.vel.x * t0 * 1.1, lz = r.pos.z + r.vel.z * t0 * 1.1;
        const dx = lx - h.pos.x, dz = lz - h.pos.z, d = hyp(dx, dz);
        if (d < 3) continue;
        const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw)));
        if (ang > cone) continue;
        if (d > intendedD * 1.7 + 6 || d < intendedD * 0.4 - 4) continue;
        const sc = ang * 12 + Math.abs(d - intendedD) * 0.12;
        if (sc < best) { best = sc; receiver = r; }
      }
      if (receiver) {
        // solve (without wind — the assist does not read the wind for you)
        const rp = this.releasePoint(h);
        let t = 1, L;
        for (let k = 0; k < 2; k++) {
          L = { x: receiver.pos.x + receiver.vel.x * t, y: 1.25, z: receiver.pos.z + receiver.vel.z * t };
          L.x = clamp(L.x, -this.field.hw + 0.5, this.field.hw - 0.5);
          const sol = solveThrow(rp, L, { maxSpeed: at.maxThrow, bank, spinDir: (sw.kind === 'bh') === (h.hand === 'right') ? 1 : -1, wind: null, loft: Math.max(0, sw.loft) });
          t = sol.t;
          if (k === 1) {
            yaw = yaw + Math.atan2(Math.sin(sol.yaw - yaw), Math.cos(sol.yaw - yaw)) * assist;
            speed = speed + (Math.min(sol.speed, at.maxThrow) - speed) * assist;
            elev = elev + (sol.elev - elev) * assist;
          }
        }
      }
    }
    // execution error: attributes, rain, wind, power
    const w = this.weather;
    const sigma = 0.022 * at.throwErr * (1 + w.rain * 0.6) * (1 + w.current / 9 * at.windCtrl) * (0.6 + sw.power * 0.9) * (sw.curve !== 0 ? 1.15 / at.breakSkill : 1);
    yaw += this.gauss() * sigma;
    speed *= 1 + this.gauss() * sigma * 0.5;
    elev += this.gauss() * sigma * 0.5;
    bank += this.gauss() * sigma * 1.2;
    if (w.rain > 0.3 && this.rng() < w.rain * 0.04 * at.throwErr) { speed *= 0.75; bank += (this.rng() - 0.5) * 0.5; this.msg('SLIPPED RELEASE', 'warn', 1.2); }
    this.executeThrow(h, { kind: sw.kind, yaw, elev, speed, bank, quality: 1 - sigma * 4 }, { isPull, receiver, label: sw.label });
    if (isPull) this.afterPullRelease();
  }

  gauss() { let u = 0, v = 0; while (!u) u = this.rng(); v = this.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  aiPull(a) {
    if (!a.hasDisc) return;
    const f = this.field, d = a.dir;
    const tz = d * (f.gl - 2 - this.rng() * 10), tx = (this.rng() - 0.5) * f.W * 0.5;
    a.facing = d > 0 ? 0 : Math.PI;
    a.throwAnim = { kind: 'bh', stage: 'wind', w: 1 };
    const rp = this.releasePoint(a);
    const curve = this.rng() < 0.5 ? -1 : 1;
    const sol = solveThrow(rp, { x: tx, y: 0.5, z: tz }, { maxSpeed: a.attrs.maxThrow, bank: curve * 0.15, spinDir: a.hand === 'right' ? 1 : -1, wind: this.weather.wind, loft: 0.9 });
    const e = 0.03 * this.diff.noise;
    this.executeThrow(a, { kind: 'bh', yaw: sol.yaw + this.gauss() * e, elev: sol.elev + this.gauss() * e * 0.5, speed: Math.min(a.attrs.maxThrow, sol.speed) * (1 + this.gauss() * e * 0.3), bank: curve * 0.15, quality: 0.9 }, { isPull: true });
    this.afterPullRelease();
  }

  afterPullRelease() {
    this.state = 'live'; this.stateT = 0;
    this.emit('pull');
    assignDefense(this, 1 - this.offense);
  }

  // ------------------------------------------------------------------ disc update / catching
  updateDisc(dt) {
    const D = this.disc;
    if (this.dmode === 'held' || this.dmode === 'dead') {
      if (this.holder) {
        const rp = this.releasePoint(this.holder);
        D.p.x = rp.x; D.p.y = rp.y; D.p.z = rp.z; D.v.x = D.v.y = D.v.z = 0;
      }
      return;
    }
    if (this.dmode === 'air') {
      const ti = this.throwInfo; ti.t += dt; this.predAge += dt;
      if (this.predAge > 0.3) { this.predN = predict(D, this.weather.wind, this.pred, 7, 1 / 60, 2); this.predAge = 0; }
      const hit = stepDisc(D, dt, this.weather.wind);
      const f = this.field;
      if (Math.abs(D.p.x) <= f.hw && Math.abs(D.p.z) <= f.hl) { this.lastIn.x = D.p.x; this.lastIn.z = D.p.z; }
      if (!hit) this.tryCatches();
      if (this.dmode === 'air' && (hit || D.grounded)) this.onGround();
      return;
    }
    if (this.dmode === 'cosmetic') {
      D.v.y -= 9.81 * dt; D.p.x += D.v.x * dt; D.p.y += D.v.y * dt; D.p.z += D.v.z * dt;
      if (D.p.y < 0.016) {
        D.p.y = 0.016;
        if (D.v.y < -1.5) { D.v.y = -D.v.y * 0.42; D.v.x *= 0.75; D.v.z *= 0.75; D.tumble *= 0.7; this.emit('sfx', { s: 'ground' }); }
        else { D.v.y = 0; D.v.x *= 0.9; D.v.z *= 0.9; D.tumble *= 0.9; }
      }
      // tumbling orientation
      const tt = (D.tumbleA = (D.tumbleA || 0) + (D.tumble || 0) * dt);
      if (D.p.y > 0.03) { D.n.x = Math.sin(tt); D.n.y = Math.cos(tt); D.n.z = Math.sin(tt * 0.7) * 0.3; }
      else { D.n.x *= 0.8; D.n.z *= 0.8; D.n.y = 1; }
      const nl = hyp(D.n.x, D.n.y, D.n.z) || 1; D.n.x /= nl; D.n.y /= nl; D.n.z /= nl;
      D.spin = 40;
      return;
    }
    if (this.dmode === 'ground') {
      stepDisc(D, dt, null);
      this.groundT += dt;
      // pickup
      const pk = this.pickup;
      if (this.picker && this.picker.isHuman && !this.autoHuman && this.groundT > 4) {
        // human didn't go for it: nearest bot teammate picks it up
        let best = null, bd = 1e9;
        for (const a of this.teams[this.offense].athletes) { if (a.isHuman) continue; const d = hyp(a.pos.x - pk.x, a.pos.z - pk.z); if (d < bd) { bd = d; best = a; } }
        if (best) this.picker = best;
      }
      if (pk && this.groundT > 0.4) {
        for (const a of this.teams[this.offense].athletes) {
          if (a.y > 0.05 || a.dive || a.recoverT > 0) continue;
          if (hyp(a.pos.x - this.pickup.x, a.pos.z - this.pickup.z) < 0.9) {
            // relocate disc to the legal spot
            a.pos.x = pk.x; a.pos.z = pk.z; a.vel.x = a.vel.z = 0;
            this.give(a); this.state = 'live';
            assignDefense(this, 1 - this.offense);
            this.emit('pickup', { a });
            break;
          }
        }
      }
    }
  }

  // Reach volume of an athlete for this step. Standing: a cylinder around the body up to standing reach (+ jump).
  // Diving: a sweep from the chest to the outstretched hands along the dive direction; the hands start high
  // at take-off and drop toward the turf as the layout extends.
  reachVolume(a) {
    const sc = a.attrs.scale, D = this.disc;
    if (a.dive) {
      const t = a.dive.t;
      const ext = Math.min(1, t / 0.18);                 // arms extend over the first 0.18 s
      const len = 0.35 + 1.25 * ext;                     // hands up to ~1.6 m ahead of the hips
      const top = Math.max(0.5, 1.55 - t * 1.4), low = 0.02;
      // distance from disc (xz) to the segment body -> hands
      const ax = a.pos.x, az = a.pos.z, bx = ax + a.dive.dx * len, bz = az + a.dive.dz * len;
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      let u = ((D.p.x - ax) * vx + (D.p.z - az) * vz) / l2; u = clamp(u, 0, 1);
      const dist = hyp(D.p.x - (ax + vx * u), D.p.z - (az + vz * u));
      const r = 0.5 * sc; // body/arm half-width
      const inY = D.p.y >= low && D.p.y <= top;
      return { dist, r, inY, near: dist < r + 0.3, c: clamp(1 - dist / r, 0, 1), hands: u > 0.55 };
    }
    // the intended receiver gets a slightly bigger 'hands' zone (reaching back over the shoulder)
    const intended = this.throwInfo && this.throwInfo.receiver === a;
    const r = (intended ? 1.1 : 0.95) * sc, dist = hyp(D.p.x - a.pos.x, D.p.z - a.pos.z);
    const inY = D.p.y >= 0.3 && D.p.y <= a.attrs.reach + a.y;
    return { dist, r, inY, near: dist < r + 0.25, c: clamp(1 - dist / r, 0, 1), hands: true };
  }

  tryCatches() {
    const D = this.disc, ti = this.throwInfo;
    const rain = this.weather.rain;
    const cands = [];
    for (const a of this.all) {
      if (a === ti.from && ti.touched.length === 0 && ti.t < 1.2) continue; // cannot catch own throw
      if (a.catchCD > 0) continue;
      const v = this.reachVolume(a);
      if (!v.near) { a.reach = null; continue; }
      // reaching animation toward the disc
      const ly = D.p.y - (a.y + 1.45 * a.attrs.scale);
      const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
      const dx = D.p.x - a.pos.x, dz = D.p.z - a.pos.z;
      const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
      const ll = hyp(lx, ly, lz) || 1;
      a.reach = { x: lx / ll, y: ly / ll, z: lz / ll }; a.reachTwo = true;
      if (v.dist > v.r || !v.inY) continue;
      cands.push({ a, v, d: v.dist });
    }
    if (!cands.length) return;
    cands.sort((p, q) => p.d - q.d);
    const contested = cands.length > 1 && cands.some(c => c.a.team !== cands[0].a.team);
    for (const { a, v } of cands) {
      const off = a.team === ti.team;
      if (ti.isPull && off) continue; // pulling team can't catch own pull
      const sp = hyp(D.v.x, D.v.y, D.v.z);
      const sc = a.attrs.scale;
      const c = v.c; // 1 = disc right at the hands/body centre, 0 = fingertips
      // ---------------- defenders: mark blocks, interceptions, knock-downs ----------------
      if (!off && !ti.isPull) {
        const isMark = ti.t < 0.3 && hyp(a.pos.x - ti.from.pos.x, a.pos.z - ti.from.pos.z) < 2.8;
        let pCatch, pBlock;
        if (isMark) {
          // On the mark you mostly get a hand/body on it: a dive into the release lane (the side the thrower
          // releases on — forehand side vs backhand side) at the right moment blocks it; standing still rarely does.
          pCatch = a.dive ? 0.08 * c : 0.02;
          pBlock = a.dive ? 0.35 + 0.6 * Math.sqrt(c) : 0.05 + 0.15 * c;
          if (sp > 20) pBlock *= 0.85;
        } else {
          // Interception: clean catch when the disc is in the hands' sweet spot; otherwise a knock-down.
          const reachQ = a.dive ? (v.hands ? 1 : 0.6) : 1;
          pCatch = (a.dive ? 0.62 : 0.68) * (0.35 + 0.65 * c) * reachQ;
          if (sp > 18) pCatch -= (sp - 18) * 0.02;
          if (D.p.y > 1.9 * sc) pCatch *= a.attrs.highCatch * 0.9;
          if (D.p.y < 0.6 && !a.dive) pCatch *= a.attrs.lowCatch * 0.8;
          pCatch -= rain * 0.15;
          if (contested) pCatch -= 0.1;
          pBlock = a.dive ? 0.92 : 0.8;
        }
        pCatch = clamp(pCatch, 0, 0.95);
        const r = this.rng();
        if (r < pCatch) { this.onCatch(a, contested); return; }
        a.catchCD = 0.35;
        if (this.rng() < pBlock) {
          // contact on the thrower while diving on the mark is a foul: disc goes back
          if (isMark && a.dive && hyp(a.pos.x - ti.from.pos.x, a.pos.z - ti.from.pos.z) < 0.55) {
            this.msg('FOUL ON THE MARK — DISC BACK TO THROWER', 'warn', 2.2);
            this.emit('sfx', { s: 'whistle' });
            const th = ti.from; this.give(th); this.state = 'live'; this.stall = 0;
            return;
          }
          this.knockDown(a, isMark);
          return;
        }
        a.catchCD = 0.6; // whiffed
        continue;
      }
      // ---------------- receivers (and the receiving team on a pull) ----------------
      let p = 0.975;
      if (D.p.y > 1.75 * sc + a.y * 0.3) p *= 0.94 * a.attrs.highCatch;
      if (D.p.y < 0.75) p *= 0.86 * a.attrs.lowCatch;
      if (a.dive) p = (0.62 + 0.3 * c) * (a.attrs.lowCatch * 0.5 + 0.5) * (v.hands ? 1 : 0.6);
      if (sp > 18) p -= (sp - 18) * 0.02;
      if (!a.dive && c < 0.25) p -= (0.25 - c) * (ti.receiver === a ? 0.2 : 0.9); // intended receiver reaches back for it
      const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
      const facing = -(D.v.x * fx + D.v.z * fz) / (sp || 1);
      // a disc arriving from behind: the intended receiver turns and makes an over-the-shoulder catch;
      // anyone else it surprises still struggles
      if (facing < -0.2 && !a.dive) p -= ti.receiver === a ? 0.02 : 0.18;
      if (a.endur < 30) p -= 0.04;
      p -= rain * (0.04 + (1 - p) * 0.6);
      if (contested) p -= 0.14;
      p = clamp(p, 0.05, 0.995);
      if (this.rng() < p) { this.onCatch(a, contested); return; }
      a.catchCD = 0.35;
      const fouler = ti.isPull ? null : this.findContact(a);
      if (fouler) {
        this.msg('FOUL — CONTACT ON RECEIVER', 'warn', 2);
        this.emit('sfx', { s: 'whistle' });
        this.onCatch(a, true, true);
        return;
      }
      ti.touched.push(a);
      D.v.x *= 0.4; D.v.z *= 0.4; D.v.y = Math.min(D.v.y, 0) - 1; D.spin *= 0.4;
      this.emit('drop', { a });
      this.predN = predict(D, this.weather.wind, this.pred, 4, 1 / 60, 2); this.predAge = 0;
      return;
    }
  }

  // defender gets a hand on it: knock the disc out of the air
  knockDown(a, isMark) {
    const D = this.disc, ti = this.throwInfo;
    ti.blocked = true; ti.touched.push(a);
    const dir = a.dive ? { x: a.dive.dx, z: a.dive.dz } : { x: (this.rng() - 0.5), z: (this.rng() - 0.5) };
    D.v.x = D.v.x * 0.2 + dir.x * 2; D.v.z = D.v.z * 0.2 + dir.z * 2; D.v.y = Math.min(D.v.y, -1.5) - this.rng() * 2;
    D.n.x += (this.rng() - 0.5); D.n.z += (this.rng() - 0.5);
    this.stats.blocks[a.team]++;
    this.msg(isMark ? (a.dive ? 'HAND BLOCK ON THE MARK!' : 'MARK BLOCK!') : (a.dive ? 'LAYOUT BLOCK!' : 'BLOCK!'), 'info', 1.8, a.team);
    this.emit('block', { a });
    if (a.dive) this.emit('layout', { a });
    this.predN = predict(D, this.weather.wind, this.pred, 4, 1 / 60, 2); this.predAge = 0;
  }

  // detect illegal contact on receiver: opponent body within 0.62 m approaching fast
  findContact(a) {
    for (const o of this.all) {
      if (o.team === a.team) continue;
      const d = hyp(o.pos.x - a.pos.x, o.pos.z - a.pos.z);
      if (d > 0.62) continue;
      const rv = hyp(o.vel.x - a.vel.x, o.vel.z - a.vel.z);
      const closing = ((o.vel.x - a.vel.x) * (a.pos.x - o.pos.x) + (o.vel.z - a.vel.z) * (a.pos.z - o.pos.z)) / (d || 1);
      if (closing > 3.2 && rv > 3.5 && !o.dive) return o;
    }
    return null;
  }

  onCatch(a, contested, foulAward = false) {
    const ti = this.throwInfo, f = this.field;
    const D = this.disc;
    a.reach = null;
    const off = a.team === ti.team;
    const wasPull = ti.isPull;
    this.dmode = 'held';
    this.emit('catch', { a, contested, dive: !!a.dive, high: D.p.y > 2.1 });
    if (a.dive) this.emit('layout', { a });
    // receiver out of bounds?
    if (!foulAward && (Math.abs(a.pos.x) > f.hw || Math.abs(a.pos.z) > f.hl)) {
      this.msg('OUT OF BOUNDS', 'info', 1.8, 1 - a.team);
      const spot = { x: clamp(a.pos.x, -f.hw, f.hw), z: clamp(a.pos.z, -f.hl, f.hl) };
      if (wasPull) { this.turnTo(a.team, this.brickSpot(a.team), 'BRICK'); return; }
      this.turnTo(1 - a.team, spot);
      return;
    }
    if (off) {
      if (!wasPull) { this.stats.completions++; a.stats.catches++; if (a === this.human) this.stats.humanCatches++; if (ti.from.isHuman) this.lastHumanThrowTo = a; }
      // goal?
      if (!wasPull && this.inAttackingEndzone(a)) { this.scoreGoal(a, ti.from); return; }
    } else {
      // interception (or simply receiving the pull)
      if (!wasPull) this.stats.turnovers[1 - a.team]++;
      if (!wasPull) {
        this.msg(a.dive ? 'LAYOUT INTERCEPTION!' : 'INTERCEPTION!', 'info', 1.8, a.team);
        this.emit('turnover', { team: a.team });
      }
      this.offense = a.team;
      if (this.inAttackingEndzone(a) && !wasPull) { this.msg('CALLAHAN!', 'goal', 2.5); this.scoreGoal(a, null); return; }
    }
    this.give(a);
    // possession gained inside an end zone -> walk to goal line (simplified)
    const zr = a.pos.z * a.dir;
    if (zr > f.gl || zr < -f.gl) { a.pos.z = Math.sign(a.pos.z) * f.gl; }
    this.offense = a.team;
    this.state = 'live';
    this.stall = 0;
    if (wasPull || !off) assignDefense(this, 1 - this.offense);
  }

  inAttackingEndzone(a) {
    const f = this.field;
    const zr = a.pos.z * a.dir;
    return zr >= f.gl && zr <= f.hl && Math.abs(a.pos.x) <= f.hw;
  }

  brickSpot(team) { const t = this.teams[team]; return { x: 0, z: -t.dir * this.field.brick }; }

  onGround() {
    const ti = this.throwInfo, D = this.disc, f = this.field;
    const inb = Math.abs(D.p.x) <= f.hw && Math.abs(D.p.z) <= f.hl;
    this.emit('ground', { inb });
    if (ti.isPull) {
      const rec = this.offense;
      const touchedByRec = ti.touched.some(a => a.team === rec);
      if (touchedByRec) { this.msg('DROPPED PULL — TURNOVER', 'info', 1.8, 1 - rec); this.turnTo(1 - rec, { x: D.p.x, z: D.p.z }); return; }
      if (!inb) { this.msg('BRICK', 'info'); this.turnTo(rec, this.brickSpot(rec), null, true); return; }
      this.turnTo(rec, null, null, true);
      return;
    }
    if (this.practice) {
      this.msg(inb ? (ti.touched.length ? 'DROP' : 'INCOMPLETE') : 'OUT OF BOUNDS', 'info', 1.2);
      this.turnTo(0, inb ? null : { x: clamp(this.lastIn.x, -f.hw, f.hw), z: clamp(this.lastIn.z, -f.hl, f.hl) }, null, true);
      return;
    }
    // turnover
    const newOff = 1 - ti.team;
    let spot = null;
    if (!inb) { this.msg('OUT OF BOUNDS — TURNOVER', 'info', 1.8, newOff); spot = { x: clamp(this.lastIn.x, -f.hw, f.hw), z: clamp(this.lastIn.z, -f.hl, f.hl) }; }
    else if (ti.blocked) { /* already announced */ }
    else if (ti.touched.length) this.msg('DROP — TURNOVER', 'info', 1.8, newOff);
    else this.msg('TURNOVER', 'info', 1.8, newOff);
    this.stats.turnovers[ti.team]++;
    this.emit('turnover', { team: newOff });
    this.turnTo(newOff, spot);
  }

  // possession to team; disc lies on ground (spot override), pickup by nearest
  turnTo(team, spot, label, quiet) {
    const f = this.field, D = this.disc;
    this.offense = team;
    this.dmode = 'ground'; this.groundT = 0; this.holder = null;
    for (const a of this.all) a.hasDisc = false;
    if (!D.grounded) { D.grounded = true; D.p.y = 0.016; }
    let px = spot ? spot.x : D.p.x, pz = spot ? spot.z : D.p.z;
    // estimate resting point if still skidding
    if (!spot) { px += D.v.x * 0.3; pz += D.v.z * 0.3; }
    px = clamp(px, -f.hw, f.hw); pz = clamp(pz, -f.hl, f.hl);
    // inside an end zone -> bring to the nearest goal line
    if (Math.abs(pz) > f.gl) pz = Math.sign(pz) * f.gl;
    if (spot) { D.p.x = px; D.p.z = pz; D.v.x = D.v.z = 0; }
    this.pickup = { x: px, z: pz };
    this.state = 'live';
    this.stall = 0;
    // designate picker: nearest athlete of the new offense
    let best = null, bd = 1e9;
    for (const a of this.teams[team].athletes) { const d = hyp(a.pos.x - px, a.pos.z - pz); if (d < bd) { bd = d; best = a; } }
    this.picker = best;
    if (!this.practice) assignDefense(this, 1 - team);
    if (best && best.isHuman && !quiet) this.emit('prompt', { text: 'PICK UP THE DISC', a: best });
  }

  // ------------------------------------------------------------------ stall
  updateStall(dt) {
    if (this.dmode === 'held' && this.holder) this.holdT += dt;
    if (this.practice || this.state !== 'live' || this.dmode !== 'held' || !this.holder) { return; }
    const h = this.holder;
    // marker within 3 m?
    let marker = null;
    for (const o of this.teams[1 - h.team].athletes) if (hyp(o.pos.x - h.pos.x, o.pos.z - h.pos.z) < 3) { marker = o; break; }
    if (!marker || this.holdT < 0.6) { if (!marker) this.stall = Math.max(0, this.stall - dt * 0.5); return; }
    // marking violation: too close (human only realistically)
    if (hyp(marker.pos.x - h.pos.x, marker.pos.z - h.pos.z) < 0.5 && marker.isHuman) {
      if ((this.lastMarkFoul || -9) < this.time - 3) { this.lastMarkFoul = this.time; this.msg('MARKING VIOLATION — STALL RESET', 'warn', 1.4); this.stall = 0; }
    }
    const before = Math.floor(this.stall);
    this.stall += dt / (this.settings.stallSeconds || 1);
    const after = Math.floor(this.stall);
    if (after !== before) this.emit('stall', { n: after, holder: h });
    if (this.stall >= 10) {
      this.msg('STALL — TURNOVER', 'info', 1.8, 1 - h.team);
      this.stats.turnovers[h.team]++;
      const spot = { x: h.pos.x, z: h.pos.z };
      h.hasDisc = false; this.holder = null;
      this.disc.p.x = spot.x; this.disc.p.z = spot.z; this.disc.p.y = 0.016; this.disc.grounded = true;
      this.emit('turnover', { team: 1 - h.team });
      this.turnTo(1 - h.team, spot);
    }
  }

  // ------------------------------------------------------------------ scoring / clock / caps
  scoreGoal(scorer, assist) {
    const T = this.teams[scorer.team];
    T.score++;
    this.state = 'goal'; this.stateT = 0; this.dmode = 'dead';
    this.lastScorer = scorer.team;
    this.give(scorer); this.dmode = 'dead';
    scorer.stats.goals++; if (assist && assist !== scorer && assist.team === scorer.team) assist.stats.assists++;
    if (scorer === this.human) this.stats.humanGoals++;
    if (assist && assist === this.human && assist.team === scorer.team) this.stats.humanAssists++;
    for (const a of this.all) { a.anim = a.team === scorer.team ? 'celebrate' : 'dejected'; a.animT = GOAL_CELEBRATION; a.emote = null; }
    this.lastGoal = { scorer, assist: assist && assist !== scorer && assist.team === scorer.team ? assist : null };
    // bot scorers / assisters sometimes emote on their own
    this.botEmotes = [];
    const auto = (a) => a && (!a.isHuman || this.autoHuman);
    if (auto(scorer) && this.rng() < 0.7) this.botEmotes.push({ a: scorer, n: this.rng() < 0.12 ? 4 : 1 + Math.floor(this.rng() * 3), at: 1.2 + this.rng() * 1.5 });
    if (auto(this.lastGoal.assist) && this.rng() < 0.5) this.botEmotes.push({ a: this.lastGoal.assist, n: 5, at: 1.5 + this.rng() * 2 });
    this.msg('GOAL!', 'goal', 3);
    this.emit('goal', { team: scorer.team, scorer, assist, scores: [this.teams[0].score, this.teams[1].score] });
  }

  // ------------------------------------------------------------------ goal emotes
  canEmote(a, n) {
    const e = EMOTES[n];
    if (!e || this.state !== 'goal' || !this.lastGoal) return false;
    if (a.emote && a.emote.t < a.emote.dur) return false;
    return e.who === 'scorer' ? this.lastGoal.scorer === a : this.lastGoal.assist === a;
  }
  emote(a, n) {
    if (!this.canEmote(a, n)) return false;
    const e = EMOTES[n];
    // spike / drop kick need the disc back in hand
    if ((e.kind === 'spike' || e.kind === 'dropkick') && this.holder !== a) return false;
    a.emote = { kind: e.kind, t: 0, dur: e.dur, stage: 0 };
    if (e.kind === 'moon') {
      // turn your back to the opposing team (toward the middle of their players)
      const opp = this.teams[1 - a.team].athletes; let cx = 0, cz = 0;
      for (const o of opp) { cx += o.pos.x; cz += o.pos.z; } cx /= opp.length || 1; cz /= opp.length || 1;
      a.facing = Math.atan2(cx - a.pos.x, cz - a.pos.z) + Math.PI;
      if (this.holder === a) { // drop the disc at your feet first
        const D = this.disc; this.dmode = 'cosmetic';
        D.v.x = Math.sin(a.facing) * 0.8; D.v.y = 0.5; D.v.z = Math.cos(a.facing) * 0.8; D.grounded = false; D.tumble = 3;
      }
    }
    a.facing = a.facing; a.want.face = null;
    this.emit('emote', { a, kind: e.kind });
    return true;
  }
  updateEmotes(dt) {
    for (const b of this.botEmotes || []) if (!b.done && this.stateT >= b.at) { b.done = true; this.emote(b.a, b.n); }
    const D = this.disc;
    for (const a of this.all) {
      const em = a.emote; if (!em) continue;
      em.t += dt;
      const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
      if (em.kind === 'spike' && em.stage === 0 && em.t >= 0.52) {
        // slam it into the turf
        em.stage = 1; this.dmode = 'cosmetic';
        D.v.x = fx * 4; D.v.y = -17; D.v.z = fz * 4; D.grounded = false; D.tumble = 14;
        this.emit('sfx', { s: 'block' });
      }
      if (em.kind === 'dropkick') {
        if (em.stage === 0 && em.t >= 0.38) { em.stage = 1; this.dmode = 'cosmetic'; D.v.x = fx * 0.3; D.v.y = 0; D.v.z = fz * 0.3; D.grounded = false; D.tumble = 2; }
        if (em.stage === 1 && em.t >= 0.66) {
          // boot it: disc meets the foot just below the knee
          em.stage = 2; D.p.x = a.pos.x + fx * 0.55; D.p.y = 0.45; D.p.z = a.pos.z + fz * 0.55;
          D.v.x = fx * 17; D.v.y = 11; D.v.z = fz * 17; D.tumble = 22;
          this.emit('sfx', { s: 'block' }); this.emit('huck');
        }
      }
      if (em.t >= em.dur) { a.emote = null; a.anim = 'celebrate'; }
    }
  }

  afterGoal() {
    const s0 = this.teams[0].score, s1 = this.teams[1].score;
    // end-of-point cap processing
    const cs = this.capState;
    const hi = Math.max(s0, s1);
    if (cs.pendingHard) {
      cs.pendingHard = false; cs.hard = true;
      if (s0 !== s1) { this.endMatch(s0 > s1 ? 0 : 1); return; }
      this.target = hi + 1; this.msg('HARD CAP — NEXT POINT WINS', 'universe', 3);
    } else if (cs.pendingTime) {
      cs.pendingTime = false; cs.time = true;
      if (hi < this.target) { this.target = hi + 1; this.msg('TIME CAP — GAME TO ' + this.target, 'warn', 3); }
    } else if (cs.pendingSoft) {
      cs.pendingSoft = false; cs.soft = true;
      if (hi < this.target) { this.target = Math.min(this.target, hi + 1); this.msg('SOFT CAP — GAME TO ' + this.target, 'warn', 3); }
    }
    if (s0 >= this.target || s1 >= this.target) { this.endMatch(s0 > s1 ? 0 : 1); return; }
    // halftime
    const halfPts = Math.ceil(this.origTarget / 2);
    const halfTimeCap = this.settings.rules !== 'simple' && this.clock * 5 / 60 >= this.durationMin * 0.5 + 5;
    if (!this.halfDone && (hi >= halfPts || halfTimeCap)) {
      this.halfDone = true; this.state = 'halftime'; this.stateT = 0;
      this.msg('HALFTIME', 'info', 4.5);
      this.emit('halftime');
      for (const t of this.teams) t.dir *= -1;
      return;
    }
    // teams switch ends; scoring team pulls
    for (const t of this.teams) t.dir *= -1;
    this.startPoint(1 - this.lastScorer);
  }

  checkTimeCaps() {
    if (this.settings.rules === 'simple') return;
    const min = this.clock * 5 / 60;
    const cs = this.capState;
    if (this.settings.rules === 'usau') {
      if (!cs.soft && !cs.pendingSoft && min >= this.softCapMin) { cs.pendingSoft = true; this.msg('SOFT CAP ON — FINISH THE POINT', 'warn', 2.5); this.emit('cap', { kind: 'soft' }); }
      if (!cs.hard && !cs.pendingHard && min >= this.hardCapMin) { cs.pendingHard = true; cs.pendingSoft = false; this.msg('HARD CAP ON — FINISH THE POINT', 'warn', 2.5); this.emit('cap', { kind: 'hard' }); }
    } else {
      if (!cs.time && !cs.pendingTime && min >= this.durationMin) { cs.pendingTime = true; this.msg('TIME CAP — FINISH THE POINT', 'warn', 2.5); this.emit('cap', { kind: 'time' }); }
    }
  }

  endMatch(w) {
    this.state = 'over'; this.over = true; this.winner = w; this.dmode = 'dead';
    for (const a of this.all) { a.anim = a.team === w ? 'celebrate' : 'dejected'; a.animT = 99; }
    this.emit('over', { winner: w });
  }

  displayClock() {
    const totalMin = this.settings.rules === 'usau' ? this.hardCapMin : this.durationMin;
    const rem = Math.max(0, totalMin * 60 - this.clock * 5);
    return rem;
  }

  // Online: a disconnected human's athlete is driven by the AI until they reconnect.
  setHumanControl(ctrlId, on) {
    const a = this.humans.find(x => x.ctrl === ctrlId); if (!a || a.isHuman === on) return a || null;
    a.isHuman = on;
    a.want.x = a.want.z = 0; a.want.sprint = false; a.want.face = null; a.lookYaw = undefined;
    a.ai.state = 'idle'; a.ai.plan = null; a.ai.decideT = 0;
    if (a.throwAnim && a.throwAnim.stage === 'wind') a.throwAnim = null;
    return a;
  }

  isUniverse() { return !this.practice && this.teams[0].score === this.target - 1 && this.teams[1].score === this.target - 1; }
}
