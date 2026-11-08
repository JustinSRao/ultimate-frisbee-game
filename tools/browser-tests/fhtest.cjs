const { chromium } = require('playwright');
(async () => {
  const kind = process.argv[2] || 'fh';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'high', weatherPreset: 'sunny', teamSize: 2 } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const u = window.__ult, g = u.game; g.state = 'live'; g.offense = 1;
    for (const a of g.all) { a.pos.x = 30; a.pos.z = 30; }
    const h = g.human; h.pos.x = h.prev.x = 0; h.pos.z = h.prev.z = 0; h.facing = h.prev.f = 0;
    g.give(g.teams[1].athletes[0]); window.__freezeSim = false;
    h.ai.state = 'none';
    document.getElementById('hud').style.display = 'none';
  });
  const phases = kind === 'fh' ? [['wind', 1, 0], ['release', 1, 0.06], ['release', 1, 0.3]] : [['wind', 1, 0], ['release', 1, 0.06], ['release', 1, 0.3]];
  for (const view of (process.argv[3] === 'back' ? [['back', 0.5]] : [['side', Math.PI / 2 + 0.35]])) {
    for (const [st, w, t] of phases) {
      await page.evaluate(([st, w, t, yaw, kind]) => {
        clearInterval(window.__iv);
        const g = window.__ult.game, h = g.human;
        window.__iv = setInterval(() => { h.pos.x = 0; h.pos.z = 0; h.vel.x = h.vel.z = 0; h.want.x = h.want.z = 0; h.facing = 0; h.want.face = 0; h.throwAnim = { kind, stage: st, w, t }; h.hasDisc = st === 'wind'; window.__ult.cam.yaw = yaw; window.__ult.cam.pitch = 0.05; }, 5);
      }, [st, w, t, view[1], kind]);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `shots/${kind}_${view[0]}_${st}_${t}.png`, clip: { x: 310, y: 185, width: 280, height: 320 }, timeout: 200000 });
    }
  }
  await browser.close();
})();
