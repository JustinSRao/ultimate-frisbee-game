// ============================================================================
// MODES: Custom Match (offline lobby / online host+join), online session glue,
// Tournament (setup, bracket, simulated matches, champion), all menu screens
// beyond the main menu. Talks to main.js through the `app` object.
// ============================================================================
import { TEAMS, TEAM_KEYS, teamLogo, sanitizeSettings } from '../../shared/config.js';
import { newTournament, ROUND_NAMES, currentRound, myMatch, pendingSims, record, advance, ratingResult, simulateWithGame, targetFor } from '../../shared/tournament.js';
import { getItem, setItem, getJSON, setJSON, removeItem } from './storage.js';
import { OnlineSession, RemoteGame, createRoom, roomInfo, ServerBusy } from './net.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logo = (k) => `<svg viewBox="0 0 40 40">${teamLogo(k)}</svg>`;
const TKEY = 'wul-tourney';

export function initModes(app) {
  const S = () => app.store.settings;
  let playMode = getItem('wul-playmode') === 'online' ? 'online' : 'offline';
  let setupReturn = null;      // where BACK goes from the setup screen
  let offline = null;          // offline lobby state
  let session = null, lobby = null; // online
  let tourney = getJSON(TKEY);
  let simming = false;

  const err = (id, msg) => { const el = $(id); if (el) { el.textContent = msg || ''; el.className = 'err'; } };
  const settingsLine = (s) => `${s.teamSize}v${s.teamSize} · ${s.duration} MIN · TO ${s.duration === 70 ? 13 : 15} · ${({ wfdf: 'WFDF', usau: 'USAU CAPS', simple: 'NO CAPS' })[s.rules]} · ${s.difficulty.toUpperCase()} BOTS · ${({ sunny: 'SUNNY', random: 'RANDOM WEATHER', windy: 'WINDY', rainy: 'RAIN', custom: 'CUSTOM WEATHER' })[s.weatherPreset]}`;
  const seg = (label, opts, get, set) => {
    const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<label>${label}</label>`;
    const sg = document.createElement('div'); sg.className = 'seg';
    for (const [v, t] of opts) { const b = document.createElement('button'); b.textContent = t; if (get() === v) b.classList.add('on'); b.onclick = () => { app.audio.play('ui'); set(v); for (const c of sg.children) c.classList.remove('on'); b.classList.add('on'); }; sg.appendChild(b); }
    row.appendChild(sg); return row;
  };
  const teamGrid = (label, get, set) => {
    const row = document.createElement('div'); row.className = 'row'; row.style.alignItems = 'flex-start'; row.innerHTML = `<label>${label}</label>`;
    const grid = document.createElement('div'); grid.className = 'teamgrid';
    for (const k of TEAM_KEYS) {
      const t = TEAMS[k]; const b = document.createElement('button');
      b.className = 'teambtn' + (get() === k ? ' on' : '');
      b.innerHTML = `${logo(k)}<span><i>${t.city}</i>${t.name}</span><b style="background:#${t.jersey.toString(16).padStart(6, '0')};border-color:${t.css}"></b>`;
      b.onclick = () => { app.audio.play('ui'); set(k); for (const c of grid.children) c.classList.remove('on'); b.classList.add('on'); };
      grid.appendChild(b);
    }
    row.appendChild(grid); return row;
  };

  // ================================================================ CUSTOM MATCH SETUP
  function openCustom(opts = {}) {
    setupReturn = opts.from || null;
    app.buildSetup();
    const roomEdit = setupReturn === 'menuLobby' && session;
    $('setupTitle').textContent = roomEdit ? `ROOM ${lobby ? lobby.code : ''} · SETTINGS` : setupReturn === 'menuLobby' ? 'OFFLINE LOBBY · SETTINGS' : 'CUSTOM MATCH';
    const play = $('setupPlay'); play.innerHTML = '';
    if (!setupReturn) play.append(seg('PLAY', [['offline', 'OFFLINE · VS BOTS'], ['online', 'ONLINE · WITH FRIENDS']], () => playMode, v => { playMode = v; setItem('wul-playmode', v); renderSetupBtns(); }));
    renderSetupBtns();
    err('setupErr', '');
    app.show('menuSetup');
  }
  function renderSetupBtns() {
    const box = $('setupBtns');
    if (setupReturn === 'menuLobby') { box.innerHTML = `<div class="btnrow"><button class="btn primary" data-act="setupDone">DONE</button></div>`; return; }
    if (playMode === 'offline') box.innerHTML = `<div class="btnrow"><button class="btn" data-act="back">BACK</button><button class="btn" data-act="offlineLobby">LOBBY · PICK SLOT</button><button class="btn primary" data-act="customStart">START GAME</button></div>`;
    else box.innerHTML = `<div class="note">Online: host a room and share the 5-letter code, or join a friend's room. Empty slots are filled by bots.</div>
      <div class="btnrow"><button class="btn" data-act="back">BACK</button><button class="btn primary" data-act="host">HOST ROOM</button></div>
      <div class="joinrow"><input id="joinCode" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false"><button class="btn" data-act="join">JOIN ROOM</button></div>`;
    const jc = $('joinCode'); if (jc) { jc.value = getItem('wul-lastcode') || ''; jc.onkeydown = (e) => { if (e.key === 'Enter') onAct('join'); }; }
  }

  // ================================================================ LOBBY (shared renderer)
  function openOfflineLobby() {
    const prev = offline;
    offline = { online: false, kind: 'match', you: 'local', host: 'local', locked: false, code: null, players: [{ id: 'local', name: app.store.athlete.name, team: prev ? prev.players[0].team : 0, slot: prev ? Math.min(prev.players[0].slot, S().teamSize - 1) : 0, online: true }] };
    renderLobby(); app.show('menuLobby');
  }
  const curLobby = () => (session && lobby) ? { ...lobby, online: true } : offline ? { ...offline, settings: S() } : null;

  function renderLobby() {
    const L = curLobby(); if (!L) return;
    const s = L.settings, n = s.teamSize, me = L.you, isHost = L.host === me, T = L.tournament;
    $('lobbyTitle').textContent = L.online ? (L.kind === 'tournament' ? 'ONLINE CO-OP TOURNAMENT' : 'CUSTOM MATCH · ONLINE ROOM') : 'CUSTOM MATCH · OFFLINE LOBBY';
    $('lobbyHead').innerHTML = L.online ? `ROOM <span class="codebig">${esc(L.code)}</span>` : 'PICK YOUR SPOT';
    let opp = s.opponent;
    if (T) { const m = myMatch(T); opp = m ? (m.a === T.myTeam ? m.b : m.a) : null; }
    $('lobbySub').textContent = (T ? `${T.champion ? 'TOURNAMENT OVER · CHAMPION: ' + TEAMS[T.champion].name : T.eliminated ? 'ELIMINATED' : ROUND_NAMES[currentRound(T)]} · ` : '') + settingsLine(s) + (L.locked ? ' · 🔒 LOCKED' : '');
    const col = (team, key) => {
      if (!key) return `<h3>TBD</h3>`;
      const t = TEAMS[key];
      let h = `<h3>${logo(key)}<span><small>${t.city}${team === 0 ? ' · HOME' : ' · AWAY'}</small>${t.name}</span></h3>`;
      for (let i = 0; i < n; i++) {
        const p = L.players.find(p => p.team === team && p.slot === i);
        const pickable = !p && !(T && team === 1) && L.status !== 'playing';
        const cls = p ? ('human' + (p.id === me ? ' me' : '') + (p.online === false ? ' off' : '')) : 'bot';
        const tag = p ? (p.id === L.host ? 'HOST' : p.online === false ? 'AWAY' : 'PLAYER') + (p.id === me ? ' · YOU' : '') : pickable ? 'BOT · TAP TO TAKE' : 'BOT';
        h += `<button class="slot ${cls}" ${pickable ? `data-act="slot" data-team="${team}" data-slot="${i}"` : 'disabled'}><span class="n">${i + 1}</span>${p ? esc(p.name) : 'BOT'}<span class="tag">${tag}</span></button>`;
      }
      return h;
    };
    $('lobbyA').innerHTML = col(0, s.team);
    $('lobbyB').innerHTML = col(1, opp);
    const humans = L.players.length;
    $('lobbyNote').textContent = L.online
      ? `${humans} player${humans === 1 ? '' : 's'} in the room (max 14). Share the code ${L.code}. Every empty slot is a bot. ${isHost ? 'You are the host.' : 'Waiting for the host to start.'}` + (L.notice ? ' ' + L.notice : '')
      : 'Tap a bot slot to take it, on either team. Every other slot is a bot.';
    let b = `<button class="btn" data-act="lobbyLeave">${L.online ? 'LEAVE ROOM' : 'BACK'}</button>`;
    if (T) b += `<button class="btn" data-act="bracket">BRACKET</button>`;
    if (isHost && !T && !L.locked) b += `<button class="btn" data-act="lobbySettings">SETTINGS</button>`;
    if (isHost && L.online) b += `<button class="btn" data-act="lobbyLock">${L.locked ? 'UNLOCK' : 'LOCK SETTINGS'}</button>`;
    if (isHost) b += `<button class="btn primary" data-act="lobbyStart" ${T && (T.champion || T.eliminated) ? 'disabled' : ''}>${T ? 'PLAY NEXT MATCH' : 'START MATCH'}</button>`;
    $('lobbyBtns').innerHTML = b;
  }

  // ================================================================ ONLINE
  async function host(kind = 'match', tournament = null) {
    err(kind === 'tournament' ? 'tourneyErr' : 'setupErr', 'Creating room…');
    try {
      const { code } = await createRoom(kind, tournament);
      await connect(code);
      if (kind === 'match') session.settings(S());
    } catch (e) { err(kind === 'tournament' ? 'tourneyErr' : 'setupErr', e instanceof ServerBusy ? e.message : 'Servers busy — try again later.'); }
  }
  async function join(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { err('setupErr', 'Room codes are 5 characters.'); return; }
    err('setupErr', 'Joining…');
    try {
      const info = await roomInfo(code);
      // a running match: the server lets us back in if we were in it (same player ID, within 60 s)
      if (info.status !== 'playing' && info.players >= info.max) { err('setupErr', 'That room is full.'); return; }
      setItem('wul-lastcode', code);
      await connect(code);
    } catch (e) { err('setupErr', e.code === 'notfound' ? 'Room not found — check the code.' : e.message || 'Servers busy — try again later.'); }
  }
  function connect(code) {
    if (session) { session.leave(); session = null; }
    lobby = null;
    const s = new OnlineSession(code, app.store.athlete, {
      onLobby(m) {
        const first = !lobby; lobby = m;
        if (m.tournament) saveTourney(m.tournament, true);
        if (app.mode === 'menu') {
          const vis = document.querySelector('.screen.on');
          if (first || !vis || ['menuSetup', 'menuTourney', 'menuLobby'].includes(vis.id) && !(vis.id === 'menuSetup' && setupReturn === 'menuLobby')) { renderLobby(); app.show('menuLobby'); err('setupErr', ''); }
          else if (vis.id === 'menuBracket') renderBracket();
        }
        if (vis('menuLobby')) renderLobby();
      },
      onStart(m) {
        const rg = new RemoteGame(m, s, (t, d) => app.onEvent(t, d));
        app.startMatch('match', { ctx: 'online', remote: rg, code: m.code });
      },
      onSnap(m) { const g = app.game; if (g && g.remote && g.session === s) g.onSnap(m); },
      onOver(m) {
        if (m.tournament) saveTourney(m.tournament, true);
        if (m.abandoned && app.mode === 'play') { app.callout('MATCH ABANDONED', 'warn', 2); app.toScreen('menuLobby'); renderLobby(); }
      },
      onError(m) { err('setupErr', m.msg); err('lobbyErr', m.msg); err('tourneyErr', m.msg); if (app.mode === 'play') app.callout(m.msg, 'warn', 2.5); },
      onReconnecting() { if (app.mode === 'play') app.callout('RECONNECTING…', 'warn', 1.5); },
      onClose(code, last) {
        const was = session === s; if (!was) return;
        session = null; lobby = null;
        const msg = last ? last.msg : 'Disconnected from the room.';
        if (app.mode === 'play' && app.game && app.game.remote) { app.toMenu(); }
        if (vis('menuLobby') || vis('menuMain')) { openCustom(); }
        err('setupErr', msg);
      },
    });
    session = s;
    return s.connect();
  }
  const vis = (id) => { const el = $(id); return el && el.classList.contains('on'); };
  function leaveOnline() { if (session) { session.leave(); session = null; lobby = null; } }

  // ================================================================ TOURNAMENT
  function saveTourney(t, online = false) { tourney = { ...t, online: online || t.online }; setJSON(TKEY, tourney); }
  let tfmt = null;
  function openTourneySetup() {
    const s = S();
    tfmt = { team: s.team, teamSize: s.teamSize, duration: 70, difficulty: s.difficulty, weatherPreset: s.weatherPreset, rules: s.rules, online: false, ...(getJSON('wul-tfmt') || {}) };
    const box = $('tourneyRows'); box.innerHTML = '';
    box.append(
      teamGrid('YOUR TEAM', () => tfmt.team, v => tfmt.team = v),
      seg('TEAM SIZE', [2, 3, 4, 5, 6, 7].map(n => [n, `${n}v${n}`]), () => tfmt.teamSize, v => tfmt.teamSize = v),
      seg('FORMAT', [[70, '70 MIN · TO 13'], [100, '100 MIN · TO 15']], () => tfmt.duration, v => tfmt.duration = v),
      seg('AI DIFFICULTY', [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']], () => tfmt.difficulty, v => tfmt.difficulty = v),
      seg('WEATHER', [['sunny', 'SUNNY'], ['random', 'RANDOM'], ['windy', 'WINDY'], ['rainy', 'RAINY']], () => tfmt.weatherPreset, v => tfmt.weatherPreset = v),
      seg('PLAY', [[false, 'OFFLINE · SOLO'], [true, 'ONLINE CO-OP · HOST']], () => tfmt.online, v => tfmt.online = v),
    );
    const t = tourney;
    $('tourneyResume').innerHTML = t && !t.champion ? `<div class="note">Saved tournament: <b>${TEAMS[t.myTeam].name}</b> · ${t.eliminated ? 'eliminated' : ROUND_NAMES[currentRound(t)]}</div>
      <div class="btnrow"><button class="btn primary" data-act="tourneyResume">RESUME</button>${t.online ? '' : ''}<button class="btn" data-act="tourneyResumeOnline">RESUME ONLINE (HOST)</button></div>` : '';
    err('tourneyErr', '');
    app.show('menuTourney');
  }
  async function startNewTourney() {
    setJSON('wul-tfmt', tfmt);
    const fmt = { teamSize: tfmt.teamSize, duration: tfmt.duration, difficulty: tfmt.difficulty, weatherPreset: tfmt.weatherPreset, rules: tfmt.rules || 'usau' };
    const t = newTournament(tfmt.team, fmt, Date.now() & 0x7fffffff);
    saveTourney(t, tfmt.online);
    if (tfmt.online) { await host('tournament', t); return; }
    renderBracket(); app.show('menuBracket');
  }

  function renderBracket() {
    const t = tourney; if (!t) return;
    const r = currentRound(t), online = !!(session && lobby && lobby.kind === 'tournament');
    $('bracketTitle').textContent = online ? `ONLINE CO-OP TOURNAMENT · ROOM ${lobby.code}` : 'TOURNAMENT';
    $('bracketHead').textContent = t.champion ? `CHAMPION: ${TEAMS[t.champion].city} ${TEAMS[t.champion].name}` : ROUND_NAMES[r];
    $('bracketSub').textContent = `You: ${TEAMS[t.myTeam].city} ${TEAMS[t.myTeam].name} (seed ${t.seeds[t.myTeam]}) · ${t.fmt.teamSize}v${t.fmt.teamSize} · ${t.fmt.duration} MIN · to ${targetFor(t.fmt)}` + (t.eliminated && !t.champion ? ' · ELIMINATED' : '');
    const row = (k, sc, m) => {
      if (!k) return `<div class="bt tbd"><span class="sd"></span><span class="nm">TBD</span></div>`;
      const cls = (m && m.w ? (m.w === k ? ' w' : ' l') : '') + (k === t.myTeam ? ' me' : '');
      return `<div class="bt${cls}"><span class="sd">${t.seeds[k]}</span>${logo(k)}<span class="nm">${TEAMS[k].name}</span><span class="sc">${sc ?? ''}</span></div>`;
    };
    let h = '';
    for (let ri = 0; ri < 4; ri++) {
      const ms = t.rounds[ri] || Array.from({ length: 8 >> ri }, () => null);
      h += `<div class="bcol"><h4>${ROUND_NAMES[ri]}</h4><div class="bms">`;
      for (const m of ms) {
        const mine = m && (m.a === t.myTeam || m.b === t.myTeam);
        h += `<div class="bm${mine ? ' mine' : ''}" title="${m && m.how === 'rating' ? 'quick sim' : m && m.how === 'game' ? 'simulated match' : ''}">${row(m && m.a, m && m.sa, m)}${row(m && m.b, m && m.sb, m)}</div>`;
      }
      h += `</div></div>`;
    }
    h += `<div class="bcol champ"><h4>CHAMPION</h4><svg class="cup" viewBox="0 0 100 100"><path d="M28 12 H72 V30 C72 48 62 58 50 60 C38 58 28 48 28 30 Z" fill="#e8c35a"/><rect x="45" y="60" width="10" height="14" fill="#e8c35a"/><rect x="32" y="74" width="36" height="8" fill="#e8c35a"/></svg>${t.champion ? logo(t.champion).replace('<svg', '<svg style="width:46px;height:46px"') + `<b>${TEAMS[t.champion].name}</b>` : '<span style="opacity:.5">?</span>'}</div>`;
    $('bracket').innerHTML = h;
    $('menuBracket').querySelector('.card').scrollTop = 0;
    let b = online ? `<button class="btn" data-act="backToLobby">ROOM LOBBY</button>` : `<button class="btn" data-act="menu">MAIN MENU</button><button class="btn" data-act="tourneyAbandon">ABANDON</button>`;
    const mm = myMatch(t);
    if (t.champion) b += `<button class="btn primary" data-act="champion">CHAMPION ▸</button>`;
    else if (t.eliminated && !online) b += `<button class="btn primary" data-act="tourneySimRest">SIMULATE TO THE FINAL</button>`;
    else if (mm && !mm.w && !online) b += `<button class="btn primary" data-act="tourneyPlay">PLAY NEXT MATCH · vs ${TEAMS[mm.a === t.myTeam ? mm.b : mm.a].name}</button>`;
    else if (!online && !simming) b += `<button class="btn primary" data-act="tourneySimRound">SIMULATE ROUND</button>`;
    $('bracketBtns').innerHTML = b;
  }

  function playTourneyMatch() {
    const t = tourney, m = myMatch(t); if (!m || m.w) return;
    const opp = m.a === t.myTeam ? m.b : m.a;
    const settings = sanitizeSettings({ ...S(), ...t.fmt, team: t.myTeam, opponent: opp }, S());
    app.startMatch('match', {
      ctx: 'tourney', settings,
      onOver(g) {
        const T = tourney, mm = myMatch(T); if (!mm || mm.w) return;
        const my = g.teams[0].score, op = g.teams[1].score; // the human's team is always teams[0] here
        record(T, mm, mm.a === T.myTeam ? my : op, mm.a === T.myTeam ? op : my, 'played');
        saveTourney(T);
      },
    });
  }

  // simulate the remaining matches of the round (real headless Game, time-sliced; rating model on slow devices)
  async function simRound(untilChampion = false) {
    if (simming) return; simming = true;
    $('simWrap').style.display = ''; renderBracket();
    const t = tourney;
    let useRating = false;
    try {
      do {
        const list = pendingSims(t);
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          $('simTxt').textContent = `SIMULATING ${ROUND_NAMES[currentRound(t)]}: ${TEAMS[m.a].name} vs ${TEAMS[m.b].name} (${i + 1}/${list.length})`;
          if (useRating) { record(t, m, ...ratingResult(m.a, m.b, targetFor(t.fmt)), 'rating'); }
          else {
            const sim = simulateWithGame(m.a, m.b, t.fmt);
            const t0 = performance.now();
            while (!sim.step(14)) {
              $('simBar').firstChild.style.width = Math.min(100, sim.steps / 600) + '%';
              await new Promise(r => setTimeout(r, 0));
              // too slow on this device (projected > 6 s per match)? use the rating model from here on
              const el = performance.now() - t0;
              if (el > 1500 && sim.steps / el < 60000 / 6000) { useRating = true; break; }
            }
            if (sim.done) record(t, m, ...sim.result, 'game'); else record(t, m, ...ratingResult(m.a, m.b, targetFor(t.fmt)), 'rating');
          }
          saveTourney(t); renderBracket();
          await new Promise(r => setTimeout(r, 30));
        }
        advance(t); saveTourney(t);
      } while (untilChampion && !t.champion);
    } finally {
      simming = false; $('simWrap').style.display = 'none'; renderBracket();
    }
    if (t.champion) showChampion();
  }

  function showChampion() {
    const t = tourney; if (!t || !t.champion) return;
    const mine = t.champion === t.myTeam, c = TEAMS[t.champion];
    $('champHead').innerHTML = `${logo(t.champion).replace('<svg', '<svg style="width:54px;height:54px;vertical-align:middle"')} ${c.name} ${mine ? 'ARE CHAMPIONS!' : 'WIN IT ALL'}`;
    const fin = t.rounds[3][0];
    $('champSub').textContent = (mine ? 'You won the World Ultimate League championship! ' : `${c.city} ${c.name} are the champions. `) + `Final: ${TEAMS[fin.a].name} ${fin.sa}–${fin.sb} ${TEAMS[fin.b].name}`;
    app.show('menuChampion');
    if (mine) { app.audio.play('cheer', { v: 1 }); app.audio.play('horn'); }
    confetti(mine ? 1 : 0.35, [c.css, c.dark, '#ffd34d', '#ffffff']);
  }
  function confetti(amount, colors) {
    const cv = $('confetti'), ctx = cv.getContext('2d'); cv.width = innerWidth; cv.height = innerHeight;
    const N = Math.round(220 * amount), P = [];
    for (let i = 0; i < N; i++) P.push({ x: Math.random() * cv.width, y: -Math.random() * cv.height, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, r: Math.random() * 6, s: 4 + Math.random() * 6, c: colors[i % colors.length] });
    const t0 = performance.now();
    const tick = (now) => {
      if (!vis('menuChampion') || now - t0 > 9000) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of P) { p.x += p.vx; p.y += p.vy; p.r += 0.1; if (p.y > cv.height + 10) { p.y = -10; p.x = Math.random() * cv.width; } ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ================================================================ actions
  function onAct(act, el) {
    switch (act) {
      case 'customStart': app.startMatch('match', { ctx: 'custom' }); break;
      case 'offlineLobby': openOfflineLobby(); break;
      case 'host': host('match'); break;
      case 'join': join($('joinCode') && $('joinCode').value); break;
      case 'slot': {
        const team = +el.dataset.team, slot = +el.dataset.slot;
        if (session && lobby) session.pick(team, slot);
        else if (offline) { offline.players[0].team = team; offline.players[0].slot = slot; renderLobby(); }
        break;
      }
      case 'lobbySettings': openCustom({ from: 'menuLobby' }); break;
      case 'setupDone':
        if (session && lobby && lobby.host === session.pid) session.settings(S());
        if (offline && !session) offline.players[0].slot = Math.min(offline.players[0].slot, S().teamSize - 1);
        renderLobby(); app.show('menuLobby'); setupReturn = null; break;
      case 'lobbyLock': if (session && lobby) session.lock(!lobby.locked); break;
      case 'lobbyStart':
        if (session && lobby) { if (lobby.host === session.pid) session.start(); }
        else if (offline) { const p = offline.players[0]; app.startMatch('match', { ctx: 'lobby', humans: [{ id: 'local', team: p.team, slot: p.slot, cfg: app.store.athlete }], localId: 'local' }); }
        break;
      case 'lobbyLeave': if (session) { leaveOnline(); openCustom(); } else { offline = null; openCustom(); } break;
      case 'backToLobby':
        if (session && lobby) { app.toScreen('menuLobby'); renderLobby(); }
        else if (offline) { app.toScreen('menuLobby'); renderLobby(); }
        else app.toMenu();
        break;
      case 'tourney': openTourneySetup(); break;
      case 'tourneyNew': startNewTourney(); break;
      case 'tourneyResume': renderBracket(); app.show('menuBracket'); break;
      case 'tourneyResumeOnline': if (tourney) host('tournament', tourney); break;
      case 'tourneyAbandon': removeItem(TKEY); tourney = null; app.toMenu(); break;
      case 'tourneyPlay': playTourneyMatch(); break;
      case 'tourneyContinue':
        app.toScreen('menuBracket'); renderBracket();
        if (tourney && !tourney.champion) simRound(!!tourney.eliminated);
        break;
      case 'tourneySimRound': simRound(false); break;
      case 'tourneySimRest': simRound(true); break;
      case 'bracket': renderBracket(); app.show('menuBracket'); break;
      case 'champion': showChampion(); break;
    }
  }

  function backTarget() {
    if (vis('menuSetup') && setupReturn) return setupReturn;
    if (vis('menuBracket') || vis('menuChampion')) return 'menuMain';
    return null;
  }

  // dev/test hooks
  window.__modes = { get tourney() { return tourney; }, get lobby() { return curLobby(); }, get session() { return session; }, simRound, renderBracket, openTourneySetup, startNewTourney, setTfmt(v) { Object.assign(tfmt || {}, v); }, join, host };

  return { openCustom, onAct, leaveOnline, backTarget, renderLobby };
}
