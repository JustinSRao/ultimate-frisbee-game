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
