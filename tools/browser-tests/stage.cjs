// Stage a scene matching the reference composition, then screenshot
const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'high', W = +(process.argv[3] || 880), H = Math.round(W * 9 / 16), out = process.argv[4] || `shots/stage_${q}.png`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errs.push(m.text()); });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.addInitScript((q) => { localStorage.setItem('wul-ultimate-v1', JSON.stringify({ settings: { graphics: q, weatherPreset: 'sunny', teamSize: 7 } })); }, q);
  await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__ult.startMatch('match'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const u = window.__ult, g = u.game; g.teams[0].dir = 1; g.teams[1].dir = -1;
    g.state = 'live'; g.offense = 0; g.dmode = 'held';
    const T = g.teams[0].athletes, O = g.teams[1].athletes;
    const set = (a, x, z, f, vx = 0, vz = 0) => { a.pos.x = a.prev.x = x; a.pos.z = a.prev.z = z; a.facing = a.prev.f = f; a.vel.x = vx; a.vel.z = vz; a.want.x = vx; a.want.z = vz; };
    set(T[0], 0, -10, 0);
    set(T[1], 9, -8, 0.3, 2, 4); set(T[2], 3, 3, 0, 0, 3); set(T[3], -9, -1, -0.2, -1, 5); set(T[4], -1, 13, 0, 0, 2); set(T[5], 7, 18, 0, 0, 1); set(T[6], -6, 22, 0, 0, 1);
    set(O[0], -1.4, -7.5, Math.PI); set(O[1], 8, -5, Math.PI, 0, 3); set(O[2], 4, 6, Math.PI); set(O[3], -10, 3, Math.PI, -1, 4); set(O[4], -3, 15, Math.PI); set(O[5], 9, 21, Math.PI); set(O[6], -8, 25, Math.PI);
    O[0].anim = 'mark'; O[0].animT = 99;
    g.give(T[0]); g.stats = g.stats; g.teams[0].score = 7; g.teams[1].score = 5;
    u.cam.yaw = 0; u.cam.pitch = 0.15; u.cam.snap = true;
    window.__freezeSim = false;
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__freezeSim = true; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out, timeout: 400000 });
  console.log(errs.join('\n'));
  await browser.close();
})();
