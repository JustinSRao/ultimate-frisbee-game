const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => {
    const u = window.__ult; const out = [];
    const mk = (f) => { const p = []; for (let i = 0; i <= 12; i++) p.push(f(i / 12)); return p; };
    const cases = {
      straightUp: mk(t => ({ x: 0, y: -100 * t })),
      bulgeLeft: mk(t => ({ x: 24 * t - 30 * Math.sin(t * Math.PI), y: -100 * t })),
      bulgeRight: mk(t => ({ x: 24 * t + 30 * Math.sin(t * Math.PI), y: -100 * t })),
      sideRight: mk(t => ({ x: 120 * t, y: -10 * t })),
    };
    for (const [k, pts] of Object.entries(cases)) {
      const an = u.analyzeSwipe({ pts });
      out.push([k, an.power.toFixed(2), (an.off * 57.3).toFixed(0) + 'deg', an.bulge.toFixed(3), an.turn,
        'RH-BH:' + u.classify('bh', 'right', an.turn).label, 'RH-FH:' + u.classify('fh', 'right', an.turn).label,
        'LH-BH:' + u.classify('bh', 'left', an.turn).label, 'LH-FH:' + u.classify('fh', 'left', an.turn).label].join(' '));
    }
    return out;
  });
  console.log(r.join('\n'));
  // record raw movement during a locked swipe
  await page.click('[data-act=quick]'); await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__mv = []; window.addEventListener('mousemove', e => window.__mv.push([e.movementX, e.movementY])); });
  await page.mouse.move(320, 180); for (let i = 1; i <= 5; i++) { await page.mouse.move(320 + i * 10, 180 - i * 5); }
  console.log(JSON.stringify(await page.evaluate(() => window.__mv)));
  await browser.close();
})();
