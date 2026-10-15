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
// Club strength per pool: a weighted average of the club's best ranked players (singles) or pairs
// (doubles), the best counting most. `slots`: players or pairs counted; `pairs`: "doubles" pairs the
// 1st and 2nd best players, the 3rd and 4th, ...; "mixed" pairs the k-th best man with the k-th
// best woman. A pair counts at the average of its two players. Weights fall linearly (4-3-2-1).
const CLUB_STRENGTH = {
  men: { slots: 4 },
  women: { slots: 4 },
  mensDoubles: { slots: 3, pairs: "doubles" },
  womensDoubles: { slots: 3, pairs: "doubles" },
  mixedDoubles: { slots: 4, pairs: "mixed" },
};
const slotWeights = (slots) => Array.from({ length: slots }, (_, i) => (slots - i) / ((slots * (slots + 1)) / 2));
const clubStrengthLabel = ({ slots, pairs }) =>
  `${pairs ? `best ${slots} pairs` : `best ${slots} players`}, weighted ${slotWeights(slots).map((w) => Math.round(w * 100) + "%").join("/")}`;

// A club's strength in a pool from its ranked members (best first; { rating, gender }). Places the
// club can't fill count at `replacement`: the lowest rating among ranked players in the pool
// (in mixed doubles { M, K }), so a club with fewer players ranks lower but is still listed, and an
// extra real player never makes a club weaker. Returns the strength and the slots filled (each a
// list of members), or null without any members.
function clubStrength(pool, members, replacement) {
  if (!members.length) return null;
  const { slots, pairs } = CLUB_STRENGTH[pool];
  const weights = slotWeights(slots);
  const filled = [];
  let strength = 0;
  for (let i = 0; i < slots; i++) {
    let slot;
    if (!pairs) slot = [members[i]];
    else if (pairs === "doubles") slot = [members[2 * i], members[2 * i + 1]];
    else slot = [members.filter((m) => m.gender === "M")[i], members.filter((m) => m.gender === "K")[i]];
    const fallback = (j) => (pairs === "mixed" ? replacement[j === 0 ? "M" : "K"] : replacement);
    const value = slot.reduce((sum, m, j) => sum + (m ? m.rating : fallback(j)), 0) / slot.length;
    strength += weights[i] * value;
    if (slot.some(Boolean)) filled.push(slot.filter(Boolean));
  }
  return { strength, filled };
}
// The lowest rating among ranked players ({ rating, gender }), per gender in mixed doubles
function replacementRating(pool, ranked) {
  const lowest = (list) => Math.min(...list.map((p) => p.rating), Infinity);
  if (pool !== "mixedDoubles") return lowest(ranked);
  return { M: lowest(ranked.filter((p) => p.gender === "M")), K: lowest(ranked.filter((p) => p.gender === "K")) };
}

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

export const skipped = { walkover: 0, bye: 0, unplayed: 0, noPlayer: 0, removed: 0 };

// A match's key: its tournament (T<id>) or league tie (L<id>) and the player ids of both sides,
// e.g. "T7143 47570 vs 24320" or "L13068 17534+43350 vs 23978+42948". When the same sides meet
// again in a tournament (a group match and a final), later meetings get ".2", ".3", ... in playing
// order: "T588.2 26596 vs 24788". Shown on player pages and used in corrections.txt.
const sideIds = (side) => side.map((p) => p.id).join("+");
export const matchKey = (source, side1, side2) => `${source} ${sideIds(side1)} vs ${sideIds(side2)}`;
// Order-independent form, to find a match whichever order its sides are written in
const canonical = (source, ids1, ids2) => `${source} ${[ids1, ids2].map((ids) => ids.split("+").sort().join("+")).sort().join(" vs ")}`;

// Manual corrections of results that are wrong on badmintonportalen (corrections.txt):
//   <key>  walkover | remove | score <sets> | winner <1|2>   # note
// `score` and `winner` follow the side order written in the line.
function readCorrections() {
  const corrections = new Map();
  const text = (() => {
    try {
      return readFileSync(`${DIR}corrections.txt`, "utf8");
    } catch {
      return "";
    }
  })();
  text.split("\n").forEach((raw, i) => {
    const line = raw.split("#")[0].trim();
    if (!line) return;
    const m = line.match(/^([TL]\d+(?:\.\d+)?)\s+([\d+]+)\s+vs\s+([\d+]+)\s+(walkover|remove|score\s+\S+|winner\s+[12])$/i);
    if (!m) return console.warn(`corrections.txt line ${i + 1}: can't read "${raw.trim()}"`);
    const [, source, ids1, ids2, action] = m;
    corrections.set(canonical(source, ids1, ids2), { line: i + 1, text: raw.trim(), ids1, action: action.toLowerCase().split(/\s+/), used: false });
  });
  return corrections;
}
let corrections = new Map();

