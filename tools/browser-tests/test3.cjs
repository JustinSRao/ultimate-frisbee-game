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
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `shots/play_${q}_a.png`, timeout: 120000 });
  // give disc to human in live play
  await page.evaluate(() => { const g = window.__ult.game; g.state = 'live'; g.dmode='held'; g.offense = 0; g.give(g.human); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `shots/play_${q}_b.png`, timeout: 120000 });
  const r = await page.evaluate(() => { const u = window.__ult; const g = u.game; const pts=[]; for(let i=0;i<=20;i++){ pts.push({x: i*4 + Math.sin(i/20*Math.PI)*-40, y: -i*9, t: 0}); } u.finishSwipeTest('bh', pts); return { dmode: g.dmode, v: g.disc.v, label: g.throwInfo && g.throwInfo.label }; });
  console.log(JSON.stringify(r));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/play_${q}_c.png`, timeout: 120000 });
  console.log(errs.slice(0, 20).join('\n'));
  await browser.close();
})();
