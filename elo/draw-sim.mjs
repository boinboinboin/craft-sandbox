// Monte Carlo simulation of one tournament event's draw (groups and knockout), with each match
// won by the expected score from the entries' ratings. Used by upcoming.mjs for draw luck.
//
// An event is a list of draw slots and:
// - groups: [{ name, slots: [slot, ...], matches: [[slot, slot], ...] }]: each group is played as
//   listed (round robin if no matches are listed) and ranked by wins, ties drawn at random;
// - stages: [{ title, main, matches: [{ no, sides: [source, source] }] }]: knockout matches in
//   playing order. A source is { slot }, { winnerOf: match no }, { loserOf: match no } (a play-off
//   for third), { group, rank } (e.g. the group
//   winner, "Vinner av Pulje 3"), { bestOfRank } (the best of the groups' runners-up, "Nr. 2 fra
//   Pulje X": most group wins, ties at random) or null; a match with one side missing is a
//   walkover (no win).
//   A stage can have `places` [first, last]: the places it decides ("1-4 plassen"). Its winner
//   gets the first, the loser of its final the next, the losers one level earlier share the next
//   two (3rd–4th: 3.5 each, unless a play-off for third decides them), and so on. When every entry
//   ends in such a stage (as in the X classes: two groups of four, the top two to the 1–4 places,
//   the third-placed playing for 5th and the last for 7th), each entry gets an expected placement.
// The event winner wins the main stage's final: the match the most other matches lead to (not
// simply the last one listed, which can be a play-off for third), or the only group if there is
// no stage.
//
// Entry e plays from slot e in the actual draw. In a redraw, the seeds (the strongest entries by
// rating) keep their slots and everyone else is shuffled over the other slots.
import { expectedScore } from "./rules.mjs";

// Seeds kept in a redraw: one per group, or by bracket size in a knockout (BWF: 2 seeds below 16
// entries, 4 below 32, 8 below 64, then 16)
export function seedCount(event) {
  if (event.groups.length > 1) return event.groups.length;
  const n = event.slots;
  return n < 16 ? 2 : n < 32 ? 4 : n < 64 ? 8 : 16;
}

// The most rounds an entry can get (see simulate's `progress`): the event winner's. With a
// knockout: out of the group (if there are groups), every level up to the final, and winning it;
// the same for everyone, as a bye counts as a round. In groups only: the matches in the biggest group.
export function maxRounds(event) {
  const main = event.stages.find((s) => s.main);
  if (!main) return Math.max(0, ...event.groups.map((g) => g.slots.length - 1));
  const byNo = new Map(main.matches.map((m) => [m.no, m]));
  const depth = (m) => Math.max(0, ...m.sides.map((src) => (src?.winnerOf !== undefined && byNo.has(src.winnerOf) ? 1 + depth(byNo.get(src.winnerOf)) : 0)));
  const fed = new Set(main.matches.flatMap((m) => m.sides.map((src) => src?.winnerOf)).filter(Boolean));
  const top = Math.max(...main.matches.filter((m) => !fed.has(m.no)).map(depth));
  return (event.groups.length ? 1 : 0) + top + 1;
}

// A knockout stage's levels: its final 0 (the match the most other matches lead to), the matches
// feeding it 1, and so on; `thirdNo`: a play-off for third (both sides losers of level-1 matches)
function stageLevels(stage) {
  const byNo = new Map(stage.matches.map((m) => [m.no, m]));
  const feeders = (m) => m.sides.reduce((sum, src) => sum + (src?.winnerOf !== undefined && byNo.has(src.winnerOf) ? 1 + feeders(byNo.get(src.winnerOf)) : 0), 0);
  const fed = new Set(stage.matches.flatMap((m) => m.sides.map((src) => src?.winnerOf)).filter(Boolean));
  const final = stage.matches.filter((m) => !fed.has(m.no)).map((m) => [m, feeders(m)]).sort((a, b) => b[1] - a[1])[0]?.[0];
  const level = new Map();
  if (!final) return { level, finalNo: null, top: 0, thirdNo: null };
  level.set(final.no, 0);
  for (let i = stage.matches.length - 1; i >= 0; i--) {
    const m = stage.matches[i];
    if (!level.has(m.no)) continue;
    for (const src of m.sides) if (src?.winnerOf !== undefined) level.set(src.winnerOf, level.get(m.no) + 1);
  }
  const third = stage.matches.find((m) => m.sides.every((src) => src?.loserOf !== undefined && level.get(src.loserOf) === 1));
  return { level, finalNo: final.no, top: Math.max(0, ...level.values()), thirdNo: third?.no ?? null };
}

const shuffle = (list, random) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

