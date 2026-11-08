// ============================================================================
// PROTOCOL: online wire format shared by the server (Durable Object) and clients.
// JSON messages. Client -> server: hello, in (inputs, 20-30 Hz), throw, emote, lobby actions.
// Server -> client: lobby, start (roster), s (snapshot, 20 Hz, includes events), over, err.
// ============================================================================
export const PROTO = 1;
export const SNAP_HZ = 20;
export const INPUT_HZ = 30;
export const MAX_HUMANS = 14;
export const RECONNECT_GRACE_MS = 60_000;
export const IDLE_CLOSE_MS = 5 * 60_000;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function randomCode(n = 5, rnd = Math.random) {
  let s = ''; for (let i = 0; i < n; i++) s += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return s;
}
export const validCode = (c) => typeof c === 'string' && c.length === 5 && [...c].every(ch => CODE_ALPHABET.includes(ch));

// Static match info sent once at kickoff: everything a client needs to build views.
export function rosterOf(g) {
  return {
    n: g.n, field: g.field, target: g.target, origTarget: g.origTarget, durationMin: g.durationMin, hardCapMin: g.hardCapMin,
    settings: { rules: g.settings.rules, duration: g.settings.duration, assist: g.settings.assist, difficulty: g.settings.difficulty },
    teams: g.teams.map(t => ({ key: t.key, kit: t.kit, dir: t.dir })),
    athletes: g.all.map(a => ({
      id: a.id, team: a.team, idx: a.idx, ctrl: a.ctrl || null, name: a.name, number: a.number, role: a.role, build: a.build,
      gender: a.gender, hand: a.hand, skin: a.skin, hairColor: a.hairColor, hairStyle: a.hairStyle, attrs: a.attrs,
    })),
  };
}

function athleteRow(a) {
  const ta = a.throwAnim, em = a.emote, dv = a.dive, rc = a.reach;
  return [a.id, r2(a.pos.x), r2(a.pos.z), r2(a.y), r2(a.vel.x), r2(a.vel.z), r3(a.facing), r2(a.speedH), r2(a.accelLean), r2(a.turnLean), a.anim || '',
    ta ? [ta.kind, ta.stage, r2(ta.w ?? 0), r2(ta.t ?? 0)] : 0,
    em ? [em.kind, r2(em.t), em.dur, em.stage] : 0,
    dv ? [r2(dv.t), r2(dv.dx), r2(dv.dz), dv.ground ? 1 : 0] : 0,
    rc ? [r2(rc.x), r2(rc.y), r2(rc.z), a.reachTwo ? 1 : 0] : 0,
    a.lookYaw === undefined || a.lookYaw === null ? null : r2(a.lookYaw),
    (a.hasDisc ? 1 : 0) | (a.isHuman ? 2 : 0),
    r2(a.callT), Math.round(a.endur), Math.round(a.sprintE), r2(a.lunge.x), r2(a.lunge.z), r2(a.pivotLunge || 0),
    a.ai.mark ? a.ai.mark.id : -1, a.ai.state || '', r2(a.recoverT), r2(a.vy), r2(a.sprintTime)];
}

export function snapshot(g, ev, acks) {
  const D = g.disc, ti = g.throwInfo, w = g.weather, lg = g.lastGoal;
  return {
    t: 's', st: r3(g.time), state: g.state, stateT: r2(g.stateT), off: g.offense,
    sc: [g.teams[0].score, g.teams[1].score], dir: [g.teams[0].dir, g.teams[1].dir],
    clock: r2(g.clock), half: g.half, target: g.target, cap: g.capState, stall: r2(g.stall), pd: r2(g.pullDeadline || 0),
    puller: g.puller ? g.puller.id : -1, picker: g.picker ? g.picker.id : -1, dm: g.dmode, holder: g.holder ? g.holder.id : -1,
    disc: [r3(D.p.x), r3(D.p.y), r3(D.p.z), r3(D.n.x), r3(D.n.y), r3(D.n.z), r2(D.spin || 0), D.spinDir || 1, r2(D.v.x), r2(D.v.y), r2(D.v.z)],
    ti: ti ? { r: ti.receiver ? ti.receiver.id : -1, p: ti.isPull ? 1 : 0, f: ti.from ? ti.from.id : -1 } : null,
    lg: lg ? { s: lg.scorer ? lg.scorer.id : -1, a: lg.assist ? lg.assist.id : -1 } : null,
    w: [r2(w.wind.x), r2(w.wind.z), r2(w.current), r2(w.rain), r3(w.ang)],
    over: g.over ? 1 : 0, winner: g.winner,
    a: g.all.map(athleteRow),
    ev: ev || [], ack: acks || {},
    fs: g.over ? finalStats(g) : undefined,
  };
}

// Game events carry Athlete objects; on the wire they become { $a: id }.
export function encodeEvent(type, d) {
  if (!d || typeof d !== 'object') return [type, d ?? null];
  const o = {};
  for (const [k, v] of Object.entries(d)) {
    if (v && typeof v === 'object' && v.pos && v.attrs && 'id' in v) o[k] = { $a: v.id };
    else if (Array.isArray(v) || v === null || typeof v !== 'object') o[k] = v;
  }
  return [type, o];
}
export function decodeEvent(ev, byId) {
  const [type, d] = ev;
  if (!d || typeof d !== 'object') return [type, d];
  const o = {};
  for (const [k, v] of Object.entries(d)) o[k] = v && typeof v === 'object' && '$a' in v ? byId.get(v.$a) || null : v;
  return [type, o];
}

export function finalStats(g) {
  return { stats: g.stats, athletes: g.all.map(a => ({ id: a.id, ...a.stats })), clock: g.clock, target: g.target, winner: g.winner, sc: [g.teams[0].score, g.teams[1].score] };
}

// Inputs from clients are untrusted: clamp everything.
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
export function sanitizeInput(m) {
  let mx = num(m.mx, -1, 1), mz = num(m.mz, -1, 1); const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  return {
    seq: num(m.seq, 0, 2 ** 31, 0) | 0, mx, mz, sprint: !!m.sprint, jump: !!m.jump, dive: !!m.dive, call: !!m.call,
    aimYaw: num(m.aimYaw, -1e4, 1e4), faceYaw: m.faceYaw === null || m.faceYaw === undefined ? null : num(m.faceYaw, -1e4, 1e4),
    tw: m.tw === 'bh' || m.tw === 'fh' ? m.tw : null, tww: num(m.tww, 0, 1),
  };
}
export function sanitizeThrow(m) {
  return {
    kind: m.kind === 'fh' ? 'fh' : 'bh', power: num(m.power, 0, 1), yaw: num(m.yaw, -1e4, 1e4), curve: [-1, 0, 1].includes(m.curve) ? m.curve : 0,
    loft: num(m.loft, -0.12, 0.6), label: String(m.label || '').slice(0, 40),
  };
}
