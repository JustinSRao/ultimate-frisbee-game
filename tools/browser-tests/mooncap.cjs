const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'high', weatherPreset: 'sunny', teamSize: 2 } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(500);
  await page.evaluate((YAW) => {
    const g = window.__ult.game; g.state = 'live';
    for (const a of g.all) { a.pos.x = 25; a.pos.z = 25; }
    const h = g.human; h.pos.x = 0; h.pos.z = 0; h.facing = 0;
    g.scoreGoal(h, g.teams[0].athletes[1]); g.botEmotes = [];
    document.getElementById('hud').style.display = 'none';
    window.__iv = setInterval(() => { g.stateT = 3; h.pos.x = 0; h.pos.z = 0; h.facing = 0; h.emote = { kind: 'moon', t: 1.3, dur: 9, stage: 9 }; h.anim = 'emote'; g.dmode = 'cosmetic'; g.disc.p.x = 0.5; g.disc.p.y = 0.02; g.disc.p.z = -0.3; g.disc.v.x = g.disc.v.y = g.disc.v.z = 0; window.__ult.cam.yaw = YAW; window.__ult.cam.pitch = 0.05; }, 5);
  }, +(process.argv[2] || 0.6));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: process.argv[3] || 'shots/moon_back.png', clip: { x: 450, y: 260, width: 300, height: 356 }, timeout: 200000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
