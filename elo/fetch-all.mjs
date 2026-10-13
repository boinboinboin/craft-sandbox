// Fetch singles results for every tournament run by an organiser in organisers.txt.
// Usage: node fetch-all.mjs [--refetch] [--dry-run]
//
// Reads data/tournaments.json (from list-organisers.mjs) and writes one file per tournament
// to data/tournaments/<id>.json. Already-fetched and not-yet-finished tournaments are skipped,
// so it can be stopped and re-run at any time. Failures are logged to data/fetch-errors.log.
import { readFile, writeFile, mkdir, readdir, appendFile } from "node:fs/promises";
import { fetchTournament } from "./fetch-tournament.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const INDEX = `${DIR}data/tournaments.json`;
const ORGANISERS = `${DIR}organisers.txt`;
const OUT = `${DIR}data/tournaments`;
const ERRORS = `${DIR}data/fetch-errors.log`;

const oneLine = (s) => s.replace(/\s+/g, " ").trim();

function allowedOrganisers(text) {
  return new Set(
    text
      .split("\n")
      .filter((line) => line.trim() && !/^\s*#/.test(line))
      .map((line) => line.split(" #")[0].trim())
  );
}

// "09/10/2026 - 11/10/2026" -> Date of the last day
function endDate(date) {
  const m = date.match(/(\d{2})\/(\d{2})\/(\d{4})\s*$/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59`) : null;
}

const refetch = process.argv.includes("--refetch");
const allowed = allowedOrganisers(await readFile(ORGANISERS, "utf8"));
const index = JSON.parse(await readFile(INDEX, "utf8"));
await mkdir(OUT, { recursive: true });
const done = new Set(refetch ? [] : (await readdir(OUT)).map((f) => f.replace(".json", "")));

const selected = Object.values(index).filter((t) => t && allowed.has(oneLine(t.organiser)));
const unfinished = selected.filter((t) => !(endDate(t.date) < new Date()));
const todo = selected.filter((t) => !unfinished.includes(t) && !done.has(String(t.tournamentId)));

console.error(
  `${selected.length} tournaments from ${allowed.size} organisers: ` +
    `${selected.length - unfinished.length - todo.length} already fetched, ${unfinished.length} not finished, ${todo.length} to fetch`
);

if (process.argv.includes("--dry-run")) process.exit(0);

let failed = 0;
for (const [i, t] of todo.entries()) {
  const label = `[${i + 1}/${todo.length}] ${t.tournamentId} ${t.name}`;
  try {
    const result = await fetchTournament(t.tournamentId);
    await writeFile(`${OUT}/${t.tournamentId}.json`, JSON.stringify(result));
    console.error(`${label}: ${result.matches.length} matches`);
  } catch (err) {
    failed++;
    console.error(`${label}: FAILED ${err.message}`);
    await appendFile(ERRORS, `${new Date().toISOString()} ${t.tournamentId} ${err.message}\n`);
  }
}
console.error(`Done. ${todo.length - failed} fetched, ${failed} failed${failed ? ` (see ${ERRORS})` : ""}`);
