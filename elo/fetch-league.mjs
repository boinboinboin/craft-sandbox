// Fetch singles and doubles games from team matches (league play) on badmintonportalen.no.
// Usage: node fetch-league.mjs [--refetch] [--dry-run] [--season 2024] [--limit 5]
//
// GetLeagueStanding is one method with "subpages":
//   1: leagues for season + age group + region -> groups
//   4: all ties (team matches) in a group
//   5: one tie, with its individual games (1. HS, 2. HS, 1. DS, 1. HD, 1. MD, ...)
// Writes data/league/<season>-<groupId>.json per group. Groups are skipped once saved; groups
// with unplayed ties in the current season aren't saved, so a later run picks them up.
import { readdir, writeFile, mkdir, appendFile } from "node:fs/promises";
import { call, text } from "./portalen.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const OUT = `${DIR}data/league`;
const ERRORS = `${DIR}data/league-errors.log`;
const FIRST_SEASON = 2013;
const CONCURRENCY = 2;
// From the dropdowns on /NBF/HoldTurnering/Stilling/
const REGIONS = {
  200001: "Norges Badminton Forbund",
  200002: "Badmintonkretsen Sør",
  200003: "Badmintonkretsen Vest",
  200004: "Finnmark Badmintonkrets",
  200005: "Innlandet Badmintonkrets",
  200006: "Hålogaland Badmintonkrets",
  200007: "Midtnorsk Badmintonkrets Nord",
  200008: "Midtnorsk Badmintonkrets Sør",
  200009: "Oslofjorden Badmintonkrets",
  200011: "VBT Badmintonkrets",
};
const AGE_GROUPS = {
  2001: "SEN", 2002: "U9", 2003: "U11", 2004: "U13", 2005: "U15", 2006: "U17", 2007: "U19",
  2008: "O35", 2009: "O40", 2010: "O45", 2011: "O50", 2012: "O55", 2013: "O60", 2014: "O65",
  2015: "O70", 2016: "O75", 2018: "O80", 2017: "Åpen",
};
// Game codes in a tie -> the same discipline names as tournaments use.
const DISCIPLINES = { HS: "MensSingles", DS: "WomensSingles", HD: "MensDoubles", DD: "WomensDoubles", MD: "MixedDoubles" };

const currentSeason = () => {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
};

const standing = (subPage, { season, groupId = "", ageGroupId = "", regionId = "", matchId = "" }) =>
  call("GetLeagueStanding", {
    subPage: String(subPage),
    seasonID: `200${season}`,
    leagueGroupID: String(groupId),
    ageGroupID: String(ageGroupId),
    regionID: String(regionId),
    leagueGroupTeamID: "",
    leagueMatchID: String(matchId),
    clubID: "",
    playerID: "",
  }).then((r) => r.html ?? "");

