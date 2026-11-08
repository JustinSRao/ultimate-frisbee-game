const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page.on('pageerror', e => console.log('PAGEERR', e.message, e.stack && e.stack.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 600)); });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log(await page.evaluate(() => document.getElementById('err').textContent));
  await browser.close();
})();
