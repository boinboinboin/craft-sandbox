// Eliteserien team strengths: each team's best lineup and its chances against the other teams.
// Usage: node eliteserien.mjs   (after rate.mjs; reads data/ratings.json and eliteserien-2026-27.txt)
//
// A tie is 8 matches: 2 men's singles, 2 women's singles, 1 men's doubles, 1 women's doubles and
// 2 mixed doubles. A player plays at most 2 matches, and at most one in each discipline. The first
// singles player must have more official ranking points (badmintonportalen) than the second, and
// the first mixed pair more combined mixed doubles points than the second (on equal points either
// order is allowed). Reads the points from data/ranking/<season>.json (fetch-ranking.mjs).
// Writes data/eliteserien.json.
//
// The model is exported for eliteserien-review.mjs, which runs it on last season with the ratings
// and ranking points from right before each round.
import { readFileSync, writeFileSync } from "node:fs";
import * as R from "./rules.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const SEASON = "2026/2027";
const ROSTER = `${DIR}eliteserien-2026-27.txt`;
const SOURCE = "https://www.badminton.no/siteassets/spillere-i-eliteserien-2026-27.pdf";
const MAX_MATCHES = 2;
const RANKING = `${DIR}data/ranking/2002026.json`; // official ranking lists for the season
// Slots in the order they are listed, and the pools their ratings come from
export const SLOTS = [
  { key: "MS1", label: "1. Men's singles", type: "MS" },
  { key: "MS2", label: "2. Men's singles", type: "MS" },
  { key: "WS1", label: "1. Women's singles", type: "WS" },
  { key: "WS2", label: "2. Women's singles", type: "WS" },
  { key: "MD", label: "Men's doubles", type: "MD" },
  { key: "WD", label: "Women's doubles", type: "WD" },
  { key: "XD1", label: "1. Mixed doubles", type: "XD" },
  { key: "XD2", label: "2. Mixed doubles", type: "XD" },
];

// Where ratings and ranking points come from: { rating(id, pool) -> rating or null, name(id),
// club(id), points(id, list) -> points, replacement: lowest ratings }. The current one uses today's
// ratings (data/ratings.json) and ranking list.
export function lowestRatings(pools) {
  const lowest = (list) => Math.min(...list.filter((p) => p.rank !== null).map((p) => p.rating));
  return {
    men: lowest(pools.men),
    women: lowest(pools.women),
    mensDoubles: lowest(pools.mensDoubles),
    womensDoubles: lowest(pools.womensDoubles),
    mixedM: lowest(pools.mixedDoubles.filter((p) => p.gender === "M")),
    mixedK: lowest(pools.mixedDoubles.filter((p) => p.gender === "K")),
  };
}
// Official ranking points by player id, per list (players not on a list have 0)
export function rankingPoints(file) {
  const ranking = JSON.parse(readFileSync(file, "utf8"));
  const lists = Object.fromEntries(["men", "women", "mixedMen", "mixedWomen"].map((list) => [list, new Map((ranking[list] ?? []).map((r) => [r.id, r.points]))]));
  return { period: ranking.period, points: (id, list) => lists[list].get(id) ?? 0 };
}
function currentSource() {
  const { pools } = JSON.parse(readFileSync(`${DIR}data/ratings.json`, "utf8"));
  const byId = Object.fromEntries(Object.entries(pools).map(([pool, list]) => [pool, new Map(list.map((p) => [p.id, p]))]));
  const find = (id) => Object.values(byId).map((m) => m.get(id)).find(Boolean);
  const { period, points } = rankingPoints(RANKING);
  return {
    rating: (id, pool) => byId[pool].get(id)?.rating ?? null,
    name: (id) => find(id)?.name ?? null,
    club: (id) => find(id)?.club ?? null,
    points,
    period,
    replacement: lowestRatings(pools),
  };
}

// The roster file: [Team] sections of "M|K <id or -> <name> [| loan <club>]"
export function readRoster(file = ROSTER) {
  const teams = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const team = line.match(/^\[(.+)\]$/);
    if (team) teams.push({ team: team[1], players: [] });
    const m = line.match(/^([MK])\s+(\d+|-)\s+(.+?)(?:\s*\|\s*loan\s+(.+))?$/);
    if (m) teams.at(-1).players.push({ gender: m[1], id: m[2] === "-" ? null : +m[2], listName: m[3], loanFrom: m[4] ?? null });
  }
  return teams;
}

