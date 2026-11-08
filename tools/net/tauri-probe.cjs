// Attaches to the installed Tauri app (launched with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333)
// and checks it booted: store plugin, game ready, screenshot. Optional: node tauri-probe.cjs join <CODE>
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = b.contexts()[0].pages()[0];
  await page.waitForFunction(() => window.__ult && document.getElementById('loading').style.display === 'none', null, { timeout: 60000 });
  const info = await page.evaluate(() => ({ url: location.href, tauri: !!window.__TAURI__, store: !!(window.__TAURI__ && window.__TAURI__.store), mode: window.__ult.mode, server: (window.__ult.app && 'ok') }));
  console.log(JSON.stringify(info));
  const [cmd, code] = process.argv.slice(2);
  if (cmd === 'join') {
    await page.evaluate((c) => window.__modes.join(c), code);
    await page.waitForFunction(() => window.__modes.lobby, null, { timeout: 20000 });
    console.log('joined lobby', JSON.stringify(await page.evaluate(() => window.__modes.lobby.players.map(p => p.name))));
  }
  if (cmd === 'waitplay') {
    await page.waitForFunction(() => window.__ult.mode === 'play' && window.__ult.game.remote && window.__ult.game.snaps.length > 5, null, { timeout: 60000 });
    console.log('playing', JSON.stringify(await page.evaluate(() => ({ state: window.__ult.game.state, sc: window.__ult.game.teams.map(t => t.score), me: window.__ult.game.human.name }))));
  }
  await page.screenshot({ path: 'shots/tauri-' + (cmd || 'boot') + '.png' });
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
