const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'low';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.type()+': '+m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript((q) => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: q } })); }, q);
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const t0 = Date.now();
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); function f() { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(n / 4); } requestAnimationFrame(f); }));
  console.log('menu fps', fps, 'crowd', await page.evaluate(() => window.__ult.stadium().crowdCount));
  await page.screenshot({ path: `shots/menu_${q}.png`, timeout: 120000 });
  console.log(errs.slice(0, 20).join('\n'));
  await browser.close();
})();
