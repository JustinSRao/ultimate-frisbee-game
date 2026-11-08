// ============================================================================
// NET: online session (REST + WebSocket) and RemoteGame, a read-only mirror of
// the server's Game built from snapshots so the renderer/HUD can draw it unchanged.
// - remote athletes: interpolated ~100 ms behind the newest snapshot
// - your athlete: predicted locally from your inputs, reconciled on acked seq
// - disc + every rule decision: server only
// ============================================================================
import { PROTO, INPUT_HZ, decodeEvent } from '../../shared/protocol.js';
import { runStep } from '../../shared/movement.js';
import { WIND_DIRS } from '../../shared/config.js';
import { serverUrl, wsUrl } from './serverConfig.js';
import { playerId } from './storage.js';

const INTERP = 0.1; // s behind the newest snapshot
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAng = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class ServerBusy extends Error { constructor(msg) { super(msg || 'Servers are busy — please try again later.'); } }

async function api(path, opts) {
  let r;
  try { r = await fetch(serverUrl() + path, opts); } catch (e) { throw new ServerBusy('Can\'t reach the game server — check your connection or try again later.'); }
  if (r.status === 404) { const e = new Error('Room not found — check the code.'); e.code = 'notfound'; throw e; }
  if (!r.ok) throw new ServerBusy();
  return r.json();
}
export const createRoom = (kind = 'match', tournament = null) => api('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, tournament }) });
export const roomInfo = (code) => api('/api/rooms/' + encodeURIComponent(code));

// ---------------------------------------------------------------- session
export class OnlineSession {
  constructor(code, cfg, handlers) {
    this.code = code.toUpperCase(); this.cfg = cfg; this.h = handlers; this.pid = playerId();
    this.ws = null; this.closed = false; this.retries = 0; this.lobby = null; this.rtt = 0;
  }
  connect() {
    return new Promise((resolve, reject) => {
      let opened = false;
      const ws = new WebSocket(`${wsUrl(serverUrl())}/api/rooms/${this.code}/ws?pid=${this.pid}`);
      this.ws = ws;
      ws.onopen = () => { opened = true; this.retries = 0; this.send({ t: 'hello', v: PROTO, cfg: this.cfg }); resolve(); };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this.onMsg(m); };
      ws.onerror = () => { if (!opened) reject(new ServerBusy('Couldn\'t connect to the room — servers busy, try later.')); };
      ws.onclose = (e) => {
        if (this.ws !== ws) return;
        if (this.closed || e.code >= 4000) { this.h.onClose && this.h.onClose(e.code, this.lastErr); return; }
        // unexpected drop: retry for up to ~60 s (the server keeps our athlete for 60 s)
        if (opened && this.retries < 12) { this.retries++; this.h.onReconnecting && this.h.onReconnecting(); setTimeout(() => !this.closed && this.connect().catch(() => { }), 1000 + this.retries * 400); }
        else this.h.onClose && this.h.onClose(e.code, this.lastErr);
      };
    });
  }
  onMsg(m) {
    switch (m.t) {
      case 'lobby': this.lobby = m; this.h.onLobby && this.h.onLobby(m); break;
      case 'start': this.h.onStart && this.h.onStart(m); break;
      case 's': this.h.onSnap && this.h.onSnap(m); break;
      case 'over': this.h.onOver && this.h.onOver(m); break;
      case 'err': this.lastErr = m; this.h.onError && this.h.onError(m); break;
      case 'pong': this.rtt = performance.now() - m.c; break;
    }
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  pick(team, slot) { this.send({ t: 'pick', team, slot }); }
  settings(s) { this.send({ t: 'settings', settings: s }); }
  lock(on) { this.send({ t: 'lock', on }); }
  start() { this.send({ t: 'start' }); }
  profile(cfg) { this.cfg = cfg; this.send({ t: 'profile', cfg }); }
  leave() { this.closed = true; this.send({ t: 'leave' }); try { this.ws && this.ws.close(1000); } catch (e) { } }
  get isHost() { return this.lobby && this.lobby.host === this.pid; }
}

// ---------------------------------------------------------------- remote game mirror
const DIR_ANG = { N: 0, NE: Math.PI / 4, E: Math.PI / 2, SE: 3 * Math.PI / 4, S: Math.PI, SW: -3 * Math.PI / 4, W: -Math.PI / 2, NW: -Math.PI / 4 };

export class RemoteGame {
  constructor(start, session, emit) {
    const R = start.roster;
    this.remote = true; this.session = session; this.emit = emit || (() => { });
    this.practice = false; this.autoHuman = false; this.mode = 'match';
    this.n = R.n; this.field = R.field; this.target = R.target; this.origTarget = R.origTarget;
    this.durationMin = R.durationMin; this.hardCapMin = R.hardCapMin; this.settings = { ...R.settings };
    this.teams = R.teams.map(t => ({ key: t.key, kit: t.kit, dir: t.dir, score: 0, athletes: [] }));
    this.byId = new Map();
    const game = this;
    for (const r of R.athletes) {
      const a = {
        ...r, isHuman: !!r.ctrl, pos: { x: 0, z: 0 }, prev: { x: 0, z: 0, y: 0, f: 0 }, vel: { x: 0, z: 0 }, y: 0, vy: 0, facing: 0, speedH: 0,
        accelLean: 0, turnLean: 0, hasDisc: false, throwAnim: null, emote: null, dive: null, reach: null, reachTwo: false, lookYaw: undefined,
        anim: '', callT: 0, endur: 100, sprintE: 100, sprintTime: 0, lunge: { x: 0, z: 0 }, pivotLunge: 0, recoverT: 0,
        ai: { state: '', mark: null }, want: { x: 0, z: 0, face: null, sprint: false }, stats: { goals: 0, assists: 0, catches: 0, throws: 0 },
      };
      Object.defineProperty(a, 'dir', { get() { return game.teams[a.team].dir; } });
      this.byId.set(a.id, a); this.teams[a.team].athletes.push(a);
    }
    this.all = [...this.teams[0].athletes, ...this.teams[1].athletes];
    this.humans = this.all.filter(a => a.ctrl);
    this.human = this.all.find(a => a.ctrl === start.you) || this.all[0];
    this.disc = { p: { x: 0, y: 0, z: 0 }, n: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, spin: 0, spinDir: 1 };
    this.discPrev = { x: 0, y: 0, z: 0 };
    this.weather = { wind: { x: 0, z: 0 }, current: 0, rain: 0, ang: 0, dirLabel() { let best = 'N', bd = 9; for (const k of WIND_DIRS) { const d = Math.abs(Math.atan2(Math.sin(this.ang - DIR_ANG[k]), Math.cos(this.ang - DIR_ANG[k]))); if (d < bd) { bd = d; best = k; } } return best; } };
    this.state = 'lineup'; this.stateT = 0; this.offense = 0; this.half = 1; this.clock = 0; this.time = 0;
    this.capState = {}; this.stall = 0; this.pullDeadline = 0; this.puller = null; this.picker = null; this.dmode = 'held'; this.holder = null;
    this.throwInfo = null; this.lastGoal = null; this.over = false; this.winner = -1;
    this.stats = { completions: 0, throws: 0, turnovers: [0, 0], blocks: [0, 0], humanCatches: 0, humanThrows: 0, humanGoals: 0, humanAssists: 0 };
    this.snaps = []; this.evq = []; this.off = null;
    this.hist = []; this.seq = 0; this.lastSend = 0; this.lastSent = null; this.ack = 0;
    this.pred = null; this.corr = { x: 0, z: 0 }; this.predAcc = 0;
  }

  // ---- incoming
  onSnap(s) {
    const now = performance.now() / 1000;
    const off = s.st - now;
    if (this.off === null || off > this.off) this.off = off; else this.off += (off - this.off) * 0.02; // track the fastest path, drift slowly
    this.snaps.push(s); if (this.snaps.length > 40) this.snaps.shift();
    for (const ev of s.ev) this.evq.push({ st: s.st, ev });
    if (s.ack && s.ack[this.session.pid] !== undefined) this.ack = s.ack[this.session.pid];
    this.reconcile(s);
  }

  // ---- outgoing (called from the frame loop with the local input)
  sendInput(inp, now) {
    const q = (v, k = 20) => Math.round(v * k) / k;
    const m = { t: 'in', mx: q(inp.mx), mz: q(inp.mz), sprint: !!inp.sprint, jump: !!inp.jump, dive: !!inp.dive, call: !!inp.call, aimYaw: q(inp.aimYaw, 50), faceYaw: inp.faceYaw === null || inp.faceYaw === undefined ? null : q(inp.faceYaw, 50), tw: inp.tw || null, tww: q(inp.tww || 0, 10) };
    const key = JSON.stringify(m);
    const oneShot = m.jump || m.dive || m.call;
    // send on change (max INPUT_HZ) or as a 5 Hz heartbeat: keeps the request count inside the free tier
    if (!oneShot && key === this.lastSent && now - this.lastSend < 0.2) return false;
    if (!oneShot && now - this.lastSend < 1 / INPUT_HZ) return false;
    m.seq = ++this.seq; this.lastSent = key; this.lastSend = now;
    this.session.send(m);
    this.hist.push({ seq: m.seq, t: now, mx: m.mx, mz: m.mz, sprint: m.sprint, faceYaw: m.faceYaw });
    if (this.hist.length > 90) this.hist.shift();
    return true;
  }
  humanThrow(sw) { this.session.send({ t: 'throw', kind: sw.kind, power: sw.power, yaw: sw.yaw, curve: sw.curve, loft: sw.loft, label: sw.label }); this.localThrowT = performance.now(); }
  emote(a, n) { if (a !== this.human || this.state !== 'goal') return false; this.session.send({ t: 'emote', n }); return true; }

  // ---- per frame
  update(dt, inp) {
    const now = performance.now() / 1000;
    if (inp) this.sendInput(inp, now);
    if (!this.snaps.length) return;
    const rt = now + this.off - INTERP;
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].st > rt) i--;
    const s1 = this.snaps[i], s0 = this.snaps[Math.max(0, i - 1)];
    const k = s1 === s0 || s1.st <= s0.st ? 1 : Math.max(0, Math.min(1, (rt - s0.st) / (s1.st - s0.st)));
    // events whose time has come (or anything stale)
    while (this.evq.length && (this.evq[0].st <= rt || this.evq[0].st < rt - 0.5 || this.evq.length > 200)) {
      const { ev } = this.evq.shift(); const [t, d] = decodeEvent(ev, this.byId); this.emit(t, d || {});
    }
    this.applyGlobal(s1);
    const rows1 = new Map(s1.a.map(r => [r[0], r])), rows0 = new Map(s0.a.map(r => [r[0], r]));
    const newest = this.snaps[this.snaps.length - 1];
    const rowsN = new Map(newest.a.map(r => [r[0], r]));
    for (const a of this.all) {
      if (a === this.human && this.ownMode(rowsN.get(a.id), newest)) continue; // handled below
      const r1 = rows1.get(a.id), r0 = rows0.get(a.id) || r1; if (!r1) continue;
      this.applyRow(a, r1);
      a.pos.x = lerp(r0[1], r1[1], k); a.pos.z = lerp(r0[2], r1[2], k); a.y = lerp(r0[3], r1[3], k); a.facing = lerpAng(r0[6], r1[6], k);
    }
    this.updateOwn(dt, inp, rowsN.get(this.human.id), newest);
    // disc
    const d0 = s0.disc, d1 = s1.disc, D = this.disc;
    D.p.x = lerp(d0[0], d1[0], k); D.p.y = lerp(d0[1], d1[1], k); D.p.z = lerp(d0[2], d1[2], k);
    D.n.x = d1[3]; D.n.y = d1[4]; D.n.z = d1[5]; D.spin = d1[6]; D.spinDir = d1[7]; D.v.x = d1[8]; D.v.y = d1[9]; D.v.z = d1[10];
    this.discPrev.x = D.p.x; this.discPrev.y = D.p.y; this.discPrev.z = D.p.z;
    for (const a of this.all) { a.prev.x = a.pos.x; a.prev.z = a.pos.z; a.prev.y = a.y; a.prev.f = a.facing; }
    this.time = rt;
  }

  applyGlobal(s) {
    this.state = s.state; this.stateT = s.stateT; this.offense = s.off; this.half = s.half; this.clock = s.clock; this.target = s.target;
    this.teams[0].score = s.sc[0]; this.teams[1].score = s.sc[1]; this.teams[0].dir = s.dir[0]; this.teams[1].dir = s.dir[1];
    this.capState = s.cap || {}; this.stall = s.stall; this.pullDeadline = s.pd; this.dmode = s.dm;
    this.puller = this.byId.get(s.puller) || null; this.picker = this.byId.get(s.picker) || null; this.holder = this.byId.get(s.holder) || null;
    this.throwInfo = s.ti ? { receiver: this.byId.get(s.ti.r) || null, isPull: !!s.ti.p, from: this.byId.get(s.ti.f) || null } : null;
    this.lastGoal = s.lg ? { scorer: this.byId.get(s.lg.s) || null, assist: this.byId.get(s.lg.a) || null } : null;
    const w = this.weather; w.wind.x = s.w[0]; w.wind.z = s.w[1]; w.current = s.w[2]; w.rain = s.w[3]; w.ang = s.w[4];
    if (s.over && !this.over) { this.over = true; this.winner = s.winner; }
    if (s.fs) this.applyFinal(s.fs);
  }
  applyFinal(fs) {
    const me = fs.athletes.find(x => x.id === this.human.id) || {};
    this.stats = { ...fs.stats, humanGoals: me.goals || 0, humanAssists: me.assists || 0, humanCatches: me.catches || 0, humanThrows: me.throws || 0 };
    this.clock = fs.clock; this.winner = fs.winner;
  }
  applyRow(a, r) {
    a.vel.x = r[4]; a.vel.z = r[5]; a.speedH = r[7]; a.accelLean = r[8]; a.turnLean = r[9]; a.anim = r[10];
    const ta = r[11]; a.throwAnim = ta ? { kind: ta[0], stage: ta[1], w: ta[2], t: ta[3] } : null;
    const em = r[12]; a.emote = em ? { kind: em[0], t: em[1], dur: em[2], stage: em[3] } : null;
    const dv = r[13]; a.dive = dv ? { t: dv[0], dx: dv[1], dz: dv[2], ground: !!dv[3] } : null;
    const rc = r[14]; a.reach = rc ? { x: rc[0], y: rc[1], z: rc[2] } : null; a.reachTwo = rc ? !!rc[3] : false;
    a.lookYaw = r[15] === null ? undefined : r[15];
    a.hasDisc = !!(r[16] & 1); a.isHuman = !!(r[16] & 2);
    a.callT = r[17]; a.endur = r[18]; a.sprintE = r[19]; a.lunge.x = r[20]; a.lunge.z = r[21]; a.pivotLunge = r[22];
    a.ai.mark = r[23] >= 0 ? this.byId.get(r[23]) || null : null; a.ai.state = r[24]; a.recoverT = r[25]; a.vy = r[26]; a.sprintTime = r[27];
  }

  // own athlete: predicted when free-running, otherwise the newest server state (no interpolation delay)
  ownMode(r, s) { return !!r; }
  canPredict(r, s) { return r && s.state === 'live' && !r[13] && r[3] <= 0.01 && !(r[16] & 1) && (r[16] & 2) && r[25] <= 0; }
  reconcile(s) {
    const r = s.a.find(x => x[0] === this.human.id); if (!r) return;
    if (!this.canPredict(r, s)) { this.pred = null; return; }
    const old = this.pred ? { x: this.pred.pos.x, z: this.pred.pos.z } : null;
    const a = this.human;
    const p = { pos: { x: r[1], z: r[2] }, vel: { x: r[4], z: r[5] }, facing: r[6], speedH: r[7], attrs: a.attrs, sprintE: r[19], endur: r[18], sprintTime: r[27] };
    // replay inputs the server hasn't processed yet
    const now = performance.now() / 1000;
    const un = this.hist.filter(h => h.seq > this.ack);
    for (let i = 0; i < un.length; i++) {
      const dur = Math.min(0.25, ((i + 1 < un.length ? un[i + 1].t : now) - un[i].t));
      const steps = Math.round(dur * 60);
      for (let j = 0; j < steps; j++) runStep(p, un[i], 1 / 60, this.weather.rain, this.field);
    }
    if (old) { this.corr.x += old.x - p.pos.x; this.corr.z += old.z - p.pos.z; if (Math.hypot(this.corr.x, this.corr.z) > 3) this.corr.x = this.corr.z = 0; }
    this.pred = p; this.predAcc = 0;
  }
  updateOwn(dt, inp, r, s) {
    const a = this.human; if (!r) return;
    this.applyRow(a, r);
    if (this.pred && inp && this.canPredict(r, s)) {
      this.predAcc += dt;
      const cur = { mx: inp.mx, mz: inp.mz, sprint: inp.sprint, faceYaw: inp.faceYaw };
      while (this.predAcc >= 1 / 60) { runStep(this.pred, cur, 1 / 60, this.weather.rain, this.field); this.predAcc -= 1 / 60; }
      const dk = Math.exp(-dt * 10); this.corr.x *= dk; this.corr.z *= dk;
      a.pos.x = this.pred.pos.x + this.corr.x; a.pos.z = this.pred.pos.z + this.corr.z; a.y = 0;
      a.facing = this.pred.facing; a.vel.x = this.pred.vel.x; a.vel.z = this.pred.vel.z; a.speedH = this.pred.speedH;
    } else {
      // blend toward the server position to hide the hand-over from prediction
      const k = Math.min(1, dt * 14);
      a.pos.x = lerp(a.pos.x, r[1], k); a.pos.z = lerp(a.pos.z, r[2], k); a.y = r[3];
      a.facing = a.hasDisc && inp && s.state === 'live' ? inp.aimYaw : lerpAng(a.facing, r[6], k);
      this.corr.x = this.corr.z = 0;
    }
  }

  displayClock() { const totalMin = this.settings.rules === 'usau' ? this.hardCapMin : this.durationMin; return Math.max(0, totalMin * 60 - this.clock * 5); }
  isUniverse() { return this.teams[0].score === this.target - 1 && this.teams[1].score === this.target - 1; }
}