// Applies a correction to a match: returns the corrected match, or null to drop it.
function correct(m, source) {
  const c = corrections.get(canonical(source, sideIds(m.side1), sideIds(m.side2)));
  if (!c) return m;
  c.used = true;
  const [action, value] = c.action;
  // Does the line list the match's side 1 first?
  const sameOrder = c.ids1.split("+").sort().join("+") === m.side1.map((p) => p.id).sort().join("+");
  if (action === "remove") return null;
  if (action === "walkover") return { ...m, walkover: true };
  if (action === "winner") return { ...m, winner: sameOrder === (value === "1") ? 1 : 2 };
  // score: sets as written in the line, turned to the match's side order; the winner follows
  const sets = R.parseSets(value).map(([a, b]) => (sameOrder ? [a, b] : [b, a]));
  const won1 = sets.filter(([a, b]) => a > b).length;
  const won2 = sets.filter(([a, b]) => b > a).length;
  return { ...m, score: sets.map((x) => x.join("/")).join(","), walkover: false, winner: won1 > won2 ? 1 : won2 > won1 ? 2 : null };
}

// Scores to review: impossible for the season's set formats, or extreme blowouts (at most 1 point
// per set for the loser), which are sometimes no-shows entered as a score.
const suspicious = [];
const checked = new Map(); // matches checked per tournament or tie
const meetings = new Map(); // times the same sides have met in a tournament or tie so far
function checkScore(m, meta) {
  if (m.walkover || !m.score || !m.side1.length || !m.side2.length) return;
  const sets = R.parseSets(m.score);
  if (!sets.length || R.isWalkover(m, sets, meta.day)) return;
  checked.set(meta.source, (checked.get(meta.source) ?? 0) + 1);
  const reason = !R.scoreFitsSeason(sets, meta.day)
    ? "impossible for the season's set format"
    : sets.every(([a, b]) => Math.min(a, b) <= 1)
      ? "extreme blowout"
      : null;
  if (reason) {
    suspicious.push({
      day: meta.day, key: matchKey(meta.keySource ?? meta.source, m.side1, m.side2), sets, reason, event: meta.event, discipline: m.discipline,
      sides: [m.side1, m.side2].map((side) => side.map((p) => p.name).join(" + ")),
    });
  }
}

