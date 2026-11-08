// Network test: 3 headless browser clients (Playwright) in one online room.
// Starts `wrangler dev` unless a server URL is given (or one is already up on :8787).
// Plays ~60 s with scripted inputs and asserts: same score/state on all clients, inputs move the
// right athletes, bots fill empty slots, a disconnect is taken over by a bot and reconnect restores control.
// Usage: node tools/net/nettest.mjs [serverUrl]   e.g. https://wul-ultimate.<you>.workers.dev
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import { pathToFileURL } from 'url';

const SERVER = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const PLAY_MS = +process.env.NET_PLAY_MS || 60000;
const PAGE = pathToFileURL(path.resolve('dist/index.html')).href + '?server=' + encodeURIComponent(SERVER);
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const health = async () => { try { return (await fetch(SERVER + '/api/health')).ok; } catch (e) { return false; } };

let dev = null;
if (!(await health())) {
  if (!/127\.0\.0\.1|localhost/.test(SERVER)) { console.error('server not reachable: ' + SERVER); process.exit(1); }
  console.log('starting wrangler dev…');
  dev = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'dev', '--config', 'server/wrangler.toml', '--port', '8787', '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], { stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 60 && !(await health()); i++) await sleep(1000);
  if (!(await health())) { console.error('wrangler dev did not start'); process.exit(1); }
}

const browser = await chromium.launch({ args: ARGS });
async function client(name, number) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  // low graphics keeps 3-4 software-rendered clients responsive
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('wul-ultimate-v1')) localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low' } })); } catch (e) { } });
  const c = { name, ctx };
  c.open = async () => {
    c.page = await ctx.newPage();
    c.errs = [];
    c.page.on('pageerror', e => c.errs.push(e.message));
    await c.page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await c.page.waitForFunction(() => window.__modes && document.getElementById('loading').style.display === 'none', null, { timeout: 180000 });
    await c.page.evaluate(([n, num]) => { const A = window.__ult.app.store.athlete; A.name = n; A.number = num; window.__ult.app.save(window.__ult.app.store); }, [name, number]);
  };
  await c.open();
  return c;
}
const ev = (c, fn, arg) => c.page.evaluate(fn, arg);
const waitFor = (c, fn, arg, ms = 20000) => c.page.waitForFunction(fn, arg, { timeout: ms });

