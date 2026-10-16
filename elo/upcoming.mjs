// Upcoming tournaments: each event's draw from Cup2000, the players identified from the entry list
// on badmintonportalen ("deltakerliste"), and how lucky each player's draw is by their ratings.
// Usage: node upcoming.mjs                    upcoming tournaments with a published draw (found
//                                             from the season plan: registration closed in the
//                                             last 30 days, not over yet)
//        node upcoming.mjs --portalen 7076    one tournament by its badmintonportalen id
//        node upcoming.mjs --cup2000 11094    one tournament by its Cup2000 id (the badmintonportalen
//                                             tournament is found by its link to the draw)
//        node upcoming.mjs --portalen 7111 --cup2000 11120   both, for a tournament whose page on
//                                             badmintonportalen doesn't link to its draw
//        node upcoming.mjs --offline          recalculate every saved tournament from its saved draw
//                                             and entry list (after rate.mjs), without fetching
// Run after rate.mjs. Writes data/upcoming/<cup2000 id>.json and the list data/upcoming.json; the
// fetched draw and entry list are kept in data/upcoming/raw/<cup2000 id>.json.
//
// Draw luck: each event is simulated (draw-sim.mjs) with the actual draw and with random redraws
// of the same entries (seeds kept in place). An entry's luck is its expected rounds (or, in events
// that place everyone, as the X classes, its expected placement) in the actual draw against the
// average over redraws.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { call, text } from "./portalen.mjs";
import { service, unescape, parsePlayer } from "./fetch-tournament.mjs";
import { maxRounds, simulate } from "./draw-sim.mjs";
import * as R from "./rules.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const OUT = `${DIR}data/upcoming`;
const RUNS = 20000;
const today = new Date().toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Cup2000 event codes (e=) and the matching pool and badmintonportalen discipline heading
const EVENTS = {
  0: { pool: "men", discipline: "MensSingles", heading: "Herresingle" },
  1: { pool: "mensDoubles", discipline: "MensDoubles", heading: "Herredouble" },
  2: { pool: "women", discipline: "WomensSingles", heading: "Damesingle" },
  3: { pool: "womensDoubles", discipline: "WomensDoubles", heading: "Damedouble" },
  4: { pool: "mixedDoubles", discipline: "MixedDoubles", heading: "Mixeddouble" },
};
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

// One event (class c, event code e) as a draw-sim event, with its entries' names. Null if there is
// no draw yet (no entries).
async function fetchEvent(id, c, e) {
  const top = await service(id, { c, e });
  const pages = [];
  if (top.renderMethod === 2) {
    for (const [p, groups, title] of top.data) {
      if (groups > 0) for (let g = 1; g <= groups; g++) pages.push({ ...(await service(id, { c, e, p, g })), stage: p, stageTitle: unescape(title) });
      else pages.push({ ...(await service(id, { c, e, p })), stage: p, stageTitle: unescape(title) });
    }
  } else pages.push({ ...top, stage: 0, stageTitle: unescape(top.data[0]) });

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
  const unknownPlaceholders = new Set();
  for (const page of pages) {
    const data = page.data;
    if (page.renderMethod === 3) {
      // [title, standings rows [index, ..., names], [matches, venues]]
      const byIndex = new Map(data[1].filter((row) => row[5]?.length).map((row) => [row[0], slot(row[5].map(unescape))]));
      groups.push({
        name: unescape(data[0]),
        number: groupNumber(unescape(data[0])) || groups.length + 1,
        slots: [...byIndex.values()],
        matches: data[2][0].map((m) => [byIndex.get(m[8]), byIndex.get(m[9])]).filter(([a, b]) => a !== undefined && b !== undefined),
      });
    } else if (page.renderMethod === 4) {
      // [title, players [[position, ?, seed, names]], rounds [[size, [matches, venues]]]]
      const byPosition = new Map();
      for (const [position, , , names] of data[1]) {
        const list = (names ?? []).map(unescape);
        if (!list.length) continue;
        const ph = list.length === 1 ? placeholder(list[0]) : null;
        if (ph) byPosition.set(position, ph);
        else if (/vinner|pulje|winner/i.test(list[0])) unknownPlaceholders.add(list[0]);
        else byPosition.set(position, { slot: slot(list) });
      }
      const matches = data[2].flatMap(([, [list]]) =>
        list.map((m) => ({
          no: String(m[0]),
          sides: [[m[8], m[6]], [m[9], m[7]]].map(([position, label]) => {
            if (position >= 0) return byPosition.get(position) ?? null;
            const ref = (label ?? []).join(" ").match(/(winner|loser) of match (\d+)/i);
            return ref ? { [ref[1].toLowerCase() === "winner" ? "winnerOf" : "loserOf"]: ref[2] } : null;
          }),
        }))
      );
      if (!stages.has(page.stage)) stages.set(page.stage, { title: page.stageTitle, matches: [] });
      stages.get(page.stage).matches.push(...matches);
    }
  }
  if (!entries.length) return null;
  // Group placeholders point at the group's number; the simulation wants its index
  const groupIndex = new Map(groups.map((g, i) => [g.number, i]));
  // A stage deciding places: "Herresingle U15 X 5-6 plassen" → [5, 6]
  const places = (title) => {
    const m = title.match(/(\d+)\s*[-–]\s*(\d+)\.?\s*plass/i);
    return m ? [+m[1], +m[2]] : null;
  };
  const stageList = [...stages.values()].map((s, i) => ({
    ...s,
    main: i === 0,
    places: places(s.title),
    matches: s.matches.map((m) => ({ ...m, sides: m.sides.map((src) => (src?.group !== undefined ? { group: groupIndex.get(src.group), rank: src.rank } : src)) })),
  }));
  return { title: pages[0].stageTitle, entries, event: { slots: entries.length, groups, stages: stageList }, unknownPlaceholders: [...unknownPlaceholders] };
}