// Subpage 1: <tr class='divisionrow'><td><h3>Eliteserien 2025/2026</h3></td></tr>
//            <tr class='grouprow'><td><a onclick="return ShowStanding('2', '2002025', '1537', ...)">Grunnspill</a>
async function listGroups(season, ageGroupId, regionId) {
  const html = await standing(1, { season, ageGroupId, regionId });
  const groups = [];
  let division = "";
  for (const row of html.split(/<tr/).slice(1)) {
    const h3 = row.match(/class='divisionrow'><td><h3>(.*?)<\/h3>/);
    if (h3) division = text(h3[1]);
    const g = row.match(/ShowStanding\('2', '\d+', '(\d+)'[^>]*>(.*?)<\/a>/);
    if (g) groups.push({ season, groupId: +g[1], ageGroup: AGE_GROUPS[ageGroupId], ageGroupId, region: REGIONS[regionId], regionId, division, group: text(g[2]) });
  }
  return groups;
}

// "lør. 15.11.2025 12:00" -> "2025-11-15T12:00"
function isoTime(s) {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}:\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? `T${m[4]}` : ""}` : null;
}

// Subpage 4: one row per tie with time, match number, teams and overall score.
async function listTies(g) {
  const html = await standing(4, g);
  return html
    .split(/<tr/)
    .slice(1)
    .map((row) => {
      const id = row.match(/ShowStanding\('5', [^)]*?'(\d+)', '', ''\)/)?.[1];
      if (!id) return null;
      const teams = [...row.matchAll(/<td class='team'>(.*?)<\/td>/g)].map((m) => text(m[1]));
      return {
        matchId: +id,
        time: isoTime(text(row.match(/<td class='time'>(.*?)<\/td>/)?.[1] ?? "")),
        home: teams[0],
        away: teams[1],
        score: text(row.match(/<td class='score'>(.*?)<\/td>/)?.[1] ?? ""),
      };
    })
    .filter(Boolean);
}

// A side's cell: <div class='teamhdr'>NTNUI</div><div><a href='...VisSpiller/#17534'>Name</a></div>
function parseSide(cell, team) {
  return [...cell.matchAll(/<div><a[^>]*VisSpiller\/#(\d+)[^>]*>(.*?)<\/a><\/div>/g)].map(([, id, name]) => ({
    id: +id,
    name: text(name),
    club: team,
  }));
}

// Subpage 5: the tie's games. Set scores have the winning side's points in <b>.
const unknownCodes = new Set();
async function fetchGames(g, tie) {
  const html = await standing(5, { ...g, matchId: tie.matchId });
  const schema = html.slice(html.indexOf("matchresultschema"));
  const games = [];
  for (const row of schema.split(/<tr>/).slice(1)) {
    const code = text(row.match(/<td class='discipline'>(.*?)<\/td>/)?.[1] ?? "");
    const discipline = DISCIPLINES[code.replace(/^\d+\.\s*/, "")];
    if (!discipline) {
      if (code) unknownCodes.add(code);
      continue;
    }
    const cells = [...row.matchAll(/<td class='(player\w*)'>(.*?)<\/td>/gs)];
    if (cells.length !== 2) continue;
    const sets = [...row.matchAll(/<td class='result'>(.*?)<\/td>/g)]
      .map((m) => text(m[1]).replace(/\s*-\s*/, "/"))
      .filter(Boolean);
    const wo = text(row.match(/<td class='wo'>(.*?)<\/td>/)?.[1] ?? "");
    const winnerIndex = cells.findIndex(([, cls]) => cls === "playerwinner");
    games.push({
      discipline,
      game: code,
      side1: parseSide(cells[0][2], tie.home),
      side2: parseSide(cells[1][2], tie.away),
      winner: winnerIndex === -1 ? null : winnerIndex + 1,
      score: sets.join(",") || wo,
      walkover: !!wo,
    });
  }
  return games;
}

async function fetchGroup(g) {
  const ties = await listTies(g);
  // Unplayed ties show "-" as their score.
  const played = ties.filter((t) => /\d+\s*-\s*\d+/.test(t.score));
  if (g.season >= currentSeason() && played.length < ties.length) return { unfinished: true };
  for (const tie of played) tie.games = await fetchGames(g, tie);
  return { ...g, fetchedAt: new Date().toISOString(), ties: played };
}

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const refetch = process.argv.includes("--refetch");
const seasons = process.argv.includes("--season")
  ? [+arg("--season")]
  : Array.from({ length: currentSeason() - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);

await mkdir(OUT, { recursive: true });
const done = new Set(refetch ? [] : (await readdir(OUT)).map((f) => f.replace(".json", "")));
const fileKey = (g) => `${g.season}-${g.groupId}`;

const groups = new Map();
for (const season of seasons) {
  let found = 0;
  for (const regionId of Object.keys(REGIONS)) {
    for (const ageGroupId of Object.keys(AGE_GROUPS)) {
      for (const g of await listGroups(season, ageGroupId, regionId)) {
        if (!groups.has(fileKey(g))) found++;
        groups.set(fileKey(g), g);
      }
    }
  }
  console.error(`${season}/${season + 1}: ${found} league groups`);
}
const pending = [...groups.values()].filter((g) => !done.has(fileKey(g)));
const todo = pending.slice(0, process.argv.includes("--limit") ? +arg("--limit") : undefined);
console.error(`${groups.size} groups, ${groups.size - pending.length} already fetched, ${todo.length} to fetch`);
if (process.argv.includes("--dry-run")) process.exit(0);

let failed = 0;
let unfinished = 0;
let next = 0;
async function worker() {
  while (next < todo.length) {
    const i = next++;
    const g = todo[i];
    const label = `[${i + 1}/${todo.length}] ${g.season} ${g.region} ${g.ageGroup} ${g.division} ${g.group}`;
    try {
      const result = await fetchGroup(g);
      if (result.unfinished) {
        unfinished++;
        console.error(`${label}: not finished, skipped`);
        continue;
      }
      await writeFile(`${OUT}/${fileKey(g)}.json`, JSON.stringify(result));
      const games = result.ties.reduce((n, t) => n + t.games.length, 0);
      console.error(`${label}: ${result.ties.length} ties, ${games} games`);
    } catch (err) {
      failed++;
      console.error(`${label}: FAILED ${err.message}`);
      await appendFile(ERRORS, `${new Date().toISOString()} ${fileKey(g)} ${err.message}\n`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (unknownCodes.size) console.error(`Skipped unknown game codes: ${[...unknownCodes].join(", ")}`);
console.error(`Done. ${todo.length - failed - unfinished} saved, ${unfinished} not finished, ${failed} failed`);