// A player's ratings for the three kinds of match. Missing doubles ratings come from the singles
// rating, as for a new doubles player (R.DOUBLES_SINGLES_SEED); anything else missing counts at
// the lowest rating among ranked players.
export function playerRatings(p, source) {
  const male = p.gender === "M";
  const { replacement } = source;
  const singles = p.id ? source.rating(p.id, male ? "men" : "women") : null;
  const doubles = p.id ? source.rating(p.id, male ? "mensDoubles" : "womensDoubles") : null;
  const mixed = p.id ? source.rating(p.id, "mixedDoubles") : null;
  const seed = singles !== null ? R.P0 + R.DOUBLES_SINGLES_SEED * (singles - R.P0) : null;
  return {
    ...p,
    name: (p.id && source.name(p.id)) || p.listName,
    club: (p.id && source.club(p.id)) || null,
    singles: singles ?? replacement[male ? "men" : "women"],
    doubles: doubles ?? seed ?? replacement[male ? "mensDoubles" : "womensDoubles"],
    mixed: mixed ?? seed ?? replacement[male ? "mixedM" : "mixedK"],
    estimated: { singles: singles === null, doubles: doubles === null, mixed: mixed === null },
    points: {
      singles: p.id ? source.points(p.id, male ? "men" : "women") : 0,
      mixed: p.id ? source.points(p.id, male ? "mixedMen" : "mixedWomen") : 0,
    },
    rated: singles !== null || doubles !== null || mixed !== null,
  };
}

const pairs = (list) => list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b]));
// The orders two players or pairs may play in: more ranking points first; either on equal points
const allowedOrders = ([a, b], pointsOf) =>
  pointsOf(a) > pointsOf(b) ? [[a, b]] : pointsOf(a) < pointsOf(b) ? [[b, a]] : [[a, b], [b, a]];
export const win = (side, opponent) => R.expectedScore(side, opponent);

// The lineup with the most expected match wins against the reference (average) opponent in each
// slot. Men and women are chosen separately (singles and their doubles) for each possible mixed
// doubles pair of men and of women, then the best combination with mixed pairs is taken.
export function bestLineup(men, women, ref) {
  function bestSide(players, singlesRef, doublesRef) {
    const best = new Map(); // mixed pair key -> { value, singles, doubles }
    const mixedPairs = pairs(players);
    for (const unordered of pairs(players)) {
      // First singles: the player with more singles ranking points (the better order on equal points)
      const singlesValue = (pair) => win(pair[0].singles, singlesRef[0]) + win(pair[1].singles, singlesRef[1]);
      const singles = allowedOrders(unordered, (p) => p.points.singles).reduce((x, y) => (singlesValue(y) > singlesValue(x) ? y : x));
      for (const doubles of pairs(players)) {
        const value = singlesValue(singles) + win(doubles[0].doubles + doubles[1].doubles, doublesRef);
        for (const mixed of mixedPairs) {
          const used = [...singles, ...doubles, ...mixed];
          if (players.some((p) => used.filter((u) => u === p).length > MAX_MATCHES)) continue;
          const key = mixed.map((p) => p.listName).join("|");
          if (!best.has(key) || best.get(key).value < value) best.set(key, { value, singles, doubles, mixed });
        }
      }
    }
    return [...best.values()];
  }
  const menSides = bestSide(men, ref.MS, ref.MD);
  const womenSides = bestSide(women, ref.WS, ref.WD);
  let best = null;
  for (const m of menSides) {
    for (const w of womenSides) {
      for (const order of [[0, 1], [1, 0]]) {
        const twoPairs = [[m.mixed[0], w.mixed[order[0]]], [m.mixed[1], w.mixed[order[1]]]].map((pair) => ({
          players: pair,
          rating: pair[0].mixed + pair[1].mixed,
          points: pair[0].points.mixed + pair[1].points.mixed,
        }));
        // First mixed: the pair with more combined mixed doubles points (the better order on equal points)
        for (const mixed of allowedOrders(twoPairs, (pair) => pair.points)) {
          const value = m.value + w.value + win(mixed[0].rating, ref.XD[0]) + win(mixed[1].rating, ref.XD[1]);
          if (!best || value > best.value) best = { value, men: m, women: w, mixed };
        }
      }
    }
  }
  if (!best) return null;
  const single = (p) => ({ players: [p], rating: p.singles });
  const double = (pair) => ({ players: pair, rating: pair[0].doubles + pair[1].doubles });
  return {
    MS1: single(best.men.singles[0]),
    MS2: single(best.men.singles[1]),
    WS1: single(best.women.singles[0]),
    WS2: single(best.women.singles[1]),
    MD: double(best.men.doubles),
    WD: double(best.women.doubles),
    XD1: best.mixed[0],
    XD2: best.mixed[1],
  };
}

// The average opponent in each slot: the average rating of the best players across all teams
// (for two slots, the 8 best and the next 8; doubles and mixed as pair sums).
export function references(teams) {
  const all = teams.flatMap((t) => t.players);
  const top = (list, key) => list.map((p) => p[key]).sort((a, b) => b - a);
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const n = teams.length;
  const men = all.filter((p) => p.gender === "M");
  const women = all.filter((p) => p.gender === "K");
  const ms = top(men, "singles"), ws = top(women, "singles");
  const md = top(men, "doubles"), wd = top(women, "doubles");
  const xm = top(men, "mixed"), xk = top(women, "mixed");
  return {
    MS: [avg(ms.slice(0, n)), avg(ms.slice(n, 2 * n))],
    WS: [avg(ws.slice(0, n)), avg(ws.slice(n, 2 * n))],
    MD: 2 * avg(md.slice(0, 2 * n)),
    WD: 2 * avg(wd.slice(0, 2 * n)),
    XD: [avg(xm.slice(0, n)) + avg(xk.slice(0, n)), avg(xm.slice(n, 2 * n)) + avg(xk.slice(n, 2 * n))],
  };
}

