const { chromium } = require('playwright');
(async () => {
  const W = +(process.argv[3] || 1456), H = Math.round(W * 819 / 1456), out = process.argv[2] || 'shots/ref_match.png';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript(() => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: 'high', weatherPreset: 'sunny', teamSize: 7 }, athlete: { name: 'ALEX CHEN', number: 12, role: 'handler', height: 'taller', gender: 'male', hand: 'right', skin: 2, hairColor: 1, hair: 'curly' } })); });
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const u = window.__ult, g = u.game; g.teams[0].dir = 1; g.teams[1].dir = -1;
    g.state = 'live'; g.offense = 0; g.dmode = 'held';
    const T = g.teams[0].athletes, O = g.teams[1].athletes;
    const set = (a, x, z, f, vx = 0, vz = 0) => { a.pos.x = a.prev.x = x; a.pos.z = a.prev.z = z; a.facing = a.prev.f = f; a.vel.x = vx; a.vel.z = vz; a.want.x = vx; a.want.z = vz; a.want.face = f; };
    set(T[0], 0, -10, 0.25);
    set(T[1], 6.5, -9, 1.2, 5, 1.5); set(T[2], 2.5, 0, 0.1, 0, 3); set(T[3], -6, -3, -0.3, -1, 4); set(T[4], -0.5, 12, 0, 0, 2); set(T[5], 7, 18, 0, 0, 1); set(T[6], -7, 22, 0, 0, 1);
    set(O[0], -2.6, -6.2, Math.PI + 0.35); set(O[1], 4, -2, Math.PI, 0, 3); set(O[2], -9, 1, Math.PI, -1, 4); set(O[3], -3, 8, Math.PI); set(O[4], 5, 10, Math.PI); set(O[5], 9, 21, Math.PI); set(O[6], -8, 25, Math.PI);
    for (const o of O) { o.ai.mark = null; }
    O[0].anim = 'mark'; O[0].animT = 99;
    g.give(T[0]); g.teams[0].score = 7; g.teams[1].score = 5;
    u.cam.yaw = 0.18; u.cam.pitch = 0.1; u.cam.snap = true;
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__freezeSim = true; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, timeout: 400000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
