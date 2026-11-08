// ============================================================================
// TOURNAMENT: 16-team single-elimination bracket (R16 -> QF -> SF -> Final).
// Pure data + rules; used by the client (offline) and the server (online co-op).
// Matches without a human are simulated, either with the real headless Game
// (simulateWithGame, time-sliced) or with a rating-based score model (ratingResult).
// ============================================================================
import { TEAM_KEYS, TEAM_RATINGS, mulberry } from './config.js';
import { Game } from './game.js';

export const ROUND_NAMES = ['ROUND OF 16', 'QUARTERFINALS', 'SEMIFINALS', 'FINAL'];

// fmt: { teamSize, duration, difficulty, rules, weatherPreset, assist }
export function newTournament(myTeam, fmt, seed = Date.now()) {
  const rng = mulberry(seed);
  const order = TEAM_KEYS.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const seeds = {}; order.forEach((k, i) => { seeds[k] = i + 1; });
  // standard bracket placement: 1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15
  const pos = [[1, 16], [8, 9], [5, 12], [4, 13], [3, 14], [6, 11], [7, 10], [2, 15]];
  const bySeed = (s) => order[s - 1];
  const r0 = pos.map(([a, b]) => mkMatch(bySeed(a), bySeed(b)));
  return { v: 1, id: 't' + seed.toString(36), seed, myTeam, fmt: { ...fmt }, seeds, rounds: [r0], champion: null, eliminated: false, created: Date.now() };
}

function mkMatch(a, b) { return { a, b, sa: null, sb: null, w: null, how: null }; }

export function currentRound(t) { return t.rounds.length - 1; }
export function roundDone(t, r = currentRound(t)) { return t.rounds[r].every(m => m.w); }
export function myMatch(t, r = currentRound(t)) { return t.rounds[r].find(m => m.a === t.myTeam || m.b === t.myTeam) || null; }
export function pendingSims(t) {
  const r = currentRound(t);
  return t.rounds[r].filter(m => !m.w && (t.eliminated || (m.a !== t.myTeam && m.b !== t.myTeam)));
}

// record a result; how: 'played' | 'game' (real sim) | 'rating'
export function record(t, m, sa, sb, how) {
  m.sa = sa; m.sb = sb; m.w = sa > sb ? m.a : m.b; m.how = how;
  if ((m.a === t.myTeam || m.b === t.myTeam) && m.w !== t.myTeam) t.eliminated = true;
}

// when the round is complete, pair winners into the next round (or crown the champion)
export function advance(t) {
  const r = currentRound(t);
  if (!roundDone(t, r)) return false;
  const ws = t.rounds[r].map(m => m.w);
  if (ws.length === 1) { t.champion = ws[0]; return true; }
  const next = []; for (let i = 0; i < ws.length; i += 2) next.push(mkMatch(ws[i], ws[i + 1]));
  t.rounds.push(next);
  return true;
}

// Rating model: logistic win chance from team ratings, plausible ultimate scoreline.
export function ratingResult(a, b, target = 13, rng = Math.random) {
  const ra = TEAM_RATINGS[a] ?? 1500, rb = TEAM_RATINGS[b] ?? 1500;
  const pA = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const aWins = rng() < pA;
  const close = 1 - Math.abs(pA - 0.5) * 2; // 1 = even match
  const lose = Math.max(3, Math.min(target - 1, Math.round(target - 1 - rng() * (4 + (1 - close) * 6))));
  return aWins ? [target, lose] : [lose, target];
}

// Real headless match, stepped in chunks so a UI can stay responsive.
// Returns { step(maxMs) -> done:boolean, result:[sa,sb] }.
export function simulateWithGame(a, b, fmt) {
  const settings = { teamSize: fmt.teamSize || 5, duration: fmt.duration || 70, rules: fmt.rules || 'usau', difficulty: 'normal',
    team: a, opponent: b, wind: 'random', windDir: 'N', windSpeed: 6, rain: 'random', weatherPreset: fmt.weatherPreset || 'random', assist: 'assisted', stallSeconds: 1 };
  const g = new Game(settings, { name: 'BOT', number: 0, role: 'handler', height: 'taller', gender: 'male', hand: 'right', skin: 2, hairColor: 0, hair: 'short' }, 'match', () => { });
  g.autoHuman = true;
  const LIMIT = 60 * 60 * 40; // safety: 40 sim-minutes
  let steps = 0;
  const sim = {
    done: false, result: null, steps: 0,
    step(maxMs = 8) {
      const t0 = Date.now();
      while (!g.over && steps < LIMIT) {
        for (let i = 0; i < 240 && !g.over; i++) { g.step(null); steps++; }
        if (Date.now() - t0 >= maxMs) break;
      }
      sim.steps = steps;
      if (g.over || steps >= LIMIT) {
        let s0 = g.teams[0].score, s1 = g.teams[1].score;
        if (s0 === s1) { if (Math.random() < 0.5) s0++; else s1++; }
        // Game may have swapped the opponent if keys clash; teams[0] is always `a`
        sim.done = true; sim.result = [s0, s1];
      }
      return sim.done;
    },
  };
  return sim;
}

export function targetFor(fmt) { return (fmt.duration || 70) === 70 ? 13 : 15; }
