// Fetch all singles results from badmintonportalen.no (NBF), with player ids.
// Usage: node fetch-portalen.mjs [--refetch] [--dry-run] [--season 2024] [--limit 5]
//
// Seasons -> tournaments (GetSeasonPlan) -> classes and events (GetTournamentEvents)
// -> matches of each singles event (SearchTournamentMatches).
// Writes data/portalen/<tournamentId>.json per tournament. Already-fetched and unfinished
// tournaments are skipped, so it can be stopped and re-run. Failures go to data/portalen-errors.log.
import { readdir, writeFile, mkdir, appendFile } from "node:fs/promises";
import { call, unescape, text } from "./portalen.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const OUT = `${DIR}data/portalen`;
const ERRORS = `${DIR}data/portalen-errors.log`;
const FIRST_SEASON = 2013; // earliest season on badmintonportalen (2013/2014)
const CONCURRENCY = 2;
const SINGLES = new Set(["MensSingles", "WomensSingles"]);
const today = new Date().toISOString().slice(0, 10);

// Season ids are "200" + start year, e.g. 2002025 for 2025/2026. Seasons start in July.
const currentSeason = () => {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
};

async function seasonTournaments(year) {
  const { html } = await call("GetSeasonPlan", {
    seasonid: `200${year}`,
    regionids: null,
    agegroupids: null,
    classids: null,
    strfrom: "",
    strto: "",
    strweekno: "",
    strweekno2: "",
    georegionids: null,
    clubid: "",
    disciplines: null,
    playerid: "",
    birthdate: "",
    age: "",
    points: "",
    gender: "",
    publicseasonplan: true,
    showleague: false,
    selectclientfunction: "SelectTournamentClass1",
    page: 0,
  });
  // <tr class='row' onclick='return SelectTournamentClass1(6971, 26778);' >...<td class='title'>Kolvereid: Liland Køpp</td>
  return [...html.matchAll(/SelectTournamentClass1\((\d+), (\d+)\);[^]*?<td class='title'>(.*?)<\/td>/g)].map(
    ([, tournamentId, classId, title]) => ({ tournamentId: +tournamentId, classId, title: text(title), season: year })
  );
}

const events = (tournamentclassid) =>
  call("GetTournamentEvents", {
    selecteventfunction: "x",
    instance: 1,
    tournamentclassid,
    playerlistselectfunction: "",
    selectclassfunction: "",
    selectopenonly: false,
    clubid: "",
    adminclubid: "",
    selecteddisciplinecode: "",
  });

// "dd.mm.yyyy" -> "yyyy-mm-dd"
const isoDate = (d) => d.split(".").reverse().join("-");

// Tournament info box: <h2>10.01.2025 Frogner RT U13 + Sen*</h2> ... Dato: fre. 10.01.2025 til søn. 12.01.2025
function parseInfo(info) {
  const dates = (info.match(/Dato:.*?<\/tr>/s)?.[0].match(/\d{2}\.\d{2}\.\d{4}/g) ?? []).map(isoDate);
  const name = text(info.match(/<h2>(.*?)<\/h2>/s)?.[1] ?? "").replace(/^\d{2}\.\d{2}\.\d{4}\s*/, "");
  return { name, startDate: dates[0] ?? null, endDate: dates.at(-1) ?? null };
}

