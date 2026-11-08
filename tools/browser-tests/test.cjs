const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type()==='warning') errs.push(m.type()+': '+m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'shots/menu.png' });
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'shots/play1.png' });
  const info = await page.evaluate(() => { const g = window.__ult.game; return { state: g.state, off: g.offense, puller: g.puller.name, human: g.human.pos, fps: 0 }; });
  console.log(JSON.stringify(info));
  // measure fps
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); function f() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); } requestAnimationFrame(f); }));
  console.log('fps', fps);
  console.log(errs.slice(0, 20).join('\n'));
  await browser.close();
})();
