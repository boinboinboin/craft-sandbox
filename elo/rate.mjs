// Calculate Elo ratings from the fetched tournament and league data (see README.md).
// Usage: node rate.mjs
// Also importable: collectGames() and computeRatings(games, inactivity) for tuning.
//
// Reads data/portalen/*.json and data/league/*.json.
// Writes data/ratings.json (current ratings per pool), data/ratings-weekly.json and data/history/<id>.json
// (each player's rating at the end of every week, for history graphs).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as R from "./rules.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const POOLS = { MensSingles: "men", WomensSingles: "women" };
// Calibration stats skip the warm-up seasons and players with too few matches.
const CALIBRATION_FROM = "2015-07-01";
const CALIBRATION_MIN_MATCHES = 10;

const readDir = (sub) =>
  readdirSync(`${DIR}data/${sub}`).map((f) => JSON.parse(readFileSync(`${DIR}data/${sub}/${f}`, "utf8")));

// Club short name -> regional association. Official list from fetch-clubs.mjs; clubs no
// longer in it (merged or defunct) fall back to the region of the regional leagues they played in.
const clubName = (club) => (club ?? "").replace(/\s+\d+$/, "").trim(); // "Sotra 2" -> "Sotra"
function regionLookup() {
  const regions = new Map();
  for (const c of JSON.parse(readFileSync(`${DIR}data/clubs.json`, "utf8"))) regions.set(c.name, c.region);
  const votes = new Map();
  for (const g of readDir("league")) {
    if (g.regionId === 200001) continue; // national leagues
    for (const t of g.ties) {
      for (const team of [t.home, t.away]) {
        const v = votes.get(clubName(team)) ?? {};
        v[g.region] = (v[g.region] ?? 0) + 1;
        votes.set(clubName(team), v);
      }
    }
  }
  for (const [club, v] of votes) {
    if (!regions.has(club)) regions.set(club, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]);
  }
  return (club) => regions.get(clubName(club)) ?? null;
}

// Tournament matches are stored group stage first, knockout rounds up to the final.
// Across classes of the same tournament, play group stages first, then rounds by size.
function roundStage(round) {
  if (/^pulje/i.test(round)) return 0;
  const fraction = round.match(/1\s*\/\s*(\d+)/);
  if (fraction) return 10 - Math.log2(+fraction[1]); // 1/64 -> 4, 1/8 -> 7
  if (/kvart/i.test(round)) return 8;
  if (/semi/i.test(round)) return 9;
  if (/finale/i.test(round)) return 10;
  return 0;
}

export const skipped = { walkover: 0, bye: 0, unplayed: 0, noPlayer: 0 };

// One rateable game: both sides a single player with an id.
function toGame(m, meta) {
  const pool = POOLS[m.discipline];
  const sets = R.parseSets(m.score ?? "");
  if (R.isWalkover(m, sets)) {
    skipped.walkover++;
    return null;
  }
  if (!m.side1.length || !m.side2.length) {
    skipped.bye++;
    return null;
  }
  const [a] = m.side1;
  const [b] = m.side2;
  if (!pool || m.side1.length !== 1 || m.side2.length !== 1 || !a.id || !b.id) {
    skipped.noPlayer++;
    return null;
  }
  const s = R.result(m, sets);
  if (s === null) {
    skipped.unplayed++;
    return null;
  }
  const ra = regionOf(a.club);
  const rb = regionOf(b.club);
  return { pool, a, b, s, sets, crossRegion: !!(ra && rb && ra !== rb), ...meta };
}

let regionOf;

