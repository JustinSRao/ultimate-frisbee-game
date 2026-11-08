const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'high';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errs.push(m.text()); });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript((q) => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: q, weatherPreset: 'sunny' } })); }, q);
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(1000);
  // fast-forward: let AI auto-play, then put human mid-field with disc to mimic reference
  await page.evaluate(() => { const g = window.__ult.game; g.autoHuman = true; for (let i = 0; i < 60 * 12; i++) g.step(null); g.autoHuman = false; g.state='live'; g.offense = 0; g.dmode='held'; g.human.pos.x = 0; g.human.pos.z = -8*g.teams[0].dir; g.give(g.human); window.__ult.cam.yaw = g.teams[0].dir > 0 ? 0 : Math.PI; window.__ult.cam.snap = true; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `shots/game_${q}.png`, timeout: 200000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
