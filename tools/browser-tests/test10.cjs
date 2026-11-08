const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errs.push(m.text()); });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low', weatherPreset: 'rainy' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  for (const n of [2, 7]) {
    await page.evaluate((n) => { const u = window.__ult; u.game; }, n);
    await page.click('[data-act=setup]'); await page.waitForTimeout(200);
    await page.click(`#setupRows .seg button:text("${n}v${n}")`);
    await page.click('[data-act=start]'); await page.waitForTimeout(800);
    const info = await page.evaluate(() => { const g = window.__ult.game; g.autoHuman = true; for (let i = 0; i < 60 * 90; i++) g.step(null); g.autoHuman = false; return { n: g.all.length, field: g.field.L, scores: g.teams.map(t => t.score), rain: g.weather.rain.toFixed(2), state: g.state }; });
    console.log(n, JSON.stringify(info));
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('#menuPause [data-act=menu]'); await page.waitForTimeout(800);
  }
  // practice
  await page.click('[data-act=practice]'); await page.waitForTimeout(800);
  console.log('practice', JSON.stringify(await page.evaluate(() => { const g = window.__ult.game; return { n: g.all.length, has: g.human.hasDisc, practice: g.practice }; })));
  // throw in practice to a teammate, and let AI pass back
  const res = await page.evaluate(() => { const g = window.__ult.game; const h = g.human; const r = g.teams[0].athletes[1]; const yaw = Math.atan2(r.pos.x - h.pos.x, r.pos.z - h.pos.z); g.humanThrow({ kind: 'bh', power: 0.4, yaw, curve: 0, loft: 0, label: 'test' }); let caughtBy = null, backToHuman = false; for (let i = 0; i < 60 * 20; i++) { g.step({ mx: 0, mz: 0, sprint: false, jump: false, call: i === 300, aimYaw: 0 }); if (!caughtBy && g.holder && g.holder !== h) caughtBy = g.holder.name; if (caughtBy && g.holder === h) { backToHuman = true; break; } } return { caughtBy, backToHuman }; });
  console.log('practice pass', JSON.stringify(res));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.click('#menuPause [data-act=menu]'); await page.waitForTimeout(500);
  // end-of-match results
  await page.click('[data-act=quick]'); await page.waitForTimeout(800);
  await page.evaluate(() => { const g = window.__ult.game; g.teams[0].score = 15; g.teams[1].score = 12; g.endMatch(0); });
  await page.waitForTimeout(4500);
  console.log('results', await page.evaluate(() => document.getElementById('results').classList.contains('on') + ' ' + document.getElementById('resTitle').textContent));
  await page.click('#results [data-act=restart]'); await page.waitForTimeout(800);
  console.log('rematch', await page.evaluate(() => { const g = window.__ult.game; return g.state + ' ' + g.teams[0].score; }));
  console.log(errs.join('\n'));
  await browser.close();
})();
