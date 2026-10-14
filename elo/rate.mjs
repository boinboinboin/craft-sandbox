// Calculate Elo ratings from the fetched tournament and league data (see README.md).
// Usage: node rate.mjs
// Also importable: collectGames() and computeRatings(games, inactivity) for tuning.
//
// Reads data/portalen/*.json and data/league/*.json.
// Writes data/ratings.json (current ratings and strongest clubs per pool), data/ratings-weekly.json and
// data/history/<id>.json (each player's rating at the end of every week, for history graphs), and
// data/matches/<id>.json (each player's last matches and biggest wins and losses).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as R from "./rules.mjs";

const DIR = new URL(".", import.meta.url).pathname;
// Rating pool per discipline. Every pool is rated separately.
const POOLS = { MensSingles: "men", WomensSingles: "women", MensDoubles: "mensDoubles", WomensDoubles: "womensDoubles", MixedDoubles: "mixedDoubles" };
const DOUBLES = new Set(["mensDoubles", "womensDoubles", "mixedDoubles"]);
// Calibration stats skip the warm-up seasons and players with too few matches.
const CALIBRATION_FROM = "2015-07-01";
const CALIBRATION_MIN_MATCHES = 10;
// Per player and pool: this many last matches, and biggest wins and losses (by win chance before the match).
const RECENT_MATCHES = 20;
const BIGGEST_MATCHES = 5;
// Rivals: opponents met at least RIVAL_MIN_MATCHES times, closest first by the average point
// margin d (as in the margin of victory weight). The average is pulled towards a typical margin
// as if there were RIVAL_PRIOR_MATCHES more matches, so many close matches beat a few.
const RIVAL_MIN_MATCHES = 3;
const RIVAL_PRIOR_MATCHES = 2;
const TYPICAL_MARGIN = 0.2;
const RIVALS = 3;
// Club history: a tournament club counts for this long; otherwise the league team's club is used.
const TOURNAMENT_CLUB_DAYS = 365;
// Club strength per pool: average rating of a club's best ranked players, and clubs need at least
// this many. Doubles: the best 4 players (two pairs). Mixed doubles: the best 3 men and the best 3
// women, counted per gender since men's and women's mixed ratings can't be compared.
const CLUB_TOP = { men: 3, women: 3, mensDoubles: 4, womensDoubles: 4, mixedDoubles: { M: 3, K: 3 } };
const clubTopLabel = (top) =>
  typeof top === "number" ? `best ${top} ranked players` : `best ${top.M} ranked men and best ${top.K} ranked women`;

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

