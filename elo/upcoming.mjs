// Tournament draws: each event's draw from Cup2000, the players identified from the entry list on
// badmintonportalen ("deltakerliste"), how lucky each player's draw is by their ratings and, once
// the tournament is played, how the predictions turned out.
// Usage: node upcoming.mjs                    upcoming tournaments with a published draw (found
//                                             from the season plan: registration closed in the
//                                             last 30 days, not over yet)
//        node upcoming.mjs --season 2026      every tournament of the 2026/27 season whose
//                                             registration has closed, played ones too (finished
//                                             ones already fetched after they ended are kept)
//        node upcoming.mjs --portalen 7076    one tournament by its badmintonportalen id
//        node upcoming.mjs --cup2000 11094    one tournament by its Cup2000 id (the badmintonportalen
//                                             tournament is found by its link to the draw)
//        node upcoming.mjs --portalen 7111 --cup2000 11120   both, for a tournament whose page on
//                                             badmintonportalen doesn't link to its draw
//        node upcoming.mjs --offline          recalculate every saved tournament from its saved draw
//                                             and entry list (after rate.mjs), without fetching
//        --refetch                            fetch finished tournaments again
// Run after rate.mjs. Writes data/upcoming/<cup2000 id>.json and the list data/upcoming.json; the
// fetched Cup2000 pages and entry list are kept in data/upcoming/raw/<cup2000 id>.json.
//
// Ratings are from the end of the week before the tournament (weekly histories), so a played
// tournament is predicted as it would have been beforehand.
// Draw luck: each event is simulated (draw-sim.mjs) with the actual draw and with random redraws
// of the same entries (seeds kept in place). An entry's luck is its expected rounds (or, in events
// that place everyone, as the X classes, its expected placement) in the actual draw against the
// average over redraws. Events with a single group have no luck (everyone plays everyone).
// Played draws: Cup2000 then lists the players who came through instead of "Vinner av Pulje 3",
// and draw positions instead of "Winner of match 12"; the structure is rebuilt from where each
// player finished in their group and which match each position played before. Replaying the
// actual winners gives each entry's actual rounds, placement and win.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { call, text } from "./portalen.mjs";
import { service, unescape, parsePlayer } from "./fetch-tournament.mjs";
import { maxRounds, seedCount, simulate } from "./draw-sim.mjs";
import * as R from "./rules.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const OUT = `${DIR}data/upcoming`;
const RUNS = 20000;
const today = new Date().toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// Cup2000 event codes (e=) and the matching pool and badmintonportalen discipline heading
const EVENTS = {
  0: { pool: "men", discipline: "MensSingles", heading: "Herresingle" },
  1: { pool: "mensDoubles", discipline: "MensDoubles", heading: "Herredouble" },
  2: { pool: "women", discipline: "WomensSingles", heading: "Damesingle" },
  3: { pool: "womensDoubles", discipline: "WomensDoubles", heading: "Damedouble" },
  4: { pool: "mixedDoubles", discipline: "MixedDoubles", heading: "Mixeddouble" },
};
const HEADING = Object.fromEntries(Object.values(EVENTS).map((e) => [e.discipline, e.heading]));
const SINGLES = new Set(["men", "women"]);

const normalize = (s) =>
  s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

// ---- badmintonportalen: season plan, tournament info and entry list ----

const seasonId = (day) => `200${+day.slice(5, 7) >= 7 ? day.slice(0, 4) : +day.slice(0, 4) - 1}`;

async function seasonPlan(season) {
  const { html } = await call("GetSeasonPlan", {
    seasonid: season, regionids: null, agegroupids: null, classids: null, strfrom: "", strto: "", strweekno: "", strweekno2: "",
    georegionids: null, clubid: "", disciplines: null, playerid: "", birthdate: "", age: "", points: "", gender: "",
    publicseasonplan: true, showleague: false, selectclientfunction: "SelectTournamentClass1", page: 0,
  });
  return [...html.matchAll(/SelectTournamentClass1\((\d+), (\d+)\);[^]*?<td class='title'>(.*?)<\/td><td class='lastregistration'>(.*?)<\/td>/g)].map(
    ([, tournamentId, classId, title, deadline]) => ({ tournamentId: +tournamentId, classId, title: text(title), deadline: text(deadline).split(".").reverse().join("-") })
  );
}