// The review list as text: grouped by season (newest first) and reason, every entry a commented
// description followed by a line that can be copied into corrections.txt as it is.
const DISCIPLINE_NAMES = { MensSingles: "Men's singles", WomensSingles: "Women's singles", MensDoubles: "Men's doubles", WomensDoubles: "Women's doubles", MixedDoubles: "Mixed doubles" };
const REASONS = [
  ["impossible for the season's set format", (season) => `Impossible for the set format (sets to ${season >= 2026 ? "15, cap 21" : "21, cap 30"}, or 11 in some junior classes)`],
  ["extreme blowout", () => "Extreme blowouts (the loser scored at most 1 point per set)"],
];
function suspiciousReport(review) {
  const seasonOf = (day) => (+day.slice(5, 7) >= 7 ? +day.slice(0, 4) : +day.slice(0, 4) - 1);
  const keyWidth = Math.max(...review.map((r) => r.key.length));
  const lines = [
    "# Scores that may be wrong on badmintonportalen, written by rate.mjs. Don't edit this file: it is",
    "# rewritten on every run.",
    "#",
    "# To fix a match, copy its line (the one without #) into corrections.txt and replace",
    "# \"score ...\" with the correction: walkover, remove, score <sets> or winner <1|2>.",
    "# Scores are written from the first side's point of view. For impossible scores the line already",
    "# suggests the most likely intended score (one typo per wrong set; see suggestScore in rules.mjs).",
    "#",
    `# ${review.length} scores to check.`,
  ];
  for (const [season, inSeason] of [...Map.groupBy(review, (r) => seasonOf(r.day))].sort((a, b) => b[0] - a[0])) {
    const title = `${season}/${season + 1}: ${inSeason.length} ${inSeason.length === 1 ? "score" : "scores"}`;
    lines.push("", "", `# ${"=".repeat(96)}`, `# ${title}`, `# ${"=".repeat(96)}`);
    for (const [reason, heading] of REASONS) {
      const entries = inSeason.filter((r) => r.reason === reason);
      if (!entries.length) continue;
      lines.push("", `# --- ${heading(season)}: ${entries.length} ---`);
      for (const r of entries) {
        const score = r.sets.map((set) => set.join("-")).join(", ");
        const recorded = r.sets.map((set) => set.join("/")).join(",");
        const suggestion = reason.startsWith("impossible") ? R.suggestScore(r.sets, r.day) : null;
        const line = suggestion
          ? `score ${suggestion.map((set) => set.join("/")).join(",")}  # was ${recorded}`
          : `score ${recorded}${reason.startsWith("impossible") ? "  # no clear fix: check by hand" : ""}`;
        lines.push(
          "",
          `# ${r.day}  ${r.event} · ${DISCIPLINE_NAMES[r.discipline] ?? r.discipline}`,
          `#   ${r.sides[0]}  ${score}  ${r.sides[1]}`,
          `${r.key.padEnd(keyWidth)}  ${line}`
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}

// One rateable game: both sides complete (one player in singles, two in doubles), all with ids.
function toGame(original, meta) {
  const pool = POOLS[original.discipline];
  if (!pool) return null;
  // Number repeated meetings of the same sides in the same tournament or tie
  if (original.side1.length && original.side2.length) {
    const pair = canonical(meta.source, sideIds(original.side1), sideIds(original.side2));
    const n = (meetings.get(pair) ?? 0) + 1;
    meetings.set(pair, n);
    if (n > 1) meta = { ...meta, keySource: `${meta.source}.${n}` };
  }
  const m = correct(original, meta.keySource ?? meta.source);
  if (!m) {
    skipped.removed++;
    return null;
  }
  if (m === original) checkScore(m, meta);
  const sets = R.parseSets(m.score ?? "");
  if (R.isWalkover(m, sets, meta.day)) {
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
  return { pool, side1: m.side1, side2: m.side2, s, sets, crossRegion, key: matchKey(meta.keySource ?? meta.source, m.side1, m.side2), ...meta };
}

let regionOf;

export function collectGames() {
  regionOf = regionLookup();
  corrections = readCorrections();
  suspicious.length = 0;
  checked.clear();
  meetings.clear();
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
  for (const c of corrections.values()) {
    if (!c.used) console.warn(`corrections.txt line ${c.line}: no such match: "${c.text}"`);
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
// seedRating(pool, side, level, players), kMultiplier(game), playerMultiplier(player, game, opponents), ratingMultiplier(r), expectedScore(ra, rb),
// kappa, doublesKappa (base K-factor for doubles) and doublesSplit ("rd" or "equal": how a doubles
// side's rating change is shared between the partners).
export function computeRatings(
  games,
  inactivity = R.INACTIVITY,
  {
    weekly: keepWeekly = true,
    onGame,
    startRating = R.startRating,
    seedRating,
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

  // A new doubles player's start rating from their singles rating, if they have played singles
  // (mixed doubles: the singles discipline they have played most); otherwise null.
  const SINGLES_OF = { mensDoubles: ["men"], womensDoubles: ["women"], mixedDoubles: ["men", "women"] };
  function singlesSeed(pool, side) {
    const singles = (SINGLES_OF[pool] ?? []).map((sp) => players[sp].get(side.id)).filter(Boolean).sort((a, b) => b.matches - a.matches)[0];
    return singles ? R.P0 + R.DOUBLES_SINGLES_SEED * (singles.rating - R.P0) : null;
  }

  function getPlayer(pool, side, level, day, source) {
    let p = players[pool].get(side.id);
    if (!p) {
      // seedRating(pool, side, level, players) can override the start rating (experiments)
      const start = seedRating?.(pool, side, level, players) ?? singlesSeed(pool, side) ?? startRating(level);
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
    const junior = g.level.junior ? R.JUNIOR_K : 1;
    const k =
      (doubles ? doublesKappa : kappa) * junior *
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
        return k * share * ratingMultiplier(p.rating) * (playerMultiplier?.(p, g, side.opponents) ?? 1) * (side.s - side.e);
      });
    }
    perSide.forEach((side, i) => side.players.forEach((p, j) => ([p.rd, p.rdDay] = [rdAfter[i][j], g.day])));

    if (keepWeekly) {
      const ref = (p) => ({ id: p.id, name: p.name, rating: Math.round(p.rating) });
      for (const side of perSide) {
        side.players.forEach((p, j) => {
          p.log.push({
            day: g.day, event: g.event, key: g.key,
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
  const INTERNAL = new Set(["weekly", "log", "clubs", "nextWeek", "penalizedUntil", "returning", "returnInfo", "rdDay", "tournamentClub", "tournamentDay", "leagueClub", "ranks"]);

  // Rankings only include active players (R.isActive); others get rank null.
  for (const [pool, map] of Object.entries(players)) {
    const list = [...map.values()].sort((a, b) => b.rating - a.rating);
    // Mixed doubles ranks men and women separately: every side has one of each, so results
    // can't tell how men's ratings compare to women's. Players of unknown gender get no rank there.
    const separate = pool === "mixedDoubles";
    const ranks = {};
    ratings[pool] = list.map((player) => {
      const p = Object.fromEntries(Object.entries(player).filter(([key]) => !INTERNAL.has(key)));
      const active = R.isActive(p.lastPlayed, today);
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

  // Strongest clubs: weighted average of each club's best ranked players or pairs (CLUB_STRENGTH).
  const clubs = {};
  for (const [pool, list] of Object.entries(ratings)) {
    const ranked = list.filter((p) => p.rank !== null);
    const byClub = Map.groupBy(ranked.filter((p) => p.club), (p) => p.club); // list is best first
    const replacement = replacementRating(pool, ranked);
    clubs[pool] = [...byClub]
      .map(([club, members]) => {
        const { strength, filled } = clubStrength(pool, members, replacement);
        return {
          club,
          strength: round(strength),
          players: members.length,
          // The players or pairs counted, best first
          top: filled.map((slot) => slot.map(({ id, name, rating, gender }) => ({ id, name, rating, gender }))),
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

  // Scores to review, newest first, as lines ready to copy into corrections.txt. A tournament where
  // more than a fifth of the scores break the set formats played its own format (e.g. Sandefjord SaBK
  // Open and Vestre Aker Fjærfest 2015); its scores are left out.
  const sourceOf = (r) => r.key.split(" ")[0].split(".")[0];
  const impossible = Map.groupBy(suspicious.filter((r) => r.reason.startsWith("impossible")), sourceOf);
  const ownFormat = new Set([...impossible].filter(([source, list]) => list.length > 0.2 * checked.get(source)).map(([source]) => source));
  const review = suspicious.filter((r) => !(r.reason.startsWith("impossible") && ownFormat.has(sourceOf(r)))).sort((a, b) => b.day.localeCompare(a.day));
  writeFileSync(`${DIR}data/suspicious-scores.txt`, suspiciousReport(review));
  writeFileSync(`${DIR}data/ratings.json`, JSON.stringify({ generatedAt: new Date().toISOString(), pools: ratings, clubs, clubStrength: Object.fromEntries(Object.entries(CLUB_STRENGTH).map(([pool, c]) => [pool, { ...c, weights: slotWeights(c.slots) }])) }, null, 1));

  // Club history: each club's strength (the same CLUB_STRENGTH as the club ranking) at the end
  // of every week, from the ranked players who played for it at the time. A player counts for a
  // club in a week if they were active at its end (R.isActive, Covid-adjusted), under the club of
  // their club history for that week. Written per club (NBF club id) to data/club-history/<id>.json.
  const firstWeek = Object.values(players).flatMap((map) => [...map.values()].map((p) => p.firstWeek)).sort()[0];
  const weekCount = Math.round((toTime(weekStart(today)) - toTime(firstWeek)) / (7 * DAY_MS)) + 1;
  const weekIndexCache = new Map();
  const weekIndex = (day) => {
    let index = weekIndexCache.get(day);
    if (index === undefined) {
      index = Math.round((toTime(weekStart(day)) - toTime(firstWeek)) / (7 * DAY_MS));
      weekIndexCache.set(day, index);
    }
    return index;
  };
  // Covid-adjusted days without playing from the first week to the end of each week, so the time
  // between two weeks is a subtraction (same as R.inactiveDays)
  const activityClock = Array.from({ length: weekCount }, (_, w) => R.inactiveDays(firstWeek, addDays(firstWeek, (w + 1) * 7)));
  const clubHistory = new Map(); // club -> { pool: { strength: [], rank: [] } }
  const clubCounts = {}; // pool -> clubs with a strength per week
  const rankCounts = {}; // pool -> ranked players per week (mixed doubles: per gender)
  for (const [pool, map] of Object.entries(players)) {
    // week -> club -> [{ rating, gender }]
    const byWeek = Array.from({ length: weekCount }, () => new Map());
    // week -> every active player, for the weekly national ranks
    const activeByWeek = Array.from({ length: weekCount }, () => []);
    for (const p of map.values()) {
      const offset = weekIndex(p.firstWeek);
      const playedWeeks = [...new Set(p.log.map((m) => weekIndex(m.day)))].sort((a, b) => a - b);
      const gender = pool === "mixedDoubles" ? genderOf(p.id) : null;
      let played = 0; // index into playedWeeks of the last week played up to w
      let club = 0; // index into p.clubs
      for (let w = playedWeeks[0]; w < weekCount; w++) {
        while (playedWeeks[played + 1] <= w) played++;
        // Active: played within RANKING_ACTIVE_DAYS (Covid-adjusted) of the end of week w
        if (activityClock[w] - activityClock[playedWeeks[played]] > R.RANKING_ACTIVE_DAYS) {
          if (played === playedWeeks.length - 1) break;
          continue;
        }
        // After the last recorded week the rating stays the same within the active window.
        const rating = p.weekly[w - offset] ?? p.weekly.at(-1) ?? p.rating;
        activeByWeek[w].push({ p, rating, gender });
        while (p.clubs[club + 1]?.[0] <= w - offset) club++;
        const name = p.clubs[club]?.[1];
        if (!name) continue;
        const members = byWeek[w].get(name) ?? [];
        members.push({ rating, gender });
        byWeek[w].set(name, members);
      }
    }
    // Weekly national rank: active players by their rating at the end of the week, as the rankings
    // (mixed doubles: men and women separately). The current week is the ranking itself.
    const separate = pool === "mixedDoubles";
    rankCounts[pool] = separate ? { M: Array(weekCount).fill(0), K: Array(weekCount).fill(0) } : Array(weekCount).fill(0);
    const currentRank = new Map(ratings[pool].map((r) => [r.id, r]));
    activeByWeek.forEach((list, w) => {
      if (w === weekCount - 1) return;
      const groups = separate ? Object.entries(Object.groupBy(list.filter((x) => x.gender), (x) => x.gender)) : [[null, list]];
      for (const [gender, members] of groups) {
        members.sort((a, b) => b.rating - a.rating);
        members.forEach(({ p }, i) => ((p.ranks ??= [])[w - weekIndex(p.firstWeek)] = i + 1));
        if (gender) rankCounts[pool][gender][w] = members.length;
        else rankCounts[pool][w] = members.length;
      }
    });
    for (const p of map.values()) {
      const now = currentRank.get(p.id);
      if (now?.rank) (p.ranks ??= [])[weekCount - 1 - weekIndex(p.firstWeek)] = now.rank;
      else if (p.ranks) p.ranks.length = Math.min(p.ranks.length, weekCount - 1 - weekIndex(p.firstWeek));
      if (now?.rank) {
        if (separate) rankCounts[pool][now.gender][weekCount - 1]++;
        else rankCounts[pool][weekCount - 1]++;
      }
      // ranks[i]: rank at the end of week from + 7*i days, null while not ranked
      if (p.ranks) weekly[pool][p.id].ranks = Array.from(p.ranks, (r) => r ?? null);
    }

    clubCounts[pool] = [];
    byWeek.forEach((byClub, w) => {
      const strengths = [];
      const replacement = replacementRating(pool, activeByWeek[w]);
      for (const [name, members] of byClub) {
        members.sort((a, b) => b.rating - a.rating);
        const result = clubStrength(pool, members, replacement);
        if (result) strengths.push([name, Math.round(result.strength)]);
      }
      strengths.sort((a, b) => b[1] - a[1]);
      clubCounts[pool][w] = strengths.length;
      strengths.forEach(([name, strength], i) => {
        const history = clubHistory.get(name) ?? {};
        history[pool] ??= { strength: Array(weekCount).fill(null), rank: Array(weekCount).fill(null) };
        history[pool].strength[w] = strength;
        history[pool].rank[w] = i + 1;
        clubHistory.set(name, history);
      });
    });
  }
  // The current week is the club ranking itself, so the history ends on the strength and rank shown
  // with it. That ranking uses each player's registered club, so a recent club change shows up as
  // a step in the last week.
  const now = weekCount - 1;
  for (const [pool, ranked] of Object.entries(clubs)) {
    if (pool === "combined") continue;
    for (const history of clubHistory.values()) {
      if (history[pool]) history[pool].strength[now] = history[pool].rank[now] = null;
    }
    clubCounts[pool][now] = ranked.length;
    for (const c of ranked) {
      const history = clubHistory.get(c.club) ?? {};
      history[pool] ??= { strength: Array(weekCount).fill(null), rank: Array(weekCount).fill(null) };
      history[pool].strength[now] = Math.round(c.strength);
      history[pool].rank[now] = c.rank;
      clubHistory.set(c.club, history);
    }
  }

  // Combined history: per week, the same average standard score as the combined ranking, among
  // the clubs with a strength in all five pools that week. The current week is that ranking itself.
  clubCounts.combined = [];
  const histories = [...clubHistory.entries()];
  for (let w = 0; w < weekCount; w++) {
    const listed = histories.filter(([, h]) => poolNames.every((pool) => h[pool]?.strength[w] != null));
    clubCounts.combined[w] = listed.length;
    if (listed.length < 2) continue;
    const scores = new Map(listed.map(([name]) => [name, 0]));
    for (const pool of poolNames) {
      const values = listed.map(([, h]) => h[pool].strength[w]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
      for (const [name, h] of listed) scores.set(name, scores.get(name) + (h[pool].strength[w] - mean) / sd / poolNames.length);
    }
    [...scores].sort((a, b) => b[1] - a[1]).forEach(([name, score], i) => {
      const history = clubHistory.get(name);
      history.combined ??= { strength: Array(weekCount).fill(null), rank: Array(weekCount).fill(null) };
      history.combined.strength[w] = Math.round(score * 100) / 100;
      history.combined.rank[w] = i + 1;
    });
  }
  for (const history of clubHistory.values()) {
    if (history.combined) history.combined.strength[now] = history.combined.rank[now] = null;
  }
  clubCounts.combined[now] = clubs.combined.length;
  for (const c of clubs.combined) {
    const history = clubHistory.get(c.club);
    history.combined ??= { strength: Array(weekCount).fill(null), rank: Array(weekCount).fill(null) };
    history.combined.strength[now] = c.score;
    history.combined.rank[now] = c.rank;
  }

  // Per club file, keyed by NBF club id (clubs no longer in the club list have no club page).
  // Each pool keeps only the weeks from its first to its last value: `from` is that first week's
  // Monday; strength[i], rank[i] and clubs[i] (clubs ranked that week) are for week from + 7*i days.
  // `combined` is the combined score (average standard score) instead of a strength.
  mkdirSync(`${DIR}data/club-history`, { recursive: true });
  for (const c of JSON.parse(readFileSync(`${DIR}data/clubs.json`, "utf8"))) {
    const history = clubHistory.get(c.name);
    if (!history) continue;
    const pools = {};
    for (const [pool, { strength, rank }] of Object.entries(history)) {
      const first = strength.findIndex((x) => x !== null);
      const last = strength.findLastIndex((x) => x !== null);
      // seasons: strength, rank and number of clubs at the last week of each season with a value,
      // for the tables on the club page
      const seasons = new Map();
      for (let w = first; w <= last; w++) {
        if (strength[w] === null) continue;
        const day = addDays(firstWeek, w * 7 + 6);
        const season = +day.slice(5, 7) >= 7 ? +day.slice(0, 4) : +day.slice(0, 4) - 1;
        seasons.set(season, { season, strength: strength[w], rank: rank[w], clubs: clubCounts[pool][w] });
      }
      pools[pool] = {
        from: addDays(firstWeek, first * 7),
        strength: strength.slice(first, last + 1),
        rank: rank.slice(first, last + 1),
        clubs: clubCounts[pool].slice(first, last + 1),
        seasons: [...seasons.values()],
      };
    }
    writeFileSync(`${DIR}data/club-history/${c.id}.json`, JSON.stringify({ club: c.name, pools }));
  }

  // Per player: `from` is the Monday of their first week; ratings[i] is the rating at the end
  // of week from + 7*i days, ranks[i] the national rank then (null while not ranked).
  writeFileSync(`${DIR}data/ratings-weekly.json`, JSON.stringify({ generatedAt: new Date().toISOString(), weekStartsOn: "Monday", pools: weekly }));
  // The same weekly history split per player ({ men: {from, ratings, ranks, clubs}, women: ... }),
  // so the website can load one player's history without reading the whole file.
  // Each history also gets `seasons`: rating, club, rank and number of ranked players at the end of
  // each season (July to June), for the tables on the player page.
  const seasonOf = (day) => (+day.slice(5, 7) >= 7 ? +day.slice(0, 4) : +day.slice(0, 4) - 1);
  function seasonTable(pool, id, history) {
    const offset = weekIndex(history.from);
    const counts = pool === "mixedDoubles" ? rankCounts[pool][genderOf(+id)] ?? [] : rankCounts[pool];
    const length = Math.max(history.ratings.length, history.ranks?.length ?? 0);
    const seasons = new Map();
    let club = 0;
    for (let i = 0; i < length; i++) {
      while (history.clubs[club + 1]?.[0] <= i) club++;
      const season = seasonOf(addDays(history.from, i * 7 + 6));
      const rank = history.ranks?.[i] ?? null;
      seasons.set(season, {
        season,
        rating: history.ratings[i] ?? history.ratings.at(-1),
        club: history.clubs[club]?.[1] ?? null,
        rank,
        ranked: rank ? counts[offset + i] ?? null : null,
      });
    }
    return [...seasons.values()];
  }
  const byPlayer = new Map();
  for (const [pool, series] of Object.entries(weekly)) {
    for (const [id, history] of Object.entries(series)) {
      byPlayer.set(id, { ...byPlayer.get(id), [pool]: { ...history, seasons: seasonTable(pool, id, history) } });
    }
  }
  mkdirSync(`${DIR}data/history`, { recursive: true });
  for (const [id, history] of byPlayer) writeFileSync(`${DIR}data/history/${id}.json`, JSON.stringify(history));
  // Number of ranked players per week (mixed doubles: { M, K }), from the Monday `from`
  writeFileSync(`${DIR}data/rank-counts.json`, JSON.stringify({ from: firstWeek, pools: rankCounts }));

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

  // All matches (newest first; the player page shows the last few and can show all), biggest wins
  // and losses (wins with the lowest win chance, losses with the highest) and the matches that
  // changed the rating most up and down.
  const matches = new Map();
  for (const [pool, map] of Object.entries(players)) {
    for (const p of map.values()) {
      const strip = (list) => list.map(({ settled: _, margin: __, ...m }) => m);
      const biggest = (result, sign) =>
        strip(p.log.filter((m) => m.settled && m.result === result).sort((x, y) => sign * (x.winChance - y.winChance) || y.day.localeCompare(x.day)).slice(0, BIGGEST_MATCHES));
      matches.set(p.id, {
        ...matches.get(p.id),
        [pool]: {
          all: strip(p.log.slice().reverse()),
          biggestWins: biggest(1, 1),
          biggestLosses: biggest(0, -1),
          biggestGains: strip([...p.log].sort((x, y) => y.change - x.change || y.day.localeCompare(x.day)).filter((m) => m.change > 0).slice(0, BIGGEST_MATCHES)),
          biggestDrops: strip([...p.log].sort((x, y) => x.change - y.change || y.day.localeCompare(x.day)).filter((m) => m.change < 0).slice(0, BIGGEST_MATCHES)),
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
  const applied = [...corrections.values()].filter((c) => c.used).length;
  console.log(`Corrections: ${applied} of ${corrections.size} in corrections.txt applied (${skipped.removed} matches removed). ${review.length} scores to review in data/suspicious-scores.txt.`);
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
    console.log(`Strongest clubs (${clubStrengthLabel(CLUB_STRENGTH[pool])}):`);
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