// One rateable game: both sides complete (one player in singles, two in doubles), all with ids.
function toGame(m, meta) {
  const pool = POOLS[m.discipline];
  if (!pool) return null;
  const sets = R.parseSets(m.score ?? "");
  if (R.isWalkover(m, sets)) {
    skipped.walkover++;
    return null;
  }
  if (!m.side1.length || !m.side2.length) {
    skipped.bye++;
    return null;
  }
  const size = DOUBLES.has(pool) ? 2 : 1;
  const sides = [m.side1, m.side2];
  if (sides.some((side) => side.length !== size || side.some((p) => !p.id))) {
    skipped.noPlayer++;
    return null;
  }
  const s = R.result(m, sets);
  if (s === null) {
    skipped.unplayed++;
    return null;
  }
  // Cross-region: every player's region is known and the two sides share none.
  const [r1, r2] = sides.map((side) => side.map((p) => regionOf(p.club)));
  const crossRegion = [...r1, ...r2].every(Boolean) && !r1.some((r) => r2.includes(r));
  return { pool, side1: m.side1, side2: m.side2, s, sets, crossRegion, ...meta };
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

// onGame(game, side1, side2, expected1) is called before each rating update, for analysis; sides are
// arrays of player states. Experiment hooks (defaults follow the README): startRating(level),
// kMultiplier(game), playerMultiplier(player, game), ratingMultiplier(r), expectedScore(ra, rb),
// kappa, doublesKappa (base K-factor for doubles) and doublesSplit ("rd" or "equal": how a doubles
// side's rating change is shared between the partners).
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
    doublesKappa = R.DOUBLES_KAPPA,
    doublesSplit = R.DOUBLES_SPLIT,
  } = {}
) {
  const players = Object.fromEntries(Object.values(POOLS).map((pool) => [pool, new Map()]));
  // Prediction accuracy per pool
  const calibration = Object.fromEntries(Object.keys(players).map((pool) => [pool, { n: 0, correct: 0, logLoss: 0 }]));
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

  const rdMax = (pool) => (DOUBLES.has(pool) ? R.DOUBLES_RD_MAX : R.RD_MAX);

  function getPlayer(pool, side, level, day, source) {
    let p = players[pool].get(side.id);
    if (!p) {
      const start = startRating(level);
      const week = weekStart(day);
      p = { id: side.id, rating: start, rd: rdMax(pool), rdDay: day, start, peak: start, matches: 0, wins: 0, draws: 0, losses: 0, firstPlayed: day, firstWeek: week, nextWeek: week, weekly: [], log: [], clubs: [], returning: 0 };
      players[pool].set(side.id, p);
    }
    p.name = side.name;
    // Tournament entries use the membership club; league teams can belong to another club
    // ("Kristiansand 2", or combined teams like "Tromsø/Bygdø").
    if (source.startsWith("T")) {
      if (side.club) [p.tournamentClub, p.tournamentDay] = [side.club, day];
    } else if (side.club && !side.club.includes("/")) p.leagueClub = clubName(side.club);
    // Club history for the rating graph: [week index, club] whenever the club changes.
    const recent = p.tournamentDay && (toTime(day) - toTime(p.tournamentDay)) / DAY_MS <= TOURNAMENT_CLUB_DAYS;
    const club = (recent ? p.tournamentClub : p.leagueClub) ?? p.tournamentClub;
    if (club && club !== p.clubs.at(-1)?.[1]) {
      const index = Math.round((toTime(weekStart(day)) - toTime(p.firstWeek)) / (7 * DAY_MS));
      if (p.clubs.at(-1)?.[0] === index) p.clubs.pop(); // changed within the same week: keep the last
      if (club !== p.clubs.at(-1)?.[1]) p.clubs.push([index, club]);
    }
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
    const sides = [g.side1, g.side2].map((side) => side.map((player) => getPlayer(g.pool, player, g.level, g.day, g.source)));
    const all = sides.flat();
    const week = weekStart(g.day);
    for (const p of all) {
      const away = p.lastPlayed ? (toTime(g.day) - toTime(p.lastPlayed)) / DAY_MS : 0;
      if (away >= RETURN_GAP_DAYS) {
        p.returning = RETURN_MATCHES;
        p.returnInfo = [p.rating, away];
      }
      closeWeeks(p, week);
      applyInactivity(p, g.day);
    }

    // A doubles side plays at the sum of its two players' ratings: a pair whose players are each
    // 100 points better is a 200-point favourite. (The average predicted too cautiously.)
    const teamRating = (side) => side.reduce((sum, p) => sum + p.rating, 0);
    const ea = expectedScore(teamRating(sides[0]), teamRating(sides[1]));
    onGame?.(g, sides[0], sides[1], ea);
    const decisive = g.s !== 0.5;
    const settled = all.every((p) => p.matches >= CALIBRATION_MIN_MATCHES);
    if (g.day >= CALIBRATION_FROM && decisive && settled) {
      const c = calibration[g.pool];
      c.n++;
      if ((ea > 0.5) === (g.s === 1)) c.correct++;
      c.logLoss -= Math.log(g.s === 1 ? ea : 1 - ea);
    }
    // Per side: its players, expected score, actual score and set scores from its own side.
    const flip = (sets) => sets.map(([x, y]) => [y, x]);
    const perSide = [
      { players: sides[0], opponents: sides[1], e: ea, s: g.s, sets: g.sets },
      { players: sides[1], opponents: sides[0], e: 1 - ea, s: 1 - g.s, sets: flip(g.sets) },
    ];
    for (const { players: side, e, s } of perSide) {
      for (const p of side) {
        if (!p.returning) continue;
        p.returning--;
        returns.n++;
        returns.surprise += s - e;
        returns.items.push([...p.returnInfo, s - e]);
        returns.logLoss -= decisive ? Math.log(s === 1 ? e : 1 - e) : 0;
      }
    }

    const doubles = DOUBLES.has(g.pool);
    const crossRegion = g.crossRegion ? R.CROSS_REGION_K : 1;
    const k =
      (doubles ? doublesKappa : kappa) *
      R.TIERS[g.level.tier].weight * R.marginWeight(g.sets, g.s) * R.covidK(g.day) * crossRegion * (kMultiplier?.(g) ?? 1);

    // Uncertainty: grows with time since the last match, shrinks with this match (from pre-match
    // values). In doubles each player is measured against the opposing side's summed rating and
    // the uncertainty of that sum.
    for (const p of all) p.rd = R.rdAfterTime(p.rd, (toTime(g.day) - toTime(p.rdDay)) / DAY_MS, rdMax(g.pool));
    const teamRd = (side) => Math.sqrt(side.reduce((sum, p) => sum + p.rd ** 2, 0));
    const rdAfter = perSide.map(({ players: side, opponents }) =>
      side.map((p) => R.rdAfterMatch(teamRating(side), p.rd, teamRating(opponents), teamRd(opponents)))
    );

    // Rating changes: a side's change K·(S − E) is shared between its players, by each one's
    // uncertainty (RD²) or equally, then scaled by each player's own m(R).
    for (const side of perSide) {
      const variance = side.players.reduce((sum, p) => sum + p.rd ** 2, 0);
      side.changes = side.players.map((p) => {
        const share = !doubles ? 1 : doublesSplit === "rd" ? p.rd ** 2 / variance : 1 / side.players.length;
        return k * share * ratingMultiplier(p.rating) * (playerMultiplier?.(p, g) ?? 1) * (side.s - side.e);
      });
    }
    perSide.forEach((side, i) => side.players.forEach((p, j) => ([p.rd, p.rdDay] = [rdAfter[i][j], g.day])));

    if (keepWeekly) {
      const ref = (p) => ({ id: p.id, name: p.name, rating: Math.round(p.rating) });
      for (const side of perSide) {
        side.players.forEach((p, j) => {
          p.log.push({
            day: g.day, event: g.event,
            partner: doubles ? ref(side.players[1 - j]) : null,
            opponents: side.opponents.map(ref),
            rating: Math.round(p.rating), change: Math.round(side.changes[j] * 10) / 10, result: side.s, winChance: Math.round(side.e * 1000) / 1000,
            score: side.sets.map((x) => x.join("-")).join(", "),
            // Only matches between players with settled ratings count as biggest wins and losses.
            settled,
            margin: R.pointMargin(side.sets),
          });
        });
      }
    }
    for (const side of perSide) {
      side.players.forEach((p, j) => {
        p.rating += side.changes[j];
        p.peak = Math.max(p.peak, p.rating);
        p.matches++;
        if (side.s === 1) p.wins++;
        else if (side.s === 0) p.losses++;
        else p.draws++;
        p.lastPlayed = g.day;
      });
    }
  }

  for (const g of games) rate(g);

  const today = new Date().toISOString().slice(0, 10);
  for (const [pool, map] of Object.entries(players)) {
    for (const p of map.values()) {
      // Weekly series run to the last played week; after that the rating stays the same.
      // Ratings above the floor keep decaying while inactive, so those run to the current week.
      const decays = inactivity.halfLifeDays && p.rating > inactivity.floor;
      closeWeeks(p, addDays(weekStart(decays ? today : p.lastPlayed), 7));
      applyInactivity(p, today);
      p.rd = R.rdAfterTime(p.rd, (toTime(today) - toTime(p.rdDay)) / DAY_MS, rdMax(pool));
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
  const genders = new Map(JSON.parse(readFileSync(`${DIR}data/players.json`, "utf8")).map((p) => [p.id, p.gender]));
  // Players not in the register: the opposite of most of their mixed doubles partners' genders,
  // else "K" if they have played women's singles or doubles. Marked as inferred.
  const inferred = new Map();
  const partnerVotes = new Map();
  for (const g of games) {
    if (g.pool !== "mixedDoubles") continue;
    for (const side of [g.side1, g.side2]) {
      side.forEach((p, j) => {
        const partner = genders.get(side[1 - j].id);
        if (genders.has(p.id) || !partner) return;
        const votes = partnerVotes.get(p.id) ?? { M: 0, K: 0 };
        votes[partner === "M" ? "K" : "M"]++;
        partnerVotes.set(p.id, votes);
      });
    }
  }
  for (const [id, votes] of partnerVotes) if (votes.M !== votes.K) inferred.set(id, votes.M > votes.K ? "M" : "K");
  for (const pool of ["women", "womensDoubles"]) {
    for (const id of players[pool].keys()) if (!genders.has(id) && !inferred.has(id)) inferred.set(id, "K");
  }
  const genderOf = (id) => genders.get(id) ?? inferred.get(id) ?? null;
  // Fields only used while rating
  const INTERNAL = new Set(["weekly", "log", "clubs", "nextWeek", "penalizedUntil", "returning", "returnInfo", "rdDay", "tournamentClub", "tournamentDay", "leagueClub"]);

  // Rankings only include players active within RANKING_ACTIVE_DAYS; others get rank null.
  const activeSince = addDays(today, -R.RANKING_ACTIVE_DAYS);
  for (const [pool, map] of Object.entries(players)) {
    const list = [...map.values()].sort((a, b) => b.rating - a.rating);
    // Mixed doubles ranks men and women separately: every side has one of each, so results
    // can't tell how men's ratings compare to women's. Players of unknown gender get no rank there.
    const separate = pool === "mixedDoubles";
    const ranks = {};
    ratings[pool] = list.map((player) => {
      const p = Object.fromEntries(Object.entries(player).filter(([key]) => !INTERNAL.has(key)));
      const active = p.lastPlayed >= activeSince;
      const gender = genderOf(p.id);
      const rankGroup = separate ? gender : "all";
      const rank = active && rankGroup ? (ranks[rankGroup] = (ranks[rankGroup] ?? 0) + 1) : null;
      // gender: "M" or "K" (kvinne) from badmintonportalen's player register, or inferred
      // (genderInferred) for players not in it; null if unknown.
      // plusMinus: 95% range, rating ± 2·RD
      return {
        rank, ...p, club: clubOf(player), gender, genderInferred: inferred.has(p.id), active,
        rating: round(p.rating), rd: Math.round(p.rd), plusMinus: Math.round(2 * p.rd), peak: round(p.peak),
      };
    });
    // clubs: [week index, club] from the week the player started playing for that club
    weekly[pool] = Object.fromEntries(list.map((p) => [p.id, { from: p.firstWeek, ratings: p.weekly, clubs: p.clubs }]));
  }

  // Strongest clubs: average rating of each club's best ranked players (CLUB_TOP).
  const clubs = {};
  for (const [pool, list] of Object.entries(ratings)) {
    const byClub = Map.groupBy(list.filter((p) => p.rank !== null && p.club), (p) => p.club); // list is best first
    const top = CLUB_TOP[pool];
    // The players counted, or false if the club has too few
    const pick = (members) =>
      typeof top === "number"
        ? members.length >= top && members.slice(0, top)
        : Object.entries(top).every(([g, n]) => members.filter((p) => p.gender === g).length >= n) &&
          Object.entries(top).flatMap(([g, n]) => members.filter((p) => p.gender === g).slice(0, n));
    clubs[pool] = [...byClub]
      .filter(([, members]) => pick(members))
      .map(([club, members]) => {
        const counted = pick(members);
        return {
          club,
          strength: round(counted.reduce((sum, p) => sum + p.rating, 0) / counted.length),
          players: members.length,
          top: counted.map(({ id, name, rating, gender }) => ({ id, name, rating, gender })),
        };
      })
      .sort((a, b) => b.strength - a.strength)
      .map((c, i) => ({ rank: i + 1, ...c }));
  }
  // Combined, for clubs listed in all five pools: the average of a club's standard score in each pool
  // (its strength minus the mean of those clubs, divided by their standard deviation). Ratings in
  // different pools are separate scales with different spreads, so each pool counts equally this way.
  const poolNames = Object.keys(clubs);
  const byPool = Object.fromEntries(poolNames.map((pool) => [pool, new Map(clubs[pool].map((c) => [c.club, c]))]));
  const listed = clubs.men.filter((m) => poolNames.every((pool) => byPool[pool].has(m.club))).map((m) => m.club);
  const zScore = Object.fromEntries(
    poolNames.map((pool) => {
      const values = listed.map((club) => byPool[pool].get(club).strength);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      return [pool, (strength) => (strength - mean) / sd];
    })
  );
  clubs.combined = clubs.men
    .filter((m) => listed.includes(m.club))
    .map((m) => {
      const entries = poolNames.map((pool) => [pool, byPool[pool].get(m.club)]);
      // Ranked players across the pools, each counted once
      const ids = new Set(poolNames.flatMap((pool) => ratings[pool].filter((p) => p.rank !== null && p.club === m.club).map((p) => p.id)));
      return {
        club: m.club,
        score: Math.round((100 * entries.reduce((sum, [pool, c]) => sum + zScore[pool](c.strength), 0)) / entries.length) / 100,
        players: ids.size,
        pools: Object.fromEntries(entries.map(([pool, c]) => [pool, { rank: c.rank, strength: c.strength, players: c.players }])),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ rank: i + 1, ...c }));

  writeFileSync(`${DIR}data/ratings.json`, JSON.stringify({ generatedAt: new Date().toISOString(), pools: ratings, clubs, clubTop: CLUB_TOP }, null, 1));
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

  function rivals(p, pool) {
    // In doubles every opposing player counts as an opponent.
    const meetings = p.log.filter((m) => m.margin !== null).flatMap((m) => m.opponents.map((o) => ({ ...m, opponent: o })));
    const byOpponent = Map.groupBy(meetings, (m) => m.opponent.id);
    return [...byOpponent.values()]
      .filter((list) => list.length >= RIVAL_MIN_MATCHES)
      .map((list) => {
        const sum = list.reduce((total, m) => total + m.margin, 0);
        const opponent = pool.get(list[0].opponent.id);
        return {
          opponent: { id: opponent.id, name: opponent.name, rating: Math.round(opponent.rating) },
          matches: list.length,
          wins: list.filter((m) => m.result === 1).length,
          draws: list.filter((m) => m.result === 0.5).length,
          losses: list.filter((m) => m.result === 0).length,
          margin: Math.round((1000 * sum) / list.length) / 1000,
          lastPlayed: list.at(-1).day,
          score: (sum + TYPICAL_MARGIN * RIVAL_PRIOR_MATCHES) / (list.length + RIVAL_PRIOR_MATCHES),
        };
      })
      .sort((a, b) => a.score - b.score || b.matches - a.matches)
      .slice(0, RIVALS)
      .map(({ score: _, ...r }) => r);
  }

  // Last matches (newest first) and biggest wins and losses: wins with the lowest win chance,
  // losses with the highest.
  const matches = new Map();
  for (const [pool, map] of Object.entries(players)) {
    for (const p of map.values()) {
      const strip = (list) => list.map(({ settled: _, margin: __, ...m }) => m);
      const biggest = (result, sign) =>
        strip(p.log.filter((m) => m.settled && m.result === result).sort((x, y) => sign * (x.winChance - y.winChance) || y.day.localeCompare(x.day)).slice(0, BIGGEST_MATCHES));
      matches.set(p.id, {
        ...matches.get(p.id),
        [pool]: {
          recent: strip(p.log.slice(-RECENT_MATCHES).reverse()),
          biggestWins: biggest(1, 1),
          biggestLosses: biggest(0, -1),
          rivals: rivals(p, map),
        },
      });
    }
  }
  mkdirSync(`${DIR}data/matches`, { recursive: true });
  for (const [id, m] of matches) writeFileSync(`${DIR}data/matches/${id}.json`, JSON.stringify(m));

  const perPool = [...Map.groupBy(games, (g) => g.pool)].map(([pool, list]) => `${list.length} ${pool}`);
  console.log(`Rated ${games.length} games (${games[0]?.day} to ${games.at(-1)?.day}): ${perPool.join(", ")}.`);
  console.log(`Skipped: ${skipped.walkover} walkovers, ${skipped.bye} byes, ${skipped.unplayed} unplayed, ${skipped.noPlayer} with a side not fully identified.`);
  console.log(`Draws: ${games.filter((g) => g.s === 0.5).length}, cross-region games: ${games.filter((g) => g.crossRegion).length}`);
  console.log(`Calibration (from ${CALIBRATION_FROM}, all players ${CALIBRATION_MIN_MATCHES}+ matches; coin flip log loss 0.6931):`);
  for (const [pool, c] of Object.entries(calibration)) {
    console.log(
      `  ${pool.padEnd(14)} favourite won ${((100 * c.correct) / c.n).toFixed(1)}% of ${c.n} games, log loss ${(c.logLoss / c.n).toFixed(4)}`
    );
  }
  console.log(
    `Returning players (first ${RETURN_MATCHES} matches after ${RETURN_GAP_DAYS}+ days away): ` +
      `${returns.n} games, scored ${(returns.surprise / returns.n).toFixed(3)} vs expected`
  );
  for (const [pool, list] of Object.entries(ratings)) {
    const active = list.filter((p) => p.active);
    console.log(`\n${pool}: ${list.length} players, ${active.length} ranked (active in the last ${R.RANKING_ACTIVE_DAYS} days). Top ${pool === "mixedDoubles" ? "8 men and 8 women" : 15}:`);
    const top = pool === "mixedDoubles" ? ["M", "K"].flatMap((g) => active.filter((p) => p.gender === g).slice(0, 8)) : active.slice(0, 15);
    top.forEach((p) => console.log(`${String(p.rank).padStart(3)}. ${String(Math.round(p.rating)).padStart(5)} ±${String(p.plusMinus).padEnd(4)} ${p.name} (${p.club}), ${p.matches} matches`));
    console.log(`Strongest clubs (average of the ${clubTopLabel(CLUB_TOP[pool])}):`);
    clubs[pool]
      .slice(0, 10)
      .forEach((c) => console.log(`${String(c.rank).padStart(3)}. ${String(Math.round(c.strength)).padStart(5)} ${c.club} (${c.players} ranked)`));
  }
  console.log(`\nStrongest clubs combined (average standard score over all five pools), ${clubs.combined.length} clubs:`);
  clubs.combined
    .slice(0, 10)
    .forEach((c) =>
      console.log(`${String(c.rank).padStart(3)}. ${c.score.toFixed(2).padStart(5)} ${c.club} (${Object.entries(c.pools).map(([pool, p]) => `${pool} ${Math.round(p.strength)}`).join(", ")})`)
    );
}