export function collectGames() {
  regionOf = regionLookup();
  const games = [];
  for (const t of readDir("portalen")) {
    t.matches.forEach((m, i) => {
      const g = toGame(m, {
        day: t.startDate,
        source: `T${t.tournamentId}`,
        order: roundStage(m.round) * 100000 + i,
        level: R.tournamentLevel(m.className),
        event: `${t.name} (${m.className})`,
      });
      if (g) games.push(g);
    });
  }
  for (const group of readDir("league")) {
    for (const tie of group.ties) {
      tie.games.forEach((m, i) => {
        const g = toGame(m, {
          day: tie.time.slice(0, 10),
          source: `L${tie.matchId}`,
          order: i,
          level: R.leagueLevel(group.ageGroup, group.division, m.game),
          event: `${group.division} ${group.group} (${m.game})`,
        });
        if (g) games.push(g);
      });
    }
  }
  return games.sort((x, y) => x.day.localeCompare(y.day) || x.source.localeCompare(y.source) || x.order - y.order);
}

// Day arithmetic on ISO dates
const DAY_MS = 86_400_000;
const toTime = (day) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day, n) => new Date(toTime(day) + n * DAY_MS).toISOString().slice(0, 10);
// Monday of the week containing `day`
const weekStart = (day) => addDays(day, -((new Date(toTime(day)).getUTCDay() + 6) % 7));

// A "return" is a player's first matches after a long break. Used to check whether the
// not playing penalty matches how returning players actually perform.
const RETURN_GAP_DAYS = 365;
const RETURN_MATCHES = 5;

