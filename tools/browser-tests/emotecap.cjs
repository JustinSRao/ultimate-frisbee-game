const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'high', weatherPreset: 'sunny', teamSize: 2 } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const g = window.__ult.game; g.state = 'live';
    for (const a of g.all) { a.pos.x = 25; a.pos.z = 25; }
    const h = g.human; h.pos.x = h.prev.x = 0; h.pos.z = h.prev.z = 0; h.facing = 0;
    g.scoreGoal(h, g.teams[0].athletes[1]); g.botEmotes = [];
    document.getElementById('hud').style.display = 'none';
  });
  const all = [['moon', 1.2]];
  const fs = require('fs'); const shots = all.filter(([k, t]) => !fs.existsSync(`shots/em_${k}_${t}.png`)).slice(0, 5); if (!shots.length) process.exit(0);
  for (const [kind, t] of shots) {
    await page.evaluate(([kind, t]) => {
      clearInterval(window.__iv);
      const g = window.__ult.game, h = g.human;
      window.__iv = setInterval(() => { g.stateT = 3; h.pos.x = 0; h.pos.z = 0; h.facing = 0; h.emote = { kind, t, dur: 9, stage: 9 }; h.anim = 'emote'; window.__ult.cam.yaw = Math.PI - 0.5; window.__ult.cam.pitch = 0.05; }, 5);
    }, [kind, t]);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `shots/em_${kind}_${t}.png`, clip: { x: 300, y: 150, width: 300, height: 356 }, timeout: 200000 });
  }
  console.log(errs.join('\n'));
  await browser.close();
})();