// Small fast seeded generator, so runs are repeatable (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per entry over `runs` simulations: expected match wins, the chances of winning their group,
// reaching the main knockout stage and winning the event, and `progress`: the expected number of
// rounds they get through. A round is a level of the main knockout counted back from the final
// (reaching the semi-final is one round more than the quarter-final, winning one more than the
// final), so a bye counts as a round got through; with no knockout, progress is the match wins.
// With `redraw`, every run first redraws the entries as above.
export function simulate(event, ratings, { runs = 20000, redraw = false, seed = 1 } = {}) {
  const n = event.slots;
  const random = rng(seed);
  // chance[a][b]: entry a beats entry b
  const chance = ratings.map((ra) => ratings.map((rb) => expectedScore(ra, rb)));
  const seeds = new Set([...ratings.keys()].sort((a, b) => ratings[b] - ratings[a]).slice(0, seedCount(event)));
  const free = [...Array(n).keys()].filter((s) => !seeds.has(s)); // slots of non-seeds (= their entries)
  const totals = ratings.map(() => ({ wins: 0, groupWin: 0, knockout: 0, win: 0 }));
  const groupMatches = event.groups.map((g) =>
    g.matches?.length ? g.matches : g.slots.flatMap((a, i) => g.slots.slice(i + 1).map((b) => [a, b]))
  );
  const main = event.stages.find((s) => s.main);
  const levels = new Map(event.stages.map((stage) => [stage, stageLevels(stage)]));
  const { level, finalNo, top } = main ? levels.get(main) : { level: new Map(), finalNo: null, top: 0 };
  const placed = event.stages.filter((s) => s.places);
  const placements = new Float64Array(ratings.length);
  let placedRuns = 0;
  const progress = new Float64Array(ratings.length);

  const atSlot = [...Array(n).keys()]; // entry playing from each slot
  for (let run = 0; run < runs; run++) {
    if (redraw) {
      const shuffled = shuffle(free.slice(), random);
      free.forEach((slot, i) => (atSlot[slot] = shuffled[i]));
    }
    const play = (a, b) => {
      const winner = random() < chance[a][b] ? a : b;
      totals[winner].wins++;
      return winner;
    };

    // Groups: ranked by wins, ties at random
    const groupWins = new Map(); // entry -> wins in its group
    const ranking = event.groups.map((g, gi) => {
      const wins = new Map(g.slots.map((s) => [atSlot[s], 0]));
      for (const [x, y] of groupMatches[gi]) {
        const w = play(atSlot[x], atSlot[y]);
        wins.set(w, wins.get(w) + 1);
      }
      for (const [e, w] of wins) groupWins.set(e, w);
      const order = [...wins.keys()].map((e) => [e, wins.get(e) + random() * 0.5]).sort((p, q) => q[1] - p[1]).map(([e]) => e);
      if (order.length) totals[order[0]].groupWin++;
      return order;
    });

    // The best entry ranked `rank` in its group, by group wins (ties at random), once per run
    const bestCache = new Map();
    const bestOfRank = (rank) => {
      if (!bestCache.has(rank)) {
        const candidates = ranking.map((order) => order[rank - 1]).filter((e) => e !== undefined);
        bestCache.set(rank, candidates.map((e) => [e, groupWins.get(e) + random() * 0.5]).sort((p, q) => q[1] - p[1])[0]?.[0] ?? null);
      }
      return bestCache.get(rank);
    };

    // Knockout stages
    let winner = event.stages.length ? null : event.groups.length === 1 ? ranking[0][0] : null;
    const winners = new Map(); // match no -> entry
    const losers = new Map(); // match no -> entry
    const place = new Map(); // entry -> placement this run
    const deepest = new Map(); // entry -> lowest main-stage level reached
    for (const stage of event.stages) {
      const reached = new Set();
      let last = null;
      for (const m of stage.matches) {
        const [a, b] = m.sides.map((src) =>
          !src ? null
          : src.slot !== undefined ? atSlot[src.slot]
          : src.winnerOf !== undefined ? winners.get(src.winnerOf) ?? null
          : src.loserOf !== undefined ? losers.get(src.loserOf) ?? null
          : src.bestOfRank !== undefined ? bestOfRank(src.bestOfRank)
          : ranking[src.group]?.[src.rank - 1] ?? null
        );
        for (const e of [a, b]) {
          if (e === null) continue;
          reached.add(e);
          if (stage === main && level.has(m.no)) deepest.set(e, Math.min(deepest.get(e) ?? Infinity, level.get(m.no)));
        }
        last = a !== null && b !== null ? play(a, b) : a ?? b;
        winners.set(m.no, last);
        const loser = last === a ? b : a;
        losers.set(m.no, loser);
        // Placement: the loser of a match at level L shares places first + 2^L .. first + 2^(L+1) − 1
        const { level: stageLevel, finalNo: stageFinal, thirdNo } = levels.get(stage);
        if (stage.places && loser !== null) {
          const [first, last_] = stage.places;
          if (m.no === thirdNo) place.set(loser, Math.min(first + 3, last_));
          else if (stageLevel.has(m.no) && !(thirdNo && stageLevel.get(m.no) === 1)) {
            const l = stageLevel.get(m.no);
            const from = first + 2 ** l;
            const to = Math.min(last_, first + 2 ** (l + 1) - 1);
            place.set(loser, (from + to) / 2);
          }
        }
        if (stage.places && m.no === thirdNo && last !== null) place.set(last, stage.places[0] + 2);
        if (stage.places && m.no === stageFinal && last !== null) place.set(last, stage.places[0]);
      }
      if (stage === main) {
        for (const e of reached) totals[e].knockout++;
        winner = winners.get(finalNo) ?? null;
      }
    }
    if (winner !== null) totals[winner].win++;
    if (main) {
      for (const [e, l] of deepest) progress[e] += top - l;
      if (winner !== null) progress[winner]++;
    }
    if (placed.length && place.size === n) {
      for (const [e, p] of place) placements[e] += p;
      placedRuns++;
    }
  }
  return totals.map((t, e) => ({
    wins: t.wins / runs,
    groupWin: t.groupWin / runs,
    knockout: t.knockout / runs,
    win: t.win / runs,
    progress: main ? progress[e] / runs + (event.groups.length ? t.knockout / runs : 0) : t.wins / runs,
    // Expected placement, when every entry is placed (null otherwise)
    place: placed.length && placedRuns === runs ? placements[e] / runs : null,
  }));
}