// onGame(game, playerA, playerB, expectedA) is called before each rating update, for analysis.
// Experiment hooks (defaults follow the README): startRating(level), kMultiplier(game),
// playerMultiplier(player, game), ratingMultiplier(r), expectedScore(ra, rb), kappa.
export function computeRatings(
  games,
  inactivity = R.INACTIVITY,
  {
    weekly: keepWeekly = true,
    onGame,
    startRating = R.startRating,
    kMultiplier,
    playerMultiplier,
    ratingMultiplier = R.ratingMultiplier,
    expectedScore = R.expectedScore,
    kappa = R.KAPPA,
  } = {}
) {
  const players = { men: new Map(), women: new Map() };
  const calibration = { n: 0, correct: 0, logLoss: 0 };
  // surprise: mean (actual - expected) score. items: [rating before the return, days away, actual - expected]
  const returns = { n: 0, surprise: 0, logLoss: 0, items: [] };

  // Not playing penalty for the time between the end of the grace period and `day`.
  function applyInactivity(p, day) {
    if (!inactivity.halfLifeDays || !p.lastPlayed) return;
    let from = addDays(p.lastPlayed, inactivity.graceDays);
    if (p.penalizedUntil > from) from = p.penalizedUntil;
    if (day <= from) return;
    if (p.rating > inactivity.floor) {
      const factor = 0.5 ** (R.penaltyDays(from, day) / inactivity.halfLifeDays);
      p.rating = inactivity.floor + (p.rating - inactivity.floor) * factor;
    }
    p.penalizedUntil = day;
  }

  function getPlayer(pool, side, level, day, source) {
    let p = players[pool].get(side.id);
    if (!p) {
      const start = startRating(level);
      const week = weekStart(day);
      p = { id: side.id, rating: start, rd: R.RD_MAX, rdDay: day, start, peak: start, matches: 0, wins: 0, draws: 0, losses: 0, firstPlayed: day, firstWeek: week, nextWeek: week, weekly: [], returning: 0 };
      players[pool].set(side.id, p);
    }
    p.name = side.name;
    // Tournament entries use the membership club; league teams can belong to another club
    // ("Kristiansand 2", or combined teams like "Tromsø/Bygdø").
    if (source.startsWith("T")) p.tournamentClub = side.club;
    else if (!side.club.includes("/")) p.leagueClub = clubName(side.club);
    return p;
  }

  // Record the rating at the end of every week before `week` that hasn't been recorded yet.
  function closeWeeks(p, week) {
    if (!keepWeekly) return;
    for (; p.nextWeek < week; p.nextWeek = addDays(p.nextWeek, 7)) {
      applyInactivity(p, addDays(p.nextWeek, 7));
      p.weekly.push(Math.round(p.rating));
    }
  }

  function rate(g) {
    const pa = getPlayer(g.pool, g.a, g.level, g.day, g.source);
    const pb = getPlayer(g.pool, g.b, g.level, g.day, g.source);
    const week = weekStart(g.day);
    for (const p of [pa, pb]) {
      const away = p.lastPlayed ? (toTime(g.day) - toTime(p.lastPlayed)) / DAY_MS : 0;
      if (away >= RETURN_GAP_DAYS) {
        p.returning = RETURN_MATCHES;
        p.returnInfo = [p.rating, away];
      }
      closeWeeks(p, week);
      applyInactivity(p, g.day);
    }

    const ea = expectedScore(pa.rating, pb.rating);
    onGame?.(g, pa, pb, ea);
    const decisive = g.s !== 0.5;
    if (g.day >= CALIBRATION_FROM && decisive && pa.matches >= CALIBRATION_MIN_MATCHES && pb.matches >= CALIBRATION_MIN_MATCHES) {
      calibration.n++;
      if ((ea > 0.5) === (g.s === 1)) calibration.correct++;
      calibration.logLoss -= Math.log(g.s === 1 ? ea : 1 - ea);
    }
    for (const [p, e, s] of [[pa, ea, g.s], [pb, 1 - ea, 1 - g.s]]) {
      if (!p.returning) continue;
      p.returning--;
      returns.n++;
      returns.surprise += s - e;
      returns.items.push([...p.returnInfo, s - e]);
      returns.logLoss -= decisive ? Math.log(s === 1 ? e : 1 - e) : 0;
    }

    const crossRegion = g.crossRegion ? R.CROSS_REGION_K : 1;
    const k =
      kappa * R.TIERS[g.level.tier].weight * R.marginWeight(g.sets, g.s) * R.covidK(g.day) * crossRegion * (kMultiplier?.(g) ?? 1);

    // Uncertainty: grows with time since the last match, shrinks with this match (from pre-match values).
    for (const p of [pa, pb]) p.rd = R.rdAfterTime(p.rd, (toTime(g.day) - toTime(p.rdDay)) / DAY_MS);
    const rdA = R.rdAfterMatch(pa.rating, pa.rd, pb.rating, pb.rd);
    const rdB = R.rdAfterMatch(pb.rating, pb.rd, pa.rating, pa.rd);
    [pa.rd, pa.rdDay, pb.rd, pb.rdDay] = [rdA, g.day, rdB, g.day];
    const da = k * ratingMultiplier(pa.rating) * (playerMultiplier?.(pa, g) ?? 1) * (g.s - ea);
    const db = k * ratingMultiplier(pb.rating) * (playerMultiplier?.(pb, g) ?? 1) * (1 - g.s - (1 - ea));
    for (const [p, d, s] of [[pa, da, g.s], [pb, db, 1 - g.s]]) {
      p.rating += d;
      p.peak = Math.max(p.peak, p.rating);
      p.matches++;
      if (s === 1) p.wins++;
      else if (s === 0) p.losses++;
      else p.draws++;
      p.lastPlayed = g.day;
    }
  }

  for (const g of games) rate(g);

  const today = new Date().toISOString().slice(0, 10);
  for (const map of Object.values(players)) {
    for (const p of map.values()) {
      // Weekly series run to the last played week; after that the rating stays the same.
      // Ratings above the floor keep decaying while inactive, so those run to the current week.
      const decays = inactivity.halfLifeDays && p.rating > inactivity.floor;
      closeWeeks(p, addDays(weekStart(decays ? today : p.lastPlayed), 7));
      applyInactivity(p, today);
      p.rd = R.rdAfterTime(p.rd, (toTime(today) - toTime(p.rdDay)) / DAY_MS);
    }
  }
  return { players, calibration, returns };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const games = collectGames();
  const { players, calibration, returns } = computeRatings(games);

  const today = new Date().toISOString().slice(0, 10);
  const round = (x) => Math.round(x * 10) / 10;
  const ratings = {};
  const weekly = {};
  // Club shown for each player: the club registered on badmintonportalen (current as of the last
  // fetch-players.mjs run), else the last tournament club, else the last league team's club.
  const registered = new Map(
    JSON.parse(readFileSync(`${DIR}data/players.json`, "utf8")).map((p) => [p.id, p.club.trim()])
  );
  const clubOf = (p) => registered.get(p.id) || p.tournamentClub || p.leagueClub || null;

  // Rankings only include players active within RANKING_ACTIVE_DAYS; others get rank null.
  const activeSince = addDays(today, -R.RANKING_ACTIVE_DAYS);
  for (const [pool, map] of Object.entries(players)) {
    const list = [...map.values()].sort((a, b) => b.rating - a.rating);
    let rank = 0;
    ratings[pool] = list.map((player) => {
      const { weekly: _, nextWeek: __, penalizedUntil: ___, returning: ____, returnInfo: _____, rdDay: ______, tournamentClub: _______, leagueClub: ________, ...p } = player;
      const active = p.lastPlayed >= activeSince;
      // plusMinus: 95% range, rating ± 2·RD
      return { rank: active ? ++rank : null, ...p, club: clubOf(player), active, rating: round(p.rating), rd: Math.round(p.rd), plusMinus: Math.round(2 * p.rd), peak: round(p.peak) };
    });
    weekly[pool] = Object.fromEntries(list.map((p) => [p.id, { from: p.firstWeek, ratings: p.weekly }]));
  }

  writeFileSync(`${DIR}data/ratings.json`, JSON.stringify({ generatedAt: new Date().toISOString(), pools: ratings }, null, 1));
  // Per player: `from` is the Monday of their first week; ratings[i] is the rating at the end
  // of week from + 7*i days.
  writeFileSync(`${DIR}data/ratings-weekly.json`, JSON.stringify({ generatedAt: new Date().toISOString(), weekStartsOn: "Monday", pools: weekly }));
  // The same weekly history split per player ({ men: {from, ratings}, women: ... }), so the
  // website can load one player's history without reading the whole file.
  const byPlayer = new Map();
  for (const [pool, series] of Object.entries(weekly)) {
    for (const [id, history] of Object.entries(series)) byPlayer.set(id, { ...byPlayer.get(id), [pool]: history });
  }
  mkdirSync(`${DIR}data/history`, { recursive: true });
  for (const [id, history] of byPlayer) writeFileSync(`${DIR}data/history/${id}.json`, JSON.stringify(history));

  console.log(`Rated ${games.length} games (${games[0]?.day} to ${games.at(-1)?.day}).`);
  console.log(`Skipped: ${skipped.walkover} walkovers, ${skipped.bye} byes, ${skipped.unplayed} unplayed, ${skipped.noPlayer} without two identified players.`);
  console.log(`Draws: ${games.filter((g) => g.s === 0.5).length}, cross-region games: ${games.filter((g) => g.crossRegion).length}`);
  console.log(
    `Calibration (from ${CALIBRATION_FROM}, both players ${CALIBRATION_MIN_MATCHES}+ matches): ` +
      `favourite won ${((100 * calibration.correct) / calibration.n).toFixed(1)}% of ${calibration.n} games, ` +
      `log loss ${(calibration.logLoss / calibration.n).toFixed(4)} (coin flip: 0.6931)`
  );
  console.log(
    `Returning players (first ${RETURN_MATCHES} matches after ${RETURN_GAP_DAYS}+ days away): ` +
      `${returns.n} games, scored ${(returns.surprise / returns.n).toFixed(3)} vs expected`
  );
  for (const [pool, list] of Object.entries(ratings)) {
    const active = list.filter((p) => p.active);
    console.log(`\n${pool}: ${list.length} players, ${active.length} ranked (active in the last ${R.RANKING_ACTIVE_DAYS} days). Top 15:`);
    active
      .slice(0, 15)
      .forEach((p) => console.log(`${String(p.rank).padStart(3)}. ${String(Math.round(p.rating)).padStart(5)} ±${String(p.plusMinus).padEnd(4)} ${p.name} (${p.club}), ${p.matches} matches`));
  }
}
