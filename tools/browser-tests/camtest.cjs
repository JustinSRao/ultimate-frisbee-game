const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low', weatherPreset: 'sunny' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('[data-act=quick]'); await page.waitForTimeout(800);
  // disc held by an opponent off to the human's right-behind
  await page.evaluate(() => { const g = window.__ult.game; g.state = 'live'; g.offense = 1; const o = g.teams[1].athletes[0]; o.pos.x = g.human.pos.x - 12; o.pos.z = g.human.pos.z - 5; g.give(o); window.__ult.cam.yaw = 0; });
  await page.keyboard.press('c'); await page.waitForTimeout(3000);
  const r = await page.evaluate(() => { const g = window.__ult.game, h = g.human, o = g.holder; return { yaw: window.__ult.cam.yaw.toFixed(2), wantYaw: Math.atan2(o.pos.x - h.pos.x, o.pos.z - h.pos.z).toFixed(2), label: document.getElementById('camMode').textContent }; });
  console.log('disc cam on', r);
  await page.keyboard.press('c'); await page.waitForTimeout(1500);
  console.log('toggled off label:', JSON.stringify(await page.evaluate(() => document.getElementById('camMode').textContent)));
  console.log(errs.join('\n'));
  await browser.close();
})();
