const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errs.push(m.text()); });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low', weatherPreset: 'sunny' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('[data-act=quick]');
  await page.waitForTimeout(1500);
  const st = () => page.evaluate(() => { const g = window.__ult.game; return { state: g.state, dmode: g.dmode, hx: +g.human.pos.x.toFixed(2), hz: +g.human.pos.z.toFixed(2), has: g.human.hasDisc, locked: !!document.pointerLockElement, label: g.throwInfo && g.throwInfo.label, from: g.throwInfo && g.throwInfo.from.name }; });
  console.log('after start', await st());
  // move: wait until live, then press W
  await page.evaluate(() => { const g = window.__ult.game; g.state = 'live'; g.give(g.teams[1].athletes[0]); g.offense = 1; });
  await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w');
  console.log('after W', await st());
  // give disc to human and swipe with real mouse (left button = backhand)
  await page.evaluate(() => { const g = window.__ult.game; g.offense = 0; g.give(g.human); g.state = 'live'; });
  await page.mouse.move(320, 180);
  await page.mouse.down({ button: 'left' });
  for (let i = 1; i <= 12; i++) { await page.mouse.move(320 + i * 2 - Math.sin(i / 12 * Math.PI) * 25, 180 - i * 8); await page.waitForTimeout(30); }
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(300);
  console.log('after BH swipe', await st());
  await page.waitForTimeout(2500);
  // forehand: right button
  await page.evaluate(() => { const g = window.__ult.game; g.offense = 0; g.give(g.human); g.state = 'live'; });
  await page.mouse.move(320, 180);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) { await page.mouse.move(320 - i * 9, 180 - i * 3); await page.waitForTimeout(30); }
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  console.log('after FH swipe', await st());
  // pause via Escape
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  console.log('paused screen', await page.evaluate(() => document.getElementById('menuPause').classList.contains('on')));
  await page.click('[data-act=resume]'); await page.waitForTimeout(500);
  console.log('resumed', await page.evaluate(() => !document.getElementById('menuPause').classList.contains('on')));
  console.log(errs.join('\n'));
  await browser.close();
})();
