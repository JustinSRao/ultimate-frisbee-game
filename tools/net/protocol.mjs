// Headless protocol test against a running server (default: wrangler dev on :8787).
// 3 raw WebSocket clients: create room, join, pick slots, start, send inputs,
// check snapshots agree, bots fill empty slots, disconnect -> bot, reconnect -> control restored.
// Usage: node tools/net/protocol.mjs [baseUrl]
import { PROTO } from '../../shared/protocol.js';
const BASE = (process.argv[2] || process.env.WUL_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const WSBASE = BASE.replace(/^http/, 'ws');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pid = () => 'p_' + [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

function client(code, id, name) {
  const c = { id, name, msgs: [], lobby: null, snap: null, start: null, seq: 0, open: false };
  c.connect = () => new Promise((res, rej) => {
    const ws = new WebSocket(`${WSBASE}/api/rooms/${code}/ws?pid=${id}`);
    c.ws = ws;
    ws.onopen = () => { c.open = true; ws.send(JSON.stringify({ t: 'hello', v: PROTO, cfg: { name, number: 7 + c.name.length } })); res(); };
    ws.onerror = (e) => rej(e);
    ws.onclose = () => { c.open = false; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'lobby') c.lobby = m; else if (m.t === 's') c.snap = m; else if (m.t === 'start') c.start = m; else c.msgs.push(m);
    };
  });
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };
  c.input = (mx, mz) => c.send({ t: 'in', seq: ++c.seq, mx, mz, sprint: false, jump: false, dive: false, call: false, aimYaw: 0, faceYaw: null });
  return c;
}
const until = async (fn, ms = 8000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); } console.log('  timeout waiting for', what); return false; };

const r = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const { code } = await r.json();
ok(/^[A-Z2-9]{5}$/.test(code), 'room created: ' + code);
const info = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
ok(info.code === code && info.status === 'lobby', 'room info');
ok((await fetch(`${BASE}/api/rooms/ZZZZZ`)).status === 404, 'unknown room 404');

const A = client(code, pid(), 'ANNA'), B = client(code, pid(), 'BEN'), C = client(code, pid(), 'CAL');
await A.connect(); await until(() => A.lobby, 5000, 'lobby A');
ok(A.lobby.host === A.id, 'first player is host');
await B.connect(); await C.connect();
await until(() => A.lobby.players.length === 3, 5000, '3 players');
ok(A.lobby.players.length === 3, '3 players in lobby');
A.send({ t: 'settings', settings: { teamSize: 4, duration: 70, weatherPreset: 'sunny', team: 'tide', opponent: 'volt' } });
A.send({ t: 'pick', team: 0, slot: 0 }); B.send({ t: 'pick', team: 0, slot: 1 }); C.send({ t: 'pick', team: 1, slot: 2 });
B.send({ t: 'start' }); // not host: ignored
await until(() => { const p = A.lobby.players.find(p => p.id === C.id); return p && p.team === 1 && p.slot === 2 && A.lobby.settings.teamSize === 4; }, 5000, 'picks');
ok(A.lobby.players.find(p => p.id === C.id).team === 1, 'C moved to the other team');
ok(!A.start, 'non-host cannot start');
A.send({ t: 'lock', on: true }); A.send({ t: 'start' });
await until(() => A.start && B.start && C.start, 5000, 'start');
ok(A.start && B.start && C.start, 'all clients got start');
const roster = A.start.roster;
ok(roster.athletes.length === 8, 'roster 4v4 = 8 athletes');
const humans = roster.athletes.filter(a => a.ctrl);
ok(humans.length === 3 && roster.athletes.filter(a => !a.ctrl).length === 5, 'bots fill the 5 empty slots');
const athOf = (c) => roster.athletes.find(a => a.ctrl === c.id);
ok(athOf(C).team === 1 && athOf(C).idx === 2, 'C controls team 1 slot 2');

// play: everyone pushes inputs at 30 Hz for a few seconds; B runs sideways (+x)
const pump = setInterval(() => { for (const c of [A, B, C]) if (c.open) c.input(c === B ? 1 : 0, 0); }, 33);
await until(() => A.snap && A.snap.state === 'pull', 8000, 'pull state');
// whoever pulls: if it's a human, they swipe-throw the pull (exercises the throw path)
const pullerId = A.snap.puller, pullerC = [A, B, C].find(c => athOf(c).id === pullerId);
if (pullerC) pullerC.send({ t: 'throw', kind: 'bh', power: 0.9, yaw: athOf(pullerC).team === 0 ? 0 : Math.PI, curve: 0, loft: 0.3, label: 'PULL' });
ok(await until(() => A.snap && A.snap.state === 'live', 6000, 'live state'), 'pull thrown, play is live' + (pullerC ? ` (human ${pullerC.name} pulled)` : ''));
const rowOf = (s, id) => s.a.find(r => r[0] === id);
const bId = athOf(B).id;
const x0 = rowOf(A.snap, bId)[1]; await sleep(2500); const x1 = rowOf(A.snap, bId)[1];
ok(x1 - x0 > 3, `B's input moves B's athlete (+x ${(x1 - x0).toFixed(1)} m)`);
ok(A.snap.ack[B.id] > 0, 'server acks input seq');
await sleep(300);
const same = [A, B, C].every(c => c.snap && JSON.stringify(c.snap.sc) === JSON.stringify(A.snap.sc) && c.snap.state === A.snap.state);
ok(same, 'all clients see the same score/state');
const st = (c) => c.snap.st; await sleep(200);
ok(Math.abs(st(A) - st(B)) < 0.2 && Math.abs(st(A) - st(C)) < 0.2, 'clients in sync on server time');

// disconnect C -> bot takes over
const cId = athOf(C).id;
C.ws.close(); await sleep(800);
ok((rowOf(A.snap, cId)[16] & 2) === 0, 'disconnected human is now bot-controlled');
const lob = A.lobby; // lobby not re-sent during match; fine
// reconnect C with the same player id
C.start = null; await C.connect();
await until(() => C.start, 5000, 'C restart');
ok(!!C.start, 'reconnect gets the match roster again');
await sleep(800);
ok((rowOf(A.snap, cId)[16] & 2) === 2, 'reconnected human controls their athlete again');

// a new player can't join mid-match
const D = client(code, pid(), 'DEE'); await D.connect(); await sleep(800);
ok(D.msgs.some(m => m.t === 'err' && m.code === 'inprogress'), 'late joiner told the match is in progress');

clearInterval(pump);
for (const c of [A, B, C]) try { c.send({ t: 'leave' }); c.ws.close(); } catch (e) { }
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
