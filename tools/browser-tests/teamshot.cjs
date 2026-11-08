const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 619 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'medium', weatherPreset: 'sunny', team: 'solar', opponent: 'owls', teamSize: 5 } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('[data-act=setup]'); await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/setup_teams.png', timeout: 200000 });
  await page.click('[data-act=start]'); await page.waitForTimeout(800);
  await page.evaluate(() => { const g = window.__ult.game; g.autoHuman = true; for (let i = 0; i < 60 * 8; i++) g.step(null); g.autoHuman = false; const h = g.human; g.state = 'live'; g.offense = 0; g.give(h); window.__ult.cam.yaw = g.teams[0].dir > 0 ? 0 : Math.PI; window.__ult.cam.snap = true; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'shots/game_teams.png', timeout: 300000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
