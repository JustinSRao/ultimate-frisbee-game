const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low', weatherPreset: 'sunny' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('[data-act=quick]'); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const g = window.__ult.game; g.state = 'live'; g.give(g.teams[1].athletes[0]); g.offense = 1;
    const ev = (t, key) => window.dispatchEvent(new KeyboardEvent(t, { key }));
    ev('keydown', 'w'); ev('keyup', 'w'); ev('keydown', 'w');
    await new Promise(r => setTimeout(r, 1500));
    const h = g.human;
    return { sprint: window.__ult.input.sprint, keysW: window.__ult.keys.has('w'), sprintE: h.sprintE, speed: h.speedH };
  });
  console.log(r);
  await browser.close();
})();
