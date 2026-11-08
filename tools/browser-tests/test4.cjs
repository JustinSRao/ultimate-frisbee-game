const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'high';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 405 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript((q) => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: q } })); }, q);
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.click('[data-act=athlete]');
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{document.querySelector('#menuAthlete .card').style.display='none'}); await page.waitForTimeout(3500);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `shots/athlete_${q}.png`, timeout: 100000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
