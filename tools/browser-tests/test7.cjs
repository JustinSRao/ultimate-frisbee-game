const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'low', weatherPreset: 'sunny' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(3000);
  console.log(await page.evaluate(() => window.__ult.dbg())); console.log(await page.evaluate(() => { const g = window.__ult.game; return { labs: [...document.querySelectorAll('.lab')].map(e=>e.style.display+'/'+e.textContent+'/'+e.style.left).join(' ; '), mode: window.__ult.mode, n: document.querySelectorAll('.lab').length, hud: document.getElementById('hud').className, teams: g.all.map(a => a.team + ':' + a.isHuman).join(','), humanTeam: g.human.team }; }));
  console.log(errs.join('\n'));
  await browser.close();
})();