async function fetchDraws(id) {
  const front = await service(id);
  if (!front) throw new Error(`Cup2000 tournament ${id} not found`);
  const events = [];
  for (const [, cls, links] of front.data.matchAll(/<tr><td>([^<]+)<\/td><td>(.*?)<\/td><\/tr>/g)) {
    for (const [, c, e] of links.matchAll(/[?&]c=(\d+)&e=(\d+)"/g)) {
      if (!EVENTS[e]) continue;
      const draw = await fetchEvent(id, c, e);
      if (draw) events.push({ className: unescape(cls).trim(), e: +e, ...draw });
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

// A player's rating in the event's pool. Without one: doubles from their singles rating (as for a
// new doubles player in rate.mjs), else the class's start rating.
function ratingOf(id, pool, level, male) {
  const own = id ? rated[pool].get(id) : null;
  if (own) return { rating: own.rating, rank: own.rank, estimated: false };
  if (!SINGLES.has(pool) && id) {
    const singles = rated[male ? "men" : "women"].get(id) ?? rated.men.get(id) ?? rated.women.get(id);
    if (singles) return { rating: Math.round(R.P0 + R.DOUBLES_SINGLES_SEED * (singles.rating - R.P0)), rank: null, estimated: true };
  }
  return { rating: R.startRating(level), rank: null, estimated: true };
}

// ---- One tournament ----

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

async function fetchRaw({ portalen, cup2000 }) {
  const info = portalen ? await entryList(portalen.classId) : { lists: [], name: null, startDate: null, endDate: null, cup2000Id: cup2000 };
  const cupId = cup2000 || info.cup2000Id;
  if (!cupId) throw new Error(`No Cup2000 draw linked from badmintonportalen tournament ${portalen.tournamentId}`);
  const draws = await fetchDraws(cupId);
  if (!draws.length) return { cupId, noDraw: true };
  const raw = { cupId, portalenId: portalen?.tournamentId ?? null, fetchedAt: new Date().toISOString(), info, draws };
  writeFileSync(`${OUT}/raw/${cupId}.json`, JSON.stringify(raw));
  return raw;
}

function upcoming({ cupId, portalenId, fetchedAt, info, draws }) {
  const unmatched = [];
  const events = draws.map((d) => {
    const { pool, discipline, heading } = EVENTS[d.e];
    const level = R.tournamentLevel(d.className);
    const eventList = info.lists.find((l) => l.className === d.className && l.heading === heading)?.entries ?? [];
    const entries = d.entries.map(({ names }) => {
      const players = names.map((s) => {
        const p = parsePlayer(s);
        const { id, source } = identify(p, eventList, info.lists.flatMap((l) => l.entries));
        if (!id) unmatched.push(`${d.className} ${heading}: ${s}`);
        // Mixed doubles pairs are listed man first, as on badmintonportalen
        const male = pool === "men" || pool === "mensDoubles" || (pool === "mixedDoubles" && names.indexOf(s) === 0);
        const player = id ? (rated[pool].get(id) ?? rated.men.get(id) ?? rated.women.get(id)) : null;
        return { id, name: player?.name ?? p.name, club: p.club, matchedBy: source, ...ratingOf(id, pool, level, male) };
      });
      return { players, rating: Math.round(players.reduce((s, p) => s + p.rating, 0)) };
    });
    const ratings = entries.map((e) => e.rating);
    const actual = simulate(d.event, ratings, { runs: RUNS, seed: 1 });
    const fair = simulate(d.event, ratings, { runs: RUNS, redraw: true, seed: 2 });
    const groupOf = new Map(d.event.groups.flatMap((g, gi) => g.slots.map((s) => [s, gi])));
    return {
      className: d.className,
      discipline,
      pool,
      title: d.title,
      seeds: [...ratings.keys()].sort((a, b) => ratings[b] - ratings[a]).slice(0, (d.event.groups.length > 1 ? d.event.groups.length : d.event.slots < 16 ? 2 : d.event.slots < 32 ? 4 : 8)),
      groups: d.event.groups.map((g) => ({ name: g.name, number: g.number, entries: g.slots, rating: Math.round(g.slots.reduce((s, e) => s + ratings[e], 0) / g.slots.length) })),
      knockout: d.event.stages.length > 0,
      maxRounds: maxRounds(d.event),
      // Every entry gets a placement (the X classes): luck is measured in places
      placement: actual.every((a) => a.place !== null),
      // Who goes from the groups to the main knockout, from the draw: group places, and the best
      // of a place over all groups (e.g. the best runner-up)
      advance: (() => {
        const sources = (d.event.stages.find((st) => st.main)?.matches ?? []).flatMap((m) => m.sides).filter(Boolean);
        return {
          ranks: [...new Set(sources.filter((x) => x.rank).map((x) => x.rank))].sort(),
          best: [...new Set(sources.filter((x) => x.bestOfRank).map((x) => x.bestOfRank))].sort(),
        };
      })(),
      entries: entries.map((e, i) => ({
        ...e,
        group: groupOf.has(i) ? d.event.groups[groupOf.get(i)].number : null,
        actual: Object.fromEntries(Object.entries(actual[i]).map(([k, v]) => [k, v === null ? null : round(v)])),
        fair: Object.fromEntries(Object.entries(fair[i]).map(([k, v]) => [k, v === null ? null : round(v)])),
        luck: (() => {
          const luck = Object.fromEntries(Object.keys(actual[i]).filter((k) => actual[i][k] !== null).map((k) => [k, round(actual[i][k] - fair[i][k])]));
          // Placement: lower is better, so luck is the fair placement minus the actual one
          if (actual[i].place !== null) luck.place = round(fair[i].place - actual[i].place);
          // The event's luck measure: places when everyone is placed, else rounds
          luck.score = luck.place ?? luck.progress;
          return luck;
        })(),
      })),
      unknownPlaceholders: d.unknownPlaceholders,
    };
  });
  return {
    cup2000Id: cupId,
    portalenId,
    name: info.name ?? draws[0]?.title ?? `Cup2000 ${cupId}`,
    startDate: info.startDate,
    endDate: info.endDate,
    fetchedAt,
    runs: RUNS,
    events,
    unmatched,
  };
}

// ---- CLI ----

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
mkdirSync(`${OUT}/raw`, { recursive: true });
const offline = process.argv.includes("--offline");

let targets = [];
if (!offline) {
  // The season plan: by badmintonportalen id, or tournaments whose registration closed in the last
  // 30 days (their draw may be out); this season's and, from May, next season's
  const seasons = [...new Set([seasonId(today), seasonId(addDays(today, 60))])];
  const plan = (await Promise.all(seasons.map(seasonPlan))).flat();
  if (arg("--portalen")) {
    const t = plan.find((t) => t.tournamentId === +arg("--portalen"));
    if (!t) throw new Error(`Tournament ${arg("--portalen")} is not in the season plan`);
    targets = [{ portalen: t, cup2000: arg("--cup2000") ? +arg("--cup2000") : null }];
  } else {
    const recent = plan.filter((t) => t.deadline <= today && t.deadline >= addDays(today, -30));
    for (const t of recent) {
      const info = await entryList(t.classId);
      if (!info.endDate || info.endDate < today) continue;
      if (arg("--cup2000") && info.cup2000Id !== +arg("--cup2000")) continue;
      if (info.cup2000Id) targets.push({ portalen: t, cup2000: info.cup2000Id });
      else console.error(`${t.title}: no Cup2000 link, skipped`);
    }
    if (arg("--cup2000") && !targets.length) {
      console.error(`Cup2000 ${arg("--cup2000")} isn't linked from a tournament in the season plan: players are matched by name only`);
      targets = [{ cup2000: +arg("--cup2000") }];
    }
  }
}

const saved = offline ? readdirSync(`${OUT}/raw`).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`${OUT}/raw/${f}`, "utf8"))) : [];
for (const target of offline ? saved.map((raw) => ({ raw })) : targets) {
  const label = target.raw?.info.name ?? target.portalen?.title ?? `Cup2000 ${target.cup2000}`;
  try {
    const raw = target.raw ?? (await fetchRaw(target));
    if (raw.noDraw) {
      console.error(`${label}: no draw published yet`);
      continue;
    }
    const t = upcoming(raw);
    writeFileSync(`${OUT}/${t.cup2000Id}.json`, JSON.stringify(t));
    const entries = t.events.reduce((s, e) => s + e.entries.length, 0);
    console.error(`${label} (${t.startDate}): ${t.events.length} events, ${entries} entries, ${t.unmatched.length} players not identified`);
    for (const u of t.unmatched.slice(0, 10)) console.error(`  not identified: ${u}`);
  } catch (err) {
    console.error(`${label}: FAILED ${err.message}`);
  }
}

// The list of tournaments, newest first
const index = readdirSync(OUT)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")))
  .map(({ events, unmatched, ...t }) => ({ ...t, events: events.length, entries: events.reduce((s, e) => s + e.entries.length, 0) }))
  .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
writeFileSync(`${DIR}data/upcoming.json`, JSON.stringify({ generatedAt: new Date().toISOString(), tournaments: index }, null, 1));
