// Tournament logic test: full bracket with the real-game sim for the human's matches and rating model for the rest.
import { newTournament, pendingSims, myMatch, record, advance, ratingResult, simulateWithGame, ROUND_NAMES, currentRound } from '../../shared/tournament.js';
import { TEAM_KEYS } from '../../shared/config.js';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const t = newTournament('skyline', { teamSize: 4, duration: 70 }, 1234);
assert(t.rounds[0].length === 8, '8 first-round matches');
assert(new Set(t.rounds[0].flatMap(m => [m.a, m.b])).size === 16 && TEAM_KEYS.every(k => t.seeds[k]), 'all 16 teams seeded once');
let guard = 0;
while (!t.champion && guard++ < 10) {
  const r = currentRound(t);
  const mine = myMatch(t);
  if (mine && !mine.w && !t.eliminated) {
    const sim = simulateWithGame(mine.a, mine.b, t.fmt); while (!sim.step(1000)); // stands in for the human's match
    record(t, mine, ...sim.result, 'played');
  }
  for (const m of pendingSims(t)) record(t, m, ...ratingResult(m.a, m.b, 13), 'rating');
  console.log(ROUND_NAMES[r].padEnd(14), t.rounds[r].map(m => `${m.a} ${m.sa}-${m.sb} ${m.b}`).join(' | '));
  assert(advance(t), 'round advances');
}
assert(t.champion && t.rounds.length === 4 && t.rounds[3].length === 1, 'champion after 4 rounds');
console.log('champion', t.champion, 'eliminated', t.eliminated, 'PASS');