// A side's cell: <a href='...VisSpiller/#21260' ...>Jonas Østhassel</a>, Kristiansand<br />
function parseSide(cell) {
  return cell
    .split(/<br\s*\/?>/)
    .filter((p) => p.trim())
    .map((p) => ({
      id: +(p.match(/VisSpiller\/#(\d+)/)?.[1] ?? 0) || null,
      name: text(p.match(/<a[^>]*>(.*?)<\/a>/)?.[1] ?? p.split(",")[0]),
      club: text(p.replace(/<a[^>]*>.*?<\/a>/, "").replace(/^\s*,/, "")),
    }));
}

// Match list: header rows name the round ("Pulje 1", "Kvartfinaler", "Finale") and are listed
// final-first. Returned in playing order: groups, then knockout rounds up to the final.
function parseMatches(html) {
  const blocks = [];
  for (const row of html.split(/<tr/).slice(1)) {
    const header = row.match(/class='headrow'><td[^>]*>(.*?)<\/td>/);
    if (header) {
      blocks.push({ round: text(header[1]), matches: [] });
      continue;
    }
    const cells = [...row.matchAll(/<td class='(player[^']*)'>(.*?)<\/td>/gs)];
    if (cells.length !== 2) continue;
    const result = text(row.match(/<td class='result'>(.*?)<\/td>/s)?.[1] ?? "");
    const winnerIndex = cells.findIndex(([, cls]) => cls.includes("winner"));
    if (!blocks.length) blocks.push({ round: "", matches: [] });
    blocks.at(-1).matches.push({
      side1: parseSide(cells[0][2]),
      side2: parseSide(cells[1][2]),
      winner: winnerIndex === -1 ? null : winnerIndex + 1,
      score: result,
      walkover: /w\.?\s*o\.?/i.test(result),
    });
  }
  const groups = blocks.filter((b) => /^pulje/i.test(b.round));
  const knockout = blocks.filter((b) => !/^pulje/i.test(b.round)).reverse();
  return [...groups, ...knockout].flatMap((b) => b.matches.map((m) => ({ round: b.round, ...m })));
}

async function fetchTournament({ tournamentId, classId, title, season }) {
  const first = await events(classId);
  const info = parseInfo(first.Info ?? "");
  // Not over yet: report without fetching matches, so a later run gets the final results.
  if (!info.endDate || info.endDate >= today) return { unfinished: true, endDate: info.endDate };
  // The class dropdown lists every class in the tournament: <option value="24993">SEN E</option>
  const classes = [...(first.Html.match(/<select[^]*?<\/select>/)?.[0] ?? "").matchAll(/<option value="(\d+)"[^>]*>(.*?)<\/option>/g)].map(
    ([, id, name]) => ({ id, name: text(name) })
  );
  if (!classes.length) classes.push({ id: classId, name: "" });

  const matches = [];
  for (const cls of classes) {
    const ev = cls.id === classId ? first : await events(cls.id);
    for (const e of ev.Events ?? []) {
      if (!SINGLES.has(e.discipline)) continue;
      const res = await call("SearchTournamentMatches", {
        tournamentclassid: cls.id,
        tournamenteventid: String(e.tournamentEventID),
        clientselectfunction: "SelectTournamentClass1",
      });
      for (const m of parseMatches(res.Html ?? "")) {
        matches.push({ className: cls.name, discipline: e.discipline, ...m });
      }
    }
  }
  return {
    tournamentId,
    name: info.name || title,
    title,
    season,
    startDate: info.startDate,
    endDate: info.endDate,
    classes: classes.map((c) => c.name),
    fetchedAt: new Date().toISOString(),
    matches,
  };
}

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const refetch = process.argv.includes("--refetch");
const seasons = process.argv.includes("--season")
  ? [+arg("--season")]
  : Array.from({ length: currentSeason() - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);

await mkdir(OUT, { recursive: true });
const done = new Set(refetch ? [] : (await readdir(OUT)).map((f) => +f.replace(".json", "")));

const tournaments = [];
for (const year of seasons) {
  const found = await seasonTournaments(year);
  console.error(`${year}/${year + 1}: ${found.length} tournaments`);
  tournaments.push(...found);
}
const pending = tournaments.filter((t) => !done.has(t.tournamentId));
const todo = pending.slice(0, process.argv.includes("--limit") ? +arg("--limit") : undefined);
console.error(`${tournaments.length} tournaments, ${tournaments.length - pending.length} already fetched, ${todo.length} to fetch`);
if (process.argv.includes("--dry-run")) process.exit(0);

let failed = 0;
let unfinished = 0;
let next = 0;
async function worker() {
  while (next < todo.length) {
    const i = next++;
    const t = todo[i];
    const label = `[${i + 1}/${todo.length}] ${t.tournamentId} ${t.title}`;
    try {
      const result = await fetchTournament(t);
      if (result.unfinished) {
        unfinished++;
        console.error(`${label}: not finished (${result.endDate ?? "no date"}), skipped`);
        continue;
      }
      await writeFile(`${OUT}/${t.tournamentId}.json`, JSON.stringify(result));
      console.error(`${label}: ${result.startDate}, ${result.matches.length} singles matches`);
    } catch (err) {
      failed++;
      console.error(`${label}: FAILED ${err.message}`);
      await appendFile(ERRORS, `${new Date().toISOString()} ${t.tournamentId} ${err.message}\n`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.error(`Done. ${todo.length - failed - unfinished} saved, ${unfinished} not finished, ${failed} failed`);