// Chances of winning, drawing (4-4) and losing a tie from the 8 match win chances
// Table points for a tie by matches won: 6-2 or better 4, 5-3 3, 4-4 2, 3-5 1, otherwise 0
export const tablePoints = (won) => (won >= 6 ? 4 : won === 5 ? 3 : won === 4 ? 2 : won === 3 ? 1 : 0);

// Chances of winning, drawing (4-4) and losing a tie from the 8 match win chances, the expected
// matches won and the expected table points
export function tieOdds(chances) {
  let dist = [1];
  for (const p of chances) {
    const next = Array(dist.length + 1).fill(0);
    dist.forEach((q, k) => {
      next[k] += q * (1 - p);
      next[k + 1] += q * p;
    });
    dist = next;
  }
  const half = chances.length / 2;
  const sum = (from, to) => dist.slice(from, to).reduce((a, b) => a + b, 0);
  return {
    win: sum(half + 1, dist.length),
    draw: dist[half],
    loss: sum(0, half),
    expected: chances.reduce((a, b) => a + b, 0),
    points: dist.reduce((total, p, won) => total + p * tablePoints(won), 0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = currentSource();
  const teams = readRoster().map((t) => ({ ...t, players: t.players.map((p) => playerRatings(p, source)) }));
  const ref = references(teams);
  for (const t of teams) {
    t.lineup = bestLineup(t.players.filter((p) => p.gender === "M"), t.players.filter((p) => p.gender === "K"), ref);
  }

  // Head to head: slot against slot
  const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
  const headToHead = {};
  for (const a of teams) {
    headToHead[a.team] = {};
    for (const b of teams) {
      if (a === b) continue;
      const chances = SLOTS.map((s) => win(a.lineup[s.key].rating, b.lineup[s.key].rating));
      const odds = tieOdds(chances);
      headToHead[a.team][b.team] = { ...Object.fromEntries(Object.entries(odds).map(([k, v]) => [k, round(v)])), matches: chances.map((c) => round(c)) };
    }
  }
  for (const t of teams) {
    const games = Object.values(headToHead[t.team]);
    const mean = (key) => games.reduce((sum, g) => sum + g[key], 0) / games.length;
    // tablePoints: expected table points over the regular season, one tie against each other team
    t.strength = {
      expected: round(mean("expected"), 2), win: round(mean("win")), draw: round(mean("draw")), loss: round(mean("loss")),
      points: round(mean("points"), 2), tablePoints: round(mean("points") * games.length, 1),
    };
  }
  // Predicted table: by expected table points, then expected matches won
  teams.sort((a, b) => b.strength.tablePoints - a.strength.tablePoints || b.strength.expected - a.strength.expected);

  const playerOut = (p) => ({
    id: p.id, name: p.name, listName: p.listName, gender: p.gender, club: p.club, loanFrom: p.loanFrom, rated: p.rated,
    singles: Math.round(p.singles), doubles: Math.round(p.doubles), mixed: Math.round(p.mixed), estimated: p.estimated, points: p.points,
  });
  const out = {
    season: SEASON,
    source: SOURCE,
    rankingPeriod: source.period,
    generatedAt: new Date().toISOString(),
    slots: SLOTS,
    references: Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, Array.isArray(v) ? v.map(Math.round) : Math.round(v)])),
    teams: teams.map((t, i) => ({
      rank: i + 1,
      team: t.team,
      strength: t.strength,
      lineup: Object.fromEntries(SLOTS.map((s) => [s.key, { rating: Math.round(t.lineup[s.key].rating), players: t.lineup[s.key].players.map((p) => p.id ?? p.listName) }])),
      players: t.players.map(playerOut).sort((a, b) => a.gender.localeCompare(b.gender) || b.singles - a.singles),
    })),
    headToHead,
  };
  writeFileSync(`${DIR}data/eliteserien.json`, JSON.stringify(out, null, 1));

  console.log(`Eliteserien ${SEASON}: predicted table (expected table points from one tie against each team), expected matches won per tie (of 8) and chance of winning a tie:`);
  for (const t of out.teams) {
    const loans = t.players.filter((p) => p.loanFrom).map((p) => `${p.name} (loan from ${p.loanFrom})`);
    console.log(`${t.rank}. ${t.team.padEnd(13)} ${t.strength.tablePoints.toFixed(1).padStart(4)} points  ${t.strength.expected.toFixed(2)}  win ${Math.round(t.strength.win * 100)}%  draw ${Math.round(t.strength.draw * 100)}%${loans.length ? `  · ${loans.join(", ")}` : ""}`);
  }
  const unrated = out.teams.flatMap((t) => t.players.filter((p) => !p.rated).map((p) => `${p.listName} (${t.team})`));
  if (unrated.length) console.log(`Without rated matches: ${unrated.join(", ")}`);
}
