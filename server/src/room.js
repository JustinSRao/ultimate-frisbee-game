// ============================================================================
// ROOM: one Durable Object per online room (SQLite-backed, WebSocket Hibernation API).
// Lobby: players pick team + slot; empty slots are bots. Host can edit/lock settings and start.
// Match: the shared Game runs here (server-authoritative) at 60 Hz, stepped from a 20 Hz interval
// that also broadcasts snapshots. Disconnected humans are taken over by bots immediately and get
// their athlete back if they reconnect within 60 s.
// Idle lobbies hibernate (no timers) and are closed after 5 minutes without activity.
// ============================================================================
import { DurableObject } from 'cloudflare:workers';
import { Game, DT } from '../../shared/game.js';
import { DEFAULTS, sanitizeSettings } from '../../shared/config.js';
import { snapshot, rosterOf, encodeEvent, finalStats, sanitizeInput, sanitizeThrow, MAX_HUMANS, RECONNECT_GRACE_MS, IDLE_CLOSE_MS, SNAP_HZ, PROTO } from '../../shared/protocol.js';
import { record, advance, pendingSims, ratingResult, myMatch, targetFor } from '../../shared/tournament.js';

const clampInt = (v, lo, hi, d) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d);
function sanitizeAthlete(c = {}) {
  const A = DEFAULTS.athlete;
  return {
    name: String(c.name || 'PLAYER').replace(/[^\w .'-]/g, '').toUpperCase().slice(0, 14) || 'PLAYER',
    number: clampInt(c.number, 0, 99, A.number), role: c.role === 'cutter' ? 'cutter' : 'handler', height: c.height === 'shorter' ? 'shorter' : 'taller',
    gender: c.gender === 'female' ? 'female' : 'male', hand: c.hand === 'left' ? 'left' : 'right',
    skin: clampInt(c.skin, 0, 5, A.skin), hairColor: clampInt(c.hairColor, 0, 6, A.hairColor), hair: typeof c.hair === 'string' ? c.hair.slice(0, 12) : A.hair,
  };
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null; this.game = null; this.timer = null;
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || null;
      // A match can't survive eviction (it lives in memory): drop back to the lobby.
      if (this.room && this.room.status === 'playing') { this.room.status = 'lobby'; this.room.notice = 'The match was interrupted. Start again from the lobby.'; }
    });
  }

  // ------------------------------------------------------------------ RPC from the Worker
  async init(code, kind, tournament) {
    if (this.room) return { ok: false, error: 'exists' };
    this.room = {
      code, kind: kind === 'tournament' ? 'tournament' : 'match', created: Date.now(), lastActivity: Date.now(),
      hostId: null, settings: sanitizeSettings(DEFAULTS.settings), locked: false, status: 'lobby', players: {}, tournament: null, notice: '',
    };
    if (this.room.kind === 'tournament' && tournament && tournament.rounds && tournament.myTeam) {
      this.room.tournament = tournament;
      this.room.settings = sanitizeSettings({ ...this.room.settings, ...tournament.fmt, team: tournament.myTeam });
    }
    await this.persist();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS);
    return { ok: true };
  }
  async info() {
    if (!this.room) return null;
    const R = this.room;
    return { code: R.code, kind: R.kind, status: R.status, locked: R.locked, players: Object.keys(R.players).length, max: MAX_HUMANS, settings: R.settings };
  }

  // ------------------------------------------------------------------ WebSocket
  async fetch(request) {
    if (!this.room) return new Response('room not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const url = new URL(request.url);
    const pid = (url.searchParams.get('pid') || '').slice(0, 40);
    if (!/^p_[0-9a-f]{8,32}$/.test(pid)) return new Response('bad player id', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [pid]);
    server.serializeAttachment({ pid, at: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 8192) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const att = ws.deserializeAttachment() || {};
    const pid = att.pid; if (!pid) return;
    const R = this.room; if (!R) { ws.close(4004, 'room closed'); return; }
    // hot path first: inputs during a match
    if (m.t === 'in') { this.onInput(pid, m); return; }
    if (m.t === 'throw') { const p = this.pending(pid); p.throw = sanitizeThrow(m); return; }
    if (m.t === 'emote') { const p = this.pending(pid); p.emote = clampInt(m.n, 1, 5, 0); return; }
    if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', c: m.c, st: this.game ? this.game.time : 0 })); return; }
    R.lastActivity = Date.now();
    switch (m.t) {
      case 'hello': await this.onHello(ws, pid, m); break;
      case 'pick': if (R.status === 'lobby') this.onPick(pid, m); break;
      case 'settings': if (pid === R.hostId && !R.locked && R.status === 'lobby' && R.kind === 'match') { R.settings = sanitizeSettings(m.settings, R.settings); this.fitSlots(); } break;
      case 'lock': if (pid === R.hostId && R.status === 'lobby') R.locked = !!m.on; break;
      case 'start': if (pid === R.hostId && R.status === 'lobby') { this.startMatch(); return; } break;
      case 'leave': this.removePlayer(pid); ws.close(1000, 'left'); break;
      case 'profile': if (R.players[pid] && R.status === 'lobby') { R.players[pid].cfg = sanitizeAthlete(m.cfg); R.players[pid].name = R.players[pid].cfg.name; } break;
      default: return;
    }
    await this.persist();
    this.broadcastLobby();
  }

  async webSocketClose(ws) { await this.onSocketGone(ws); }
  async webSocketError(ws) { await this.onSocketGone(ws); }

  async onSocketGone(ws) {
    const att = ws.deserializeAttachment() || {}; const pid = att.pid;
    if (!pid || !this.room) return;
    if (this.sockets(pid).some(s => s !== ws)) return; // another tab/connection for this player is still open
    const R = this.room, p = R.players[pid];
    if (!p) return;
    if (R.status === 'playing' && this.game) {
      p.goneAt = Date.now();
      const a = this.game.setHumanControl(pid, false); // a bot takes over right away
      if (a) this.game.msg(`${a.name} DISCONNECTED — BOT TAKES OVER`, 'warn', 2);
    } else {
      this.removePlayer(pid);
      await this.persist();
      this.broadcastLobby();
    }
  }

  // ------------------------------------------------------------------ lobby
  async onHello(ws, pid, m) {
    const R = this.room;
    if (m.v !== PROTO) { this.sendTo(ws, { t: 'err', code: 'version', msg: 'Please update the game to play online.' }); ws.close(4000, 'version'); return; }
    const cfg = sanitizeAthlete(m.cfg);
    let p = R.players[pid];
    if (!p) {
      if (R.status === 'playing') { this.sendTo(ws, { t: 'err', code: 'inprogress', msg: 'That match has already started.' }); ws.close(4001, 'in progress'); return; }
      if (Object.keys(R.players).length >= MAX_HUMANS) { this.sendTo(ws, { t: 'err', code: 'full', msg: 'That room is full (14 players).' }); ws.close(4002, 'full'); return; }
      p = R.players[pid] = { name: cfg.name, cfg, team: 0, slot: 0, joinedAt: Date.now() };
      const spot = this.freeSlot(R.kind === 'tournament' ? 0 : null);
      if (!spot) { delete R.players[pid]; this.sendTo(ws, { t: 'err', code: 'full', msg: 'No free slots for that team size.' }); ws.close(4002, 'full'); return; }
      p.team = spot.team; p.slot = spot.slot;
    } else if (R.status === 'lobby') { p.cfg = cfg; p.name = cfg.name; }
    if (!R.hostId || !R.players[R.hostId]) R.hostId = pid;
    if (R.status === 'playing' && this.game) {
      if (p.goneAt && Date.now() - p.goneAt > RECONNECT_GRACE_MS) {
        this.sendTo(ws, { t: 'err', code: 'expired', msg: 'You were away for over 60 s, so a bot kept your spot until the match ends.' }); ws.close(4003, 'expired'); return;
      }
      p.goneAt = null;
      const a = this.game.setHumanControl(pid, true);
      if (a) this.game.msg(`${a.name} IS BACK`, 'info', 1.6);
      this.sendTo(ws, { t: 'start', roster: rosterOf(this.game), you: pid, code: R.code, tournament: R.tournament ? this.tourneyView() : null });
    }
    this.sendTo(ws, this.lobbyMsg(pid));
  }

  onPick(pid, m) {
    const R = this.room, p = R.players[pid]; if (!p) return;
    const team = R.kind === 'tournament' ? 0 : (m.team === 1 ? 1 : 0), slot = clampInt(m.slot, 0, R.settings.teamSize - 1, -1);
    if (slot < 0) return;
    if (Object.entries(R.players).some(([id, o]) => id !== pid && o.team === team && o.slot === slot)) return;
    p.team = team; p.slot = slot;
  }

  freeSlot(onlyTeam) {
    const R = this.room, n = R.settings.teamSize;
    const used = new Set(Object.values(R.players).map(p => p.team + ':' + p.slot));
    // fill the host's team first, then the other
    const order = onlyTeam === 0 ? [0] : [0, 1];
    for (const t of order) for (let s = 0; s < n; s++) if (!used.has(t + ':' + s)) return { team: t, slot: s };
    return null;
  }

  // team size changed: move anyone whose slot no longer exists
  fitSlots() {
    const R = this.room, n = R.settings.teamSize;
    for (const p of Object.values(R.players)) if (p.slot >= n) { p.slot = -1; }
    for (const [pid, p] of Object.entries(R.players)) if (p.slot < 0) {
      const spot = this.freeSlot(R.kind === 'tournament' ? 0 : null);
      if (spot) { p.team = spot.team; p.slot = spot.slot; } else delete R.players[pid];
    }
  }

  removePlayer(pid) {
    const R = this.room; if (!R || !R.players[pid]) return;
    delete R.players[pid];
    if (R.hostId === pid) {
      const next = Object.entries(R.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
      R.hostId = next ? next[0] : null; R.locked = false;
    }
  }

  lobbyMsg(you) {
    const R = this.room;
    const online = new Set(this.ctx.getWebSockets().map(w => (w.deserializeAttachment() || {}).pid));
    return {
      t: 'lobby', you, code: R.code, kind: R.kind, host: R.hostId, settings: R.settings, locked: R.locked, status: R.status, notice: R.notice || '',
      players: Object.entries(R.players).map(([id, p]) => ({ id, name: p.name, team: p.team, slot: p.slot, online: online.has(id) && !p.goneAt })),
      tournament: R.tournament ? this.tourneyView() : null,
    };
  }
  tourneyView() { const t = this.room.tournament; return { ...t }; }
  broadcastLobby() { for (const ws of this.ctx.getWebSockets()) { const pid = (ws.deserializeAttachment() || {}).pid; this.sendTo(ws, this.lobbyMsg(pid)); } }

  // ------------------------------------------------------------------ match
  startMatch() {
    const R = this.room;
    const online = new Set(this.ctx.getWebSockets().map(w => (w.deserializeAttachment() || {}).pid));
    for (const pid of Object.keys(R.players)) if (!online.has(pid)) delete R.players[pid];
    const humans = Object.entries(R.players).map(([id, p]) => ({ id, team: p.team, slot: p.slot, cfg: p.cfg }));
    if (!humans.length) return;
    let settings = { ...R.settings };
    if (R.kind === 'tournament') {
      const T = R.tournament; if (!T || T.champion || T.eliminated) return;
      const m = myMatch(T); if (!m || m.w) return;
      settings = sanitizeSettings({ ...settings, ...T.fmt, team: T.myTeam, opponent: m.a === T.myTeam ? m.b : m.a });
      for (const h of humans) h.team = 0;
    }
    this.events = [];
    this.inputs = {}; this.pend = {}; this.acks = {};
    this.game = new Game(settings, DEFAULTS.athlete, 'match', (t, d) => { if (t !== 'callout' || d.text) this.events.push(encodeEvent(t, d)); }, { humans, seed: (Date.now() & 0xffffff) });
    for (const p of Object.values(R.players)) p.goneAt = null;
    R.status = 'playing'; R.locked = true; R.notice = '';
    this.persist();
    const roster = rosterOf(this.game);
    for (const ws of this.ctx.getWebSockets()) {
      const pid = (ws.deserializeAttachment() || {}).pid;
      this.sendTo(ws, { t: 'start', roster, you: pid, code: R.code, tournament: R.tournament ? this.tourneyView() : null });
    }
    this.lastTick = Date.now(); this.acc = 0;
    this.timer = setInterval(() => this.tick(), 1000 / SNAP_HZ);
  }

  pending(pid) { return (this.pend ||= {})[pid] ||= {}; }

  onInput(pid, m) {
    if (!this.game) return;
    const now = Date.now(), p = this.pending(pid);
    if (p.lastIn && now - p.lastIn < 20) return; // rate cap (~50 Hz)
    p.lastIn = now;
    const inp = sanitizeInput(m);
    // one-shot buttons latch until the next simulation step consumes them
    if (inp.jump) p.jump = true; if (inp.dive) p.dive = true; if (inp.call) p.call = true;
    this.inputs[pid] = inp;
    this.acks[pid] = inp.seq;
  }

  tick() {
    const g = this.game, R = this.room; if (!g || !R) return;
    const now = Date.now();
    this.acc = Math.min(this.acc + (now - this.lastTick) / 1000, DT * 8); this.lastTick = now;
    let first = true;
    while (this.acc >= DT) {
      this.acc -= DT;
      const inputs = {};
      for (const a of g.humans) {
        const pid = a.ctrl, base = this.inputs[pid]; if (!base) continue;
        const p = this.pending(pid), inp = { ...base, jump: false, dive: false, call: false };
        if (first) {
          inp.jump = !!p.jump; inp.dive = !!p.dive; inp.call = !!p.call; p.jump = p.dive = p.call = false;
          // swipe wind-up (so other players see the throw coming)
          if (a.isHuman && a.hasDisc) {
            if (inp.tw) { if (!a.throwAnim || a.throwAnim.stage !== 'release') a.throwAnim = { kind: inp.tw, stage: 'wind', w: inp.tww }; }
            else if (a.throwAnim && a.throwAnim.stage === 'wind') a.throwAnim = null;
          }
          if (p.throw && a.isHuman) { const sw = p.throw; p.throw = null; if (a.hasDisc) { a.facing = sw.yaw; g.humanThrow(sw, a); } }
          if (p.emote && a.isHuman) { const n = p.emote; p.emote = 0; g.emote(a, n); }
        }
        inputs[pid] = inp;
      }
      g.step(null, inputs);
      first = false;
      if (g.over) break;
    }
    // humans gone for good: give up their slot to the bot permanently
    for (const p of Object.values(R.players)) if (p.goneAt && now - p.goneAt > RECONNECT_GRACE_MS) p.expired = true;
    const snap = snapshot(g, this.events, this.acks); this.events = [];
    const msg = JSON.stringify(snap);
    let live = 0;
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); live++; } catch (e) { } }
    if (g.over && g.stateT > 6 || g.over && !live) { this.endMatch(); return; }
    // nobody connected for 60 s: abandon
    if (!live) { this.noneSince ||= now; if (now - this.noneSince > RECONNECT_GRACE_MS) this.endMatch(true); }
    else this.noneSince = 0;
  }

  async endMatch(abandoned = false) {
    clearInterval(this.timer); this.timer = null;
    const g = this.game, R = this.room; this.game = null;
    if (!R) return;
    let result = null;
    if (g && g.over && !abandoned) {
      result = finalStats(g);
      if (R.kind === 'tournament' && R.tournament) {
        const T = R.tournament, m = myMatch(T);
        if (m && !m.w) {
          const my = g.teams[0].score, opp = g.teams[1].score;
          record(T, m, m.a === T.myTeam ? my : opp, m.a === T.myTeam ? opp : my, 'played');
          // the rest of the round: quick rating model (keeps server CPU tiny)
          for (const x of pendingSims(T)) record(T, x, ...ratingResult(x.a, x.b, targetFor(T.fmt)), 'rating');
          advance(T);
          while (T.eliminated && !T.champion) { for (const x of pendingSims(T)) record(T, x, ...ratingResult(x.a, x.b, targetFor(T.fmt)), 'rating'); if (!advance(T)) break; }
        }
      }
    }
    for (const [pid, p] of Object.entries(R.players)) if (p.expired || p.goneAt) { delete R.players[pid]; }
    if (R.hostId && !R.players[R.hostId]) this.removePlayer(R.hostId);
    if (!R.hostId) { const first = Object.keys(R.players)[0]; R.hostId = first || null; }
    R.status = 'lobby'; R.locked = false; R.lastActivity = Date.now();
    await this.persist();
    for (const ws of this.ctx.getWebSockets()) this.sendTo(ws, { t: 'over', result, abandoned, tournament: R.tournament ? this.tourneyView() : null });
    this.broadcastLobby();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS);
  }

  // ------------------------------------------------------------------ housekeeping
  async alarm() {
    const R = this.room; if (!R) { await this.ctx.storage.deleteAll(); return; }
    if (R.status === 'playing' && this.game) { await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS); return; }
    const idle = Date.now() - (R.lastActivity || 0);
    const conns = this.ctx.getWebSockets().length;
    if (idle >= IDLE_CLOSE_MS || !conns) {
      for (const ws of this.ctx.getWebSockets()) { this.sendTo(ws, { t: 'err', code: 'idle', msg: 'Room closed after 5 minutes of inactivity.' }); try { ws.close(4005, 'idle'); } catch (e) { } }
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + (IDLE_CLOSE_MS - idle) + 1000);
  }

  sockets(pid) { return this.ctx.getWebSockets(pid); }
  sendTo(ws, obj) { try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) { } }
  async persist() { if (this.room) await this.ctx.storage.put('room', this.room); }
}