// Entry list of every class (a negative class id asks for the whole tournament): per class and
// discipline the entries, each [{ id, name, club }] (an unknown partner, "X-makker", is left out).
// Also the tournament info: name, dates and the Cup2000 id from its link to the draw.
async function entryList(classId) {
  const res = await call("SearchRegistrationsByClass", { tournamentclassid: `-${classId}`, clientselectfunction: "SelectTournamentClass1" });
  const info = res.ClassInfo ?? "";
  const dates = (info.match(/Dato:.*?<\/tr>/s)?.[0].match(/\d{2}\.\d{2}\.\d{4}/g) ?? []).map((d) => d.split(".").reverse().join("-"));
  const entries = [];
  let className = "";
  for (const [, tag, body] of (res.Html ?? "").matchAll(/<(h2|h3)>(.*?)<\/\1>|<tr(?: class='alt')?><td>(.*?)<\/td>/gs).map((m) => [m[0], m[1] ?? "tr", m[2] ?? m[3]])) {
    if (tag === "h2") className = text(body);
    else if (tag === "h3") entries.push({ className, heading: text(body), entries: [] });
    else if (entries.length && /VisSpiller/.test(body)) {
      entries.at(-1).entries.push(
        body.split(/<br\s*\/?>/).filter((p) => /VisSpiller/.test(p)).map((p) => ({
          id: +p.match(/VisSpiller\/#(\d+)/)[1],
          name: text(p.match(/<a[^>]*>(.*?)<\/a>/)[1]),
          club: text(p.replace(/^[^<]*<a[^>]*>.*?<\/a>/, "").replace(/^\s*,/, "")),
        }))
      );
    }
  }
  return {
    name: text(info.match(/<h2>(.*?)<\/h2>/s)?.[1] ?? "").replace(/^\d{2}\.\d{2}\.\d{4}\s*/, ""),
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
    cup2000Id: +(info.match(/cup2000\.\w+\/[^'"]*tournamentid=(\d+)/i)?.[1] ?? 0) || null,
    lists: entries,
  };
}

// ---- Cup2000: the draw of each event ----

// "Vinner av Pulje 3" → { group 3, rank 1 }; "Nr. 2 fra Pulje 3", "2. plass i pulje 3" → rank 2;
// "Nr. 2 fra Pulje X" → the best runner-up of all groups ({ bestOfRank: 2 })
function placeholder(name) {
  const m = name.match(/^(?:(vinner)|nr\.?\s*(\d+)|(\d+)\.\s*(?:plass)?)\s*(?:av|i|fra)?\s*pulje\s*(\d+|x)\s*$/i);
  if (!m) return null;
  const rank = m[1] ? 1 : +(m[2] ?? m[3]);
  return /x/i.test(m[4]) ? { bestOfRank: rank } : { group: +m[4], rank };
}
const groupNumber = (title) => +(title.match(/(?:group|pulje)\s*(\d+)\s*$/i)?.[1] ?? 0);
// A stage deciding places: "Herresingle U15 X 5-6 plassen" → [5, 6]; "Sluttspill 5.plass" (a
// match for 5th) → [5, 6]
const stagePlaces = (title) => {
  const range = title.match(/(\d+)\s*[-–]\s*(\d+)\.?\s*plass/i);
  if (range) return [+range[1], +range[2]];
  const one = title.match(/(\d+)\.?\s*plass/i);
  return one ? [+one[1], +one[1] + 1] : null;
};

// The service pages of one event (class c, event code e): its groups and knockout stages
async function fetchEventPages(id, c, e) {
  const top = await service(id, { c, e });
  if (top.renderMethod !== 2) return [{ ...top, stage: 0, stageTitle: unescape(top.data[0]) }];
  const pages = [];
  for (const [p, groups, title] of top.data) {
    if (groups > 0) for (let g = 1; g <= groups; g++) pages.push({ ...(await service(id, { c, e, p, g })), stage: p, stageTitle: unescape(title) });
    else pages.push({ ...(await service(id, { c, e, p })), stage: p, stageTitle: unescape(title) });
  }
  return pages;
}

// One event as a draw-sim event, with its entries' names and, once played, its results: the
// winner of each match (1 or 2, keyed by match number) and each group's final order. Null if there
// is no draw yet (no entries).
function parseEvent(pages) {
  const entries = []; // { names: ["Name, Club", ...] }
  const slotOf = new Map(); // names key -> slot
  const slot = (names) => {
    const key = names.join(" + ");
    if (!slotOf.has(key)) {
      slotOf.set(key, entries.length);
      entries.push({ names });
    }
    return slotOf.get(key);
  };
  const groups = [];
  const stages = new Map();
  const winners = {}; // match no -> 1 | 2 (0: not played)
  const walkovers = new Set();
  const groupOrder = []; // group index -> slots in final order, once played
  const withdrawals = new Map(); // slot -> number of the first match it lost by walkover
  const placing = new Map(); // slot -> { group number, rank } once the group is played
  const unknownPlaceholders = new Set();
  // A match's result; `sides` (slots of side 1 and 2, if known) to note who lost by walkover
  const record = (m, sides = []) => {
    winners[String(m[0])] = m[5] === 1 || m[5] === 2 ? m[5] : 0;
    if (/w\.?\s*o/i.test(m[3] ?? "") && (m[5] === 1 || m[5] === 2)) {
      walkovers.add(String(m[0]));
      const loser = sides[m[5] === 1 ? 1 : 0];
      if (loser !== undefined && !(withdrawals.get(loser) <= +m[0])) withdrawals.set(loser, +m[0]);
    }
  };

  for (const page of pages.filter((p) => p.renderMethod === 3)) {
    // [title, standings rows [index, ?, ?, ?, place, names, ...], [matches, venues]]
    const data = page.data;
    const rows = data[1].filter((row) => row[5]?.length);
    const byIndex = new Map(rows.map((row) => [row[0], slot(row[5].map(unescape))]));
    const number = groupNumber(unescape(data[0])) || groups.length + 1;
    const matches = data[2][0].filter((m) => byIndex.has(m[8]) && byIndex.has(m[9]));
    matches.forEach((m) => record(m, [byIndex.get(m[8]), byIndex.get(m[9])]));
    groups.push({ name: unescape(data[0]), number, slots: [...byIndex.values()], matches: matches.map((m) => [byIndex.get(m[8]), byIndex.get(m[9]), String(m[0])]) });
    // Played: each row's place ("1", "2", ...); a row without one (a player who withdrew) comes
    // after the ranked ones
    const ranked = rows.filter((row) => +row[4] > 0).length;
    let unranked = ranked;
    const places = rows.map((row) => [byIndex.get(row[0]), +row[4] > 0 ? +row[4] : ++unranked]);
    if (ranked > 0 && ranked >= rows.length - 2) {
      groupOrder[groups.length - 1] = places.sort((a, b) => a[1] - b[1]).map(([s]) => s);
      for (const [s, p] of places) placing.set(s, { group: number, rank: p });
    }
  }

  for (const page of pages.filter((p) => p.renderMethod === 4)) {
    // [title, players [[position, empty, place, names]], rounds [[size, [matches, venues]]]]
    const data = page.data;
    const byPosition = new Map();
    const slotAt = new Map(); // position -> slot (in a played draw)
    for (const [position, empty, , names] of data[1]) {
      const list = (names ?? []).map(unescape);
      if (!list.length) continue;
      // A group place left empty (its player withdrew) is still that place in the draw
      const ph = list.length === 1 ? placeholder(list[0]) : null;
      if (ph) byPosition.set(position, ph);
      else if (empty) continue;
      else if (/vinner|pulje|winner/i.test(list[0])) unknownPlaceholders.add(list[0]);
      else {
        // A played draw lists the player who came through a group: their group place
        const s = slot(list);
        slotAt.set(position, s);
        byPosition.set(position, placing.get(s) ?? { slot: s });
      }
    }
    // Rounds in playing order; a position that played earlier in this stage is that match's
    // winner (or, if it lost there, its loser: a play-off for third)
    const seen = new Map(); // position -> { no, won }
    const matches = [];
    for (const [, [list]] of data[2]) {
      for (const m of list) {
        const no = String(m[0]);
        record(m, [slotAt.get(m[8]), slotAt.get(m[9])]);
        const sides = [[m[8], m[6]], [m[9], m[7]]].map(([position, label], i) => {
          if (position >= 0) {
            const before = seen.get(position);
            if (before) return before.won ? { winnerOf: before.no } : { loserOf: before.no };
            return byPosition.get(position) ?? null;
          }
          const ref = (label ?? []).join(" ").match(/(winner|loser) of match (\d+)/i);
          return ref ? { [ref[1].toLowerCase() === "winner" ? "winnerOf" : "loserOf"]: ref[2] } : null;
        });
        [m[8], m[9]].forEach((position, i) => position >= 0 && seen.set(position, { no, won: m[5] === i + 1 }));
        matches.push({ no, sides });
      }
    }
    if (!stages.has(page.stage)) stages.set(page.stage, { title: page.stageTitle, matches: [] });
    stages.get(page.stage).matches.push(...matches);
  }
  if (!entries.length) return null;

  // Group places point at the group's number; the simulation wants its index
  const groupIndex = new Map(groups.map((g, i) => [g.number, i]));
  const stageList = [...stages.values()].map((s) => ({
    ...s,
    places: stagePlaces(s.title),
    matches: s.matches.map((m) => ({ ...m, sides: m.sides.map((src) => (src?.group !== undefined ? { group: groupIndex.get(src.group), rank: src.rank } : src)) })),
  }));
  // The main knockout: the one the group winners go to (the A play-off; a B play-off for the rest
  // is another stage), or the first
  const fedByWinners = stageList.findIndex((s) => s.matches.some((m) => m.sides.some((src) => src?.rank === 1)));
  stageList.forEach((s, i) => (s.main = i === (fedByWinners >= 0 ? fedByWinners : 0)));
  // Played once every match with two players has a winner
  const event = { slots: entries.length, groups, stages: stageList };
  const decided = Object.values(winners);
  const played = decided.length > 0 && decided.every((w) => w > 0);
  return {
    title: pages[0].stageTitle,
    entries,
    event,
    results: played ? { winners, groupOrder, walkovers: [...walkovers], withdrawals: [...withdrawals] } : null,
    unknownPlaceholders: [...unknownPlaceholders],
  };
}

async function fetchDraws(id) {
  const front = await service(id);
  if (!front) throw new Error(`Cup2000 tournament ${id} not found`);
  const events = [];
  for (const [, cls, links] of front.data.matchAll(/<tr><td>([^<]+)<\/td><td>(.*?)<\/td><\/tr>/g)) {
    for (const [, c, e] of links.matchAll(/[?&]c=(\d+)&e=(\d+)"/g)) {
      if (EVENTS[e]) events.push({ className: unescape(cls).trim(), e: +e, pages: await fetchEventPages(id, c, e) });
    }
  }
  return events;
}

// ---- Players and ratings ----

const { pools } = JSON.parse(readFileSync(`${DIR}data/ratings.json`, "utf8"));
const rated = Object.fromEntries(Object.entries(pools).map(([pool, list]) => [pool, new Map(list.map((p) => [p.id, p]))]));
const byName = new Map(); // normalized name -> [player]
for (const list of Object.values(pools)) for (const p of list) {
  const key = normalize(p.name);
  if (!(byName.get(key) ?? []).some((q) => q.id === p.id)) byName.set(key, [...(byName.get(key) ?? []), p]);
}

// The player id for a name in the draw: from the event's entry list (same name), then anyone on
// the tournament's lists, then a rated player of that name (the one from that club if several)
function identify({ name, club }, eventList, allLists) {
  const key = normalize(name);
  const same = (p) => normalize(p.name) === key;
  const found = eventList.flat().find(same) ?? allLists.flat().find(same);
  if (found) return { id: found.id, source: "entry list" };
  const candidates = byName.get(key) ?? [];
  const pick = candidates.find((p) => club && normalize(p.club ?? "") === normalize(club)) ?? (candidates.length === 1 ? candidates[0] : null);
  return pick ? { id: pick.id, source: "name" } : { id: null, source: null };
}

// A played tournament's results on badmintonportalen (data/portalen, fetch-portalen.mjs) name its
// players with their ids: as entry lists per class and discipline heading
function resultLists(portalenId) {
  const file = `${DIR}data/portalen/${portalenId}.json`;
  if (!portalenId || !existsSync(file)) return [];
  const lists = new Map();
  for (const m of JSON.parse(readFileSync(file, "utf8")).matches) {
    const key = `${m.className}|${HEADING[m.discipline]}`;
    if (!lists.has(key)) lists.set(key, { className: m.className, heading: HEADING[m.discipline], entries: [] });
    for (const side of [m.side1, m.side2]) if (side.every((p) => p.id)) lists.get(key).entries.push(side);
  }
  return [...lists.values()];
}

// Results from badmintonportalen, for a tournament whose results weren't entered on Cup2000: who
// beat whom among the event's entries (by player ids), with each group ranked by wins, then set and
// point difference. Null unless every group match and the final have a result there.
function portalenResults(portalenId, className, discipline, event, entries) {
  const file = `${DIR}data/portalen/${portalenId}.json`;
  if (!portalenId || !existsSync(file)) return null;
  const key = (ids) => ids.filter(Boolean).sort((a, b) => a - b).join("+");
  const entryOf = new Map(entries.map((e, i) => [key(e.players.map((p) => p.id)), i]));
  const pairs = new Map();
  const tally = new Map(); // entry -> [sets won − lost, points won − lost]
  const add = (e, sets, points) => {
    const t = tally.get(e) ?? [0, 0];
    tally.set(e, [t[0] + sets, t[1] + points]);
  };
  const matches = JSON.parse(readFileSync(file, "utf8")).matches.filter((m) => m.className === className && m.discipline === discipline && m.winner);
  for (const m of matches) {
    const [a, b] = [m.side1, m.side2].map((side) => entryOf.get(key(side.map((p) => p.id))));
    if (a === undefined || b === undefined) continue;
    pairs.set(`${a}|${b}`, m.winner === 1 ? a : b);
    const sets = (m.score ?? "").split(",").map((x) => x.split("/").map(Number)).filter(([x, y]) => x >= 0 && y >= 0);
    add(a, sets.filter(([x, y]) => x > y).length - sets.filter(([x, y]) => y > x).length, sets.reduce((s, [x, y]) => s + x - y, 0));
    add(b, sets.filter(([x, y]) => y > x).length - sets.filter(([x, y]) => x > y).length, sets.reduce((s, [x, y]) => s + y - x, 0));
  }
  if (!pairs.size) return null;
  const has = (a, b) => pairs.has(`${a}|${b}`) || pairs.has(`${b}|${a}`);
  const groupOrder = [];
  for (const [gi, g] of event.groups.entries()) {
    const list = g.matches?.length ? g.matches : g.slots.flatMap((a, i) => g.slots.slice(i + 1).map((b) => [a, b]));
    if (!list.every(([a, b]) => has(a, b))) return null;
    const wins = (e) => list.filter(([a, b]) => (a === e || b === e) && (pairs.get(`${a}|${b}`) ?? pairs.get(`${b}|${a}`)) === e).length;
    groupOrder[gi] = [...g.slots].sort((x, y) => wins(y) - wins(x) || (tally.get(y)?.[0] ?? 0) - (tally.get(x)?.[0] ?? 0) || (tally.get(y)?.[1] ?? 0) - (tally.get(x)?.[1] ?? 0));
  }
  return { winners: {}, groupOrder, pairs };
}

// Ratings at the end of the week before `day`, from the weekly histories (the current rating if
// the history doesn't reach that week; null if the player had no rating yet)
const histories = new Map();
function ratingBefore(id, pool, day) {
  if (!histories.has(id)) {
    const file = `${DIR}data/history/${id}.json`;
    histories.set(id, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
  }
  const h = histories.get(id)[pool];
  const current = rated[pool].get(id);
  if (!h) return current ? { rating: current.rating, rank: current.rank } : null;
  const week = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${h.from}T00:00:00Z`)) / DAY_MS / 7);
  if (week < 1) return null;
  if (week - 1 >= h.ratings.length) return current ? { rating: current.rating, rank: current.rank } : null;
  const rating = h.ratings[week - 1];
  return rating === null ? null : { rating, rank: h.ranks?.[week - 1] ?? null };
}

// A player's rating in the event's pool before the tournament. Without one: doubles from their
// singles rating (as for a new doubles player in rate.mjs), else the class's start rating.
function ratingOf(id, pool, level, male, day) {
  const own = id ? ratingBefore(id, pool, day) : null;
  if (own) return { rating: own.rating, rank: own.rank, estimated: false };
  if (!SINGLES.has(pool) && id) {
    const singles = ratingBefore(id, male ? "men" : "women", day) ?? ratingBefore(id, male ? "women" : "men", day);
    if (singles) return { rating: Math.round(R.P0 + R.DOUBLES_SINGLES_SEED * (singles.rating - R.P0)), rank: null, estimated: true };
  }
  return { rating: R.startRating(level), rank: null, estimated: true };
}

// ---- One tournament ----

const round = (x, d = 3) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const rounded = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));

async function fetchRaw({ portalen, cup2000 }) {
  const info = portalen ? await entryList(portalen.classId) : { lists: [], name: null, startDate: null, endDate: null, cup2000Id: cup2000 };
  const cupId = cup2000 || info.cup2000Id;
  if (!cupId) throw new Error(`No Cup2000 draw linked from badmintonportalen tournament ${portalen.tournamentId}`);
  const draws = await fetchDraws(cupId);
  const raw = { cupId, portalenId: portalen?.tournamentId ?? null, fetchedAt: new Date().toISOString(), info, draws };
  if (draws.some((d) => parseEvent(d.pages))) writeFileSync(`${OUT}/raw/${cupId}.json`, JSON.stringify(raw));
  return raw;
}

function analyse({ cupId, portalenId, fetchedAt, info, draws }) {
  const unmatched = [];
  const day = info.startDate ?? today;
  const lists = [...info.lists, ...resultLists(portalenId)];
  const events = [];
  for (const d of draws) {
    const parsed = parseEvent(d.pages);
    // No draw yet, or nothing to play (a single entry)
    if (!parsed || parsed.entries.length < 2) continue;
    const { event, results } = parsed;
    // An X class's stages decide places also when their titles don't say so ("Semi-/Finale",
    // "Sluttspill 2"): the main knockout 1–4, then each further stage the next two
    if (/\sX$/.test(d.className) && event.stages.length > 1) {
      let next = 1;
      for (const st of [...event.stages.filter((x) => x.main), ...event.stages.filter((x) => !x.main)]) {
        const size = st.main ? 4 : 2;
        st.places ??= [next, next + size - 1];
        next = st.places[1] + 1;
      }
    }
    const { pool, discipline, heading } = EVENTS[d.e];
    const level = R.tournamentLevel(d.className);
    const eventList = lists.filter((l) => l.className === d.className && l.heading === heading).flatMap((l) => l.entries);
    const entries = parsed.entries.map(({ names }) => {
      const players = names.map((s, i) => {
        const p = parsePlayer(s);
        const { id, source } = identify(p, eventList, lists.flatMap((l) => l.entries));
        if (!id) unmatched.push(`${d.className} ${heading}: ${s}`);
        // Mixed doubles pairs are listed man first, as on badmintonportalen
        const male = pool === "men" || pool === "mensDoubles" || (pool === "mixedDoubles" && i === 0);
        const player = id ? (rated[pool].get(id) ?? rated.men.get(id) ?? rated.women.get(id) ?? rated.mensDoubles.get(id) ?? rated.womensDoubles.get(id) ?? rated.mixedDoubles.get(id)) : null;
        return { id, name: player?.name ?? p.name, club: p.club, matchedBy: source, ...ratingOf(id, pool, level, male, day) };
      });
      return { players, rating: Math.round(players.reduce((s, p) => s + p.rating, 0)) };
    });
    const ratings = entries.map((e) => e.rating);
    const actual = simulate(event, ratings, { runs: RUNS, seed: 1 });
    const fair = simulate(event, ratings, { runs: RUNS, redraw: true, seed: 2 });
    const forced = results ?? portalenResults(portalenId, d.className, discipline, event, entries);
    let outcome = forced ? simulate(event, ratings, { runs: 1, forced }) : null;
    // Withdrawals (played draws): entries that lost by walkover are out from that match on. The
    // chances with them out, with the actual draw and with a fair one, give the luck including them.
    const withdrawn = new Map(results?.withdrawals ?? []);
    const after = withdrawn.size ? simulate(event, ratings, { runs: RUNS, seed: 3, withdrawn }) : null;
    const fairAfter = withdrawn.size ? simulate(event, ratings, { runs: RUNS, redraw: true, seed: 4, withdrawn }) : null;
    // Results from badmintonportalen count only if they decide the event (someone won it)
    if (outcome && !results && !outcome.some((o) => o.win === 1)) outcome = null;
    const groupOf = new Map(event.groups.flatMap((g, gi) => g.slots.map((s) => [s, gi])));
    // A single group: everyone plays everyone, so there is no luck
    const singleGroup = event.groups.length === 1 && !event.stages.length;
    const placement = actual.every((a) => a.place !== null);
    const main = event.stages.find((s) => s.main);
    const sources = (main?.matches ?? []).flatMap((m) => m.sides).filter(Boolean);
    events.push({
      className: d.className,
      discipline,
      pool,
      title: parsed.title,
      seeds: [...ratings.keys()].sort((a, b) => ratings[b] - ratings[a]).slice(0, seedCount(event)),
      groups: event.groups.map((g) => ({ name: g.name, number: g.number, entries: g.slots, rating: Math.round(g.slots.reduce((s, e) => s + ratings[e], 0) / g.slots.length) })),
      knockout: event.stages.length > 0,
      stages: event.stages.map((s) => ({ title: s.title, main: s.main, places: s.places })),
      maxRounds: maxRounds(event),
      singleGroup,
      // Every entry gets a placement (the X classes): luck is measured in places
      placement,
      // Who goes from the groups to the main knockout, from the draw: group places, and the best
      // of a place over all groups (e.g. the best runner-up)
      advance: {
        ranks: [...new Set(sources.filter((x) => x.rank).map((x) => x.rank))].sort(),
        best: [...new Set(sources.filter((x) => x.bestOfRank).map((x) => x.bestOfRank))].sort(),
      },
      played: !!outcome,
      entries: entries.map((e, i) => {
        const luck = singleGroup ? null : rounded(Object.fromEntries(["wins", "groupWin", "knockout", "win", "progress"].map((k) => [k, actual[i][k] - fair[i][k]])));
        // Placement: lower is better, so luck is the fair placement minus the actual one
        if (luck && placement) luck.place = round(fair[i].place - actual[i].place);
        // The event's luck measure: places when everyone is placed, else rounds
        if (luck) luck.score = luck.place ?? luck.progress;
        // With withdrawals: the luck including them, and the part they make
        if (luck && after) {
          const total = placement ? fairAfter[i].place - after[i].place : after[i].progress - fairAfter[i].progress;
          luck.draw = luck.score;
          luck.withdrawals = round(total - luck.score);
          luck.score = round(total);
        }
        return {
          ...e,
          group: groupOf.has(i) ? event.groups[groupOf.get(i)].number : null,
          actual: rounded(actual[i]),
          fair: rounded(fair[i]),
          luck,
          // What happened: rounds, placement, reaching the knockout and winning
          result: outcome ? rounded(outcome[i]) : null,
          // With withdrawals: the expectation with the actual draw once they're out, and whether this entry withdrew
          after: after ? rounded(after[i]) : null,
          fairAfter: fairAfter ? rounded(fairAfter[i]) : null,
          withdrew: withdrawn.has(i),
        };
      }),
      unknownPlaceholders: parsed.unknownPlaceholders,
    });
  }
  return {
    cup2000Id: cupId,
    portalenId,
    name: info.name ?? draws[0]?.title ?? `Cup2000 ${cupId}`,
    startDate: info.startDate,
    endDate: info.endDate,
    fetchedAt,
    runs: RUNS,
    events,
    evaluation: evaluate(events),
    unmatched,
  };
}

// How the predictions turned out, over the played events: who won against the predicted chances
// (the favourite's share of wins, the winners' predicted chance and the log loss), and whether the
// draw luck showed in the results: per entry, its result minus its fair-draw expectation against
// its luck (in rounds, or places in placement events). If luck is real, the results lean the same
// way: the slope of that regression (through zero) is about 1.
function evaluate(events) {
  const played = events.filter((e) => e.played);
  const winners = [];
  const luckRows = { rounds: [], places: [] };
  for (const e of played) {
    const champion = e.entries.find((x) => x.result.win === 1);
    if (champion) {
      const chances = e.entries.map((x) => x.actual.win);
      const favourite = Math.max(...chances);
      winners.push({ chance: champion.actual.win, favourite: champion.actual.win === favourite, favouriteChance: favourite, entries: e.entries.length });
    }
    if (e.singleGroup) continue;
    for (const x of e.entries) {
      if (x.withdrew) continue;
      if (e.placement) luckRows.places.push([x.luck.place, x.fair.place - x.result.place]);
      else luckRows.rounds.push([x.luck.progress, x.result.progress - x.fair.progress]);
    }
  }
  const sums = (rows) => ({
    n: rows.length,
    xx: round(rows.reduce((s, [x]) => s + x * x, 0)),
    xy: round(rows.reduce((s, [x, y]) => s + x * y, 0)),
    yy: round(rows.reduce((s, [, y]) => s + y * y, 0)),
  });
  return {
    events: played.length,
    winners: winners.length,
    favouritesWon: winners.filter((w) => w.favourite).length,
    favouritesExpected: round(winners.reduce((s, w) => s + w.favouriteChance, 0), 2),
    winnerChance: round(winners.reduce((s, w) => s + w.chance, 0), 3),
    logLoss: round(winners.reduce((s, w) => s - Math.log(Math.max(w.chance, 1 / RUNS)), 0), 3),
    luck: { rounds: sums(luckRows.rounds), places: sums(luckRows.places) },
  };
}

// A tournament whose page doesn't link to its draw: the Cup2000 tournament (data/tournaments.json,
// list-organisers.mjs) starting the same day whose name or organiser has the organising club's
// name in it ("Frogner: Frognerhøna" and "Frognerhøna 2026"), if there is exactly one. Cancelled
// tournaments ("AVLYST") are left out.
function findCup2000(info, title) {
  const file = `${DIR}data/tournaments.json`;
  if (!info.startDate || !existsSync(file) || /avlyst/i.test(title)) return null;
  const words = (s) => new Set(normalize(s).split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !["open", "cup", "cupen", "ranking", "badminton", "badmintonklubb"].includes(w)));
  const ours = words(title.split(":")[0]);
  const iso = (d) => d.split("/").reverse().join("-");
  const found = Object.values(JSON.parse(readFileSync(file, "utf8")))
    .filter(Boolean)
    .filter((t) => iso(t.date.split(" - ")[0].trim()) === info.startDate)
    .filter((t) => [...words(`${t.name} ${t.organiser}`)].some((w) => ours.has(w)));
  return found.length === 1 ? found[0].tournamentId : null;
}

// ---- CLI ----

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
mkdirSync(`${OUT}/raw`, { recursive: true });
const offline = process.argv.includes("--offline");
const refetch = process.argv.includes("--refetch");
const savedRaw = (cupId) => (existsSync(`${OUT}/raw/${cupId}.json`) ? JSON.parse(readFileSync(`${OUT}/raw/${cupId}.json`, "utf8")) : null);

let targets = [];
if (!offline) {
  const seasons = arg("--season") ? [`200${arg("--season")}`] : [...new Set([seasonId(today), seasonId(addDays(today, 60))])];
  const plan = (await Promise.all(seasons.map(seasonPlan))).flat();
  if (arg("--portalen")) {
    const t = plan.find((t) => t.tournamentId === +arg("--portalen"));
    if (!t) throw new Error(`Tournament ${arg("--portalen")} is not in the season plan`);
    targets = [{ portalen: t, cup2000: arg("--cup2000") ? +arg("--cup2000") : null }];
  } else {
    // A season: every tournament whose registration has closed; else those that closed in the last
    // 30 days and aren't over yet
    const candidates = plan.filter((t) => t.deadline <= today && (arg("--season") || t.deadline >= addDays(today, -30)));
    for (const t of candidates) {
      const info = await entryList(t.classId);
      if (!info.endDate || (!arg("--season") && info.endDate < today)) continue;
      if (arg("--cup2000") && info.cup2000Id !== +arg("--cup2000")) continue;
      if (!info.cup2000Id) info.cup2000Id = findCup2000(info, t.title);
      if (!info.cup2000Id) {
        console.error(`${t.title}: no Cup2000 link, skipped`);
        continue;
      }
      // A finished tournament already fetched after it ended has nothing new
      const saved = savedRaw(info.cup2000Id);
      if (!refetch && saved && info.endDate < today && saved.fetchedAt.slice(0, 10) > info.endDate) targets.push({ raw: saved });
      else targets.push({ portalen: t, cup2000: info.cup2000Id });
    }
    if (arg("--cup2000") && !targets.length) {
      console.error(`Cup2000 ${arg("--cup2000")} isn't linked from a tournament in the season plan: players are matched by name only`);
      targets = [{ cup2000: +arg("--cup2000") }];
    }
  }
} else {
  targets = readdirSync(`${OUT}/raw`).filter((f) => f.endsWith(".json")).map((f) => ({ raw: JSON.parse(readFileSync(`${OUT}/raw/${f}`, "utf8")) }));
}

for (const target of targets) {
  const label = target.raw?.info.name ?? target.portalen?.title ?? `Cup2000 ${target.cup2000}`;
  try {
    const raw = target.raw ?? (await fetchRaw(target));
    if (!raw.draws?.[0]?.pages) {
      console.error(`${label}: saved in an older format, run again without --offline`);
      continue;
    }
    const t = analyse(raw);
    if (!t.events.length) {
      console.error(`${label}: no draw published yet`);
      continue;
    }
    writeFileSync(`${OUT}/${t.cup2000Id}.json`, JSON.stringify(t));
    const entries = t.events.reduce((s, e) => s + e.entries.length, 0);
    const ev = t.evaluation;
    console.error(
      `${label} (${t.startDate}): ${t.events.length} events, ${entries} entries, ${t.unmatched.length} players not identified` +
        (ev.events ? `; played: ${ev.events} events, favourite won ${ev.favouritesWon} of ${ev.winners} (expected ${ev.favouritesExpected})` : "")
    );
    const unknown = [...new Set(t.events.flatMap((e) => e.unknownPlaceholders))];
    if (unknown.length) console.error(`  unknown placeholders: ${unknown.join("; ")}`);
    for (const u of t.unmatched.slice(0, 5)) console.error(`  not identified: ${u}`);
  } catch (err) {
    console.error(`${label}: FAILED ${err.stack}`);
  }
}

// The list of tournaments, newest first, and the season's evaluation summed over them
const tournaments = readdirSync(OUT)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")))
  .map(({ events, unmatched, ...t }) => ({ ...t, events: events.length, entries: events.reduce((s, e) => s + e.entries.length, 0), played: events.filter((e) => e.played).length }))
  .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
const total = { events: 0, winners: 0, favouritesWon: 0, favouritesExpected: 0, winnerChance: 0, logLoss: 0, luck: { rounds: { n: 0, xx: 0, xy: 0, yy: 0 }, places: { n: 0, xx: 0, xy: 0, yy: 0 } } };
for (const { evaluation: ev } of tournaments) {
  if (!ev) continue;
  for (const k of ["events", "winners", "favouritesWon", "favouritesExpected", "winnerChance", "logLoss"]) total[k] = round(total[k] + ev[k], 3);
  for (const m of ["rounds", "places"]) for (const k of ["n", "xx", "xy", "yy"]) total.luck[m][k] = round(total.luck[m][k] + ev.luck[m][k], 3);
}
writeFileSync(`${DIR}data/upcoming.json`, JSON.stringify({ generatedAt: new Date().toISOString(), evaluation: total, tournaments }, null, 1));