try {
  const A = await client('ANNA', 11), B = await client('BEN', 22), C = await client('CAL', 33);
  // host + share the code
  await ev(A, () => window.__modes.host('match'));
  await waitFor(A, () => window.__modes.lobby && window.__modes.lobby.code);
  const code = await ev(A, () => window.__modes.lobby.code);
  ok(/^[A-Z2-9]{5}$/.test(code), 'A hosts room ' + code);
  await A.page.screenshot({ path: 'shots/net-lobby-host.png' });
  // host settings: 4v4, sunny, short game
  await ev(A, () => { const S = window.__ult.app.store.settings; Object.assign(S, { teamSize: 4, duration: 70, weatherPreset: 'sunny', team: 'tide', opponent: 'volt' }); window.__modes.session.settings(S); });
  for (const c of [B, C]) await ev(c, (code) => window.__modes.join(code), code);
  await waitFor(A, () => window.__modes.lobby && window.__modes.lobby.players.length === 3);
  ok(true, 'B and C joined (3 players)');
  await ev(C, () => window.__modes.session.pick(1, 0));
  await waitFor(A, () => { const p = window.__modes.lobby.players.find(p => p.name === 'CAL'); return p && p.team === 1; });
  await sleep(300);
  await A.page.screenshot({ path: 'shots/net-lobby.png' });
  ok(await ev(B, () => !!document.querySelector('#menuLobby.on')), 'joiners see the lobby');
  await ev(A, () => window.__ult.modes.onAct('lobbyStart'));
  for (const c of [A, B, C]) await waitFor(c, () => window.__ult.mode === 'play' && window.__ult.game.remote && window.__ult.game.snaps.length > 2, null, 30000);
  ok(true, 'match started on all 3 clients');
  const roster = await ev(A, () => window.__ult.game.all.map(a => ({ id: a.id, team: a.team, ctrl: !!a.ctrl, name: a.name })));
  ok(roster.length === 8 && roster.filter(a => !a.ctrl).length === 5, 'bots fill the 5 empty slots of 4v4');
  const idOf = async (c) => ev(c, () => window.__ult.game.human.id);
  const ids = { A: await idOf(A), B: await idOf(B), C: await idOf(C) };
  ok(new Set(Object.values(ids)).size === 3 && roster.find(a => a.id === ids.C).team === 1, 'each client controls its own athlete (C on team 1)');

  // scripted play: anyone pulling throws; B strafes right for a while, A runs forward, C sprints
  const posOn = (viewer, id) => ev(viewer, (id) => { const a = window.__ult.game.byId.get(id); return { x: a.pos.x, z: a.pos.z, human: a.isHuman }; }, id);
  const t0 = Date.now();
  let moved = false, bStart = null;
  while (Date.now() - t0 < PLAY_MS) {
    for (const c of [A, B, C]) {
      await ev(c, () => {
        const g = window.__ult.game, h = g.human;
        if (g.state === 'pull' && g.puller === h) window.__ult.finishSwipeTest('bh', [{ x: 0, y: 0, t: 0 }, { x: 0, y: -160, t: 80 }, { x: 0, y: -300, t: 160 }]);
        if (h.hasDisc && g.state === 'live' && g.time % 4 < 0.4) window.__ult.finishSwipeTest(Math.random() < 0.5 ? 'bh' : 'fh', [{ x: 0, y: 0, t: 0 }, { x: 40, y: -120, t: 80 }]);
      });
    }
    const st = await ev(A, () => window.__ult.game.state);
    if (st === 'live' && !bStart) { bStart = await posOn(A, ids.B); await B.page.keyboard.down('d'); }
    if (bStart && !moved && Date.now() - t0 > 8000) {
      await B.page.keyboard.up('d');
      const now = await posOn(A, ids.B);
      moved = Math.hypot(now.x - bStart.x, now.z - bStart.z) > 3;
      ok(moved, `B's keyboard input moves B's athlete on A's screen (${Math.hypot(now.x - bStart.x, now.z - bStart.z).toFixed(1)} m)`);
    }
    await sleep(500);
  }
  if (!moved) ok(false, 'B never reached live play to test movement');
  // consistency: compare on the newest snapshot every client has
  const views = [];
  for (const c of [A, B, C]) views.push(await ev(c, () => { const g = window.__ult.game, s = g.snaps[g.snaps.length - 1]; return { st: s.st, sc: s.sc.join('-'), state: s.state }; }));
  ok(views.every(v => v.sc === views[0].sc), 'same score on all clients: ' + views.map(v => v.sc).join(' / '));
  ok(Math.max(...views.map(v => v.st)) - Math.min(...views.map(v => v.st)) < 0.5, 'clients within 0.5 s of server time');
  ok(views.every(v => v.state === views[0].state) || Math.max(...views.map(v => v.st)) - Math.min(...views.map(v => v.st)) > 0.1, 'same game state: ' + views.map(v => v.state).join(' / '));
  await A.page.screenshot({ path: 'shots/net-play-A.png' });
  await C.page.screenshot({ path: 'shots/net-play-C.png' });

  // disconnect C (close the tab): a bot takes over
  // (the replacement tab loads first: software-rendered page loads are slow here; a real player has 60 s)
  const oldPage = C.page, oldErrs = C.errs;
  await C.open();                       // new tab, same device storage -> same player ID
  const tClose = Date.now();
  await oldPage.close();
  await sleep(1500);
  ok((await posOn(A, ids.C)).human === false, 'C disconnected: bot took over C\'s athlete');
  // reconnect with the same player ID
  await ev(C, (code) => window.__modes.join(code), code);
  C.errs.push(...oldErrs);
  try { await waitFor(C, () => window.__ult.mode === 'play' && window.__ult.game.remote && window.__ult.game.snaps.length > 2, null, 20000); } catch (e) { }
  await sleep(1500);
  const dbg = await ev(C, () => ({ mode: window.__ult.mode, remote: !!(window.__ult.game && window.__ult.game.remote), err: document.getElementById('setupErr').textContent, lerr: document.getElementById('lobbyErr').textContent, screen: (document.querySelector('.screen.on') || {}).id, pid: localStorage.getItem('wul-player-id') }));
  console.log('  C after rejoin:', JSON.stringify(dbg));
  const back = await ev(C, () => window.__ult.game && window.__ult.game.remote ? window.__ult.game.human.id : -1);
  ok(back === ids.C, 'C reconnected to the same athlete');
  ok((await posOn(A, ids.C)).human === true, 'C\'s athlete is human-controlled again');
  const errs = [A, B, C].flatMap(c => c.errs);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  for (const c of [A, B, C]) await ev(c, () => window.__ult.toMenu()).catch(() => { });
} catch (e) {
  ok(false, 'threw: ' + e.message);
} finally {
  await browser.close();
  if (dev) dev.kill();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
