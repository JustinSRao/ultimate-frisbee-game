// Browser smoke suite (Playwright). Run from the repo root after `npm run build`.
// Loads dist/index.html, checks the menu renders, a match starts and runs, and there are no page errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = require('url').pathToFileURL(path.resolve('dist/index.html')).href;
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
fs.mkdirSync('shots', { recursive: true });
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
async function open(browser, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ...opts });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ult && document.getElementById('loading').style.display === 'none', null, { timeout: 30000 });
  return { page, errs };
}
const suites = [];
const suite = (name, fn) => suites.push([name, fn]);

suite('menu + quick match', async (browser) => {
  const { page, errs } = await open(browser);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/menu.png' });
  ok(await page.isVisible('#menuMain'), 'main menu visible');
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => ({ state: window.__ult.game.state, mode: window.__ult.mode, t: window.__ult.game.time }));
  ok(st.mode === 'play' && st.t > 1, `match running (state=${st.state}, t=${st.t.toFixed(1)})`);
  await page.screenshot({ path: 'shots/play.png' });
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await page.close();
});

const click = (page, act) => page.click(`.screen.on [data-act="${act}"]`);

suite('custom match offline lobby', async (browser) => {
  const { page, errs } = await open(browser);
  await click(page, 'custom');
  ok(await page.isVisible('#menuSetup'), 'custom match setup visible');
  await page.click('#setupPlay .seg button:nth-child(1)'); // OFFLINE
  await page.screenshot({ path: 'shots/custom-setup.png' });
  await click(page, 'offlineLobby');
  ok(await page.isVisible('#menuLobby'), 'offline lobby visible');
  const slots = await page.$$eval('#menuLobby .slot', els => els.length);
  const n = await page.evaluate(() => window.__ult.app.store.settings.teamSize);
  ok(slots === 2 * n, `lobby shows ${2 * n} slots (${slots})`);
  // take a slot on the opponent team
  await page.click('#lobbyB .slot[data-slot="1"]');
  ok(await page.$eval('#lobbyB .slot:nth-of-type(2)', el => el.classList.contains('me')), 'moved to opponent slot 2');
  await page.screenshot({ path: 'shots/lobby-offline.png' });
  await click(page, 'lobbyStart');
  await page.waitForTimeout(2500);
  const g = await page.evaluate(() => { const g = window.__ult.game; return { team: g.human.team, idx: g.human.idx, mode: window.__ult.mode, left: document.getElementById('nameL').textContent, key1: g.teams[1].key, bots: g.all.filter(a => !a.isHuman).length, n: g.n }; });
  ok(g.mode === 'play' && g.team === 1 && g.idx === 1, `playing as team 1 slot 2 (team=${g.team}, idx=${g.idx})`);
  ok(g.bots === 2 * g.n - 1, 'all other slots are bots');
  await page.screenshot({ path: 'shots/lobby-match-team1.png' });
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await page.close();
});

suite('tournament bracket', async (browser) => {
  const { page, errs } = await open(browser);
  await click(page, 'tourney');
  ok(await page.isVisible('#menuTourney'), 'tournament setup visible');
  await page.screenshot({ path: 'shots/tourney-setup.png' });
  await page.evaluate(() => window.__modes.setTfmt({ teamSize: 3, team: 'owls', online: false }));
  await click(page, 'tourneyNew');
  ok(await page.isVisible('#menuBracket'), 'bracket visible');
  const nTeams = await page.$$eval('#bracket .bcol:first-child .bt .nm', els => new Set(els.map(e => e.textContent)).size);
  ok(nTeams === 16, `round of 16 shows 16 teams (${nTeams})`);
  await page.screenshot({ path: 'shots/bracket.png' });
  // play my match, force a result, continue: the rest of the round is simulated
  await click(page, 'tourneyPlay');
  await page.waitForTimeout(1500);
  const ctx = await page.evaluate(() => ({ mode: window.__ult.mode, ctx: window.__ult.matchCtx.kind, us: window.__ult.game.teams[0].key }));
  ok(ctx.mode === 'play' && ctx.ctx === 'tourney' && ctx.us === 'owls', 'tournament match started as OWLS');
  await page.evaluate(() => { const g = window.__ult.game; g.teams[0].score = 13; g.teams[1].score = 7; g.endMatch(0); });
  await page.waitForSelector('#results.on', { timeout: 15000 });
  await page.screenshot({ path: 'shots/tourney-result.png' });
  await click(page, 'tourneyContinue');
  await page.waitForFunction(() => { const t = window.__modes.tourney; return t && t.rounds.length >= 2; }, null, { timeout: 120000 });
  const t = await page.evaluate(() => window.__modes.tourney);
  ok(t.rounds[0].every(m => m.w) && t.rounds[1].length === 4, 'round of 16 complete, quarterfinals drawn');
  ok(t.rounds[0].some(m => m.how === 'game' || m.how === 'rating'), 'other matches simulated (' + [...new Set(t.rounds[0].map(m => m.how))].join(',') + ')');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/bracket-qf.png' });
  // saved locally: reload resumes
  await page.reload(); await page.waitForFunction(() => window.__ult && document.getElementById('loading').style.display === 'none');
  const resumed = await page.evaluate(() => window.__modes.tourney && window.__modes.tourney.rounds.length);
  ok(resumed === 2, 'tournament progress saved locally');
  // finish: lose next match -> simulate to the final -> champion screen
  await page.evaluate(() => window.__ult.modes.onAct('tourneyResume'));
  await page.evaluate(() => window.__ult.modes.onAct('tourneyPlay'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const g = window.__ult.game; g.teams[1].score = 13; g.endMatch(1); });
  await page.waitForSelector('#results.on', { timeout: 15000 });
  await click(page, 'tourneyContinue');
  await page.waitForSelector('#menuChampion.on', { timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/champion.png' });
  ok(true, 'champion screen shown');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await page.close();
});

const only = process.argv[2];
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  for (const [name, fn] of suites) {
    if (only && !name.includes(only)) continue;
    console.log('# ' + name);
    try { await fn(browser); } catch (e) { ok(false, name + ' threw: ' + e.message); }
  }
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
module.exports = { open, ok, suite };
