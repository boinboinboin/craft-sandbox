// Scan Cup2000 tournament ids and build an editable list of organisers.
// Usage: node list-organisers.mjs [fromId] [toId]
//
// Writes data/tournaments.json (index of every tournament id checked; resumable)
// and organisers.txt (one organiser per line; edit it to keep only the ones to include).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchTournamentInfo } from "./fetch-tournament.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const INDEX = `${DIR}data/tournaments.json`;
const ORGANISERS = `${DIR}organisers.txt`;
const CONCURRENCY = 2;
// Without a toId, keep going past the highest known id until this many ids in a row are empty.
const EMPTY_RUN_TO_STOP = 100;
const NEWEST_HINT = 11000;

const readOr = async (path, fallback) => readFile(path, "utf8").catch(() => fallback);

async function scan(index, from, to) {
  const known = Object.values(index).filter(Boolean).map((t) => t.tournamentId);
  const highest = Math.max(NEWEST_HINT, ...known);
  let next = from;
  let emptyRun = 0;
  let done = 0;
  const finished = () => (to ? next > to : next > highest && emptyRun >= EMPTY_RUN_TO_STOP);

  async function worker() {
    while (!finished()) {
      const id = next++;
      if (id in index) {
        emptyRun = index[id] ? 0 : emptyRun + 1;
        continue;
      }
      try {
        const info = await fetchTournamentInfo(id);
        index[id] = info && { ...info, html: undefined };
        emptyRun = info ? 0 : emptyRun + 1;
      } catch (err) {
        console.error(`${id}: ${err.message}`); // left out of the index, retried next run
      }
      if (++done % 100 === 0) {
        await writeFile(INDEX, JSON.stringify(index));
        console.error(`checked up to ~${id}, ${Object.values(index).filter(Boolean).length} tournaments found`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(INDEX, JSON.stringify(index));
}

const year = (date) => date.match(/\d{4}/)?.[0];

function describe(tournaments) {
  const years = tournaments.map((t) => year(t.date)).filter(Boolean).sort();
  const span = years.length ? (years[0] === years.at(-1) ? years[0] : `${years[0]}-${years.at(-1)}`) : "?";
  const latest = tournaments.reduce((a, b) => (a.tournamentId > b.tournamentId ? a : b));
  const name = latest.name.replace(/\s+/g, " ").trim().slice(0, 80);
  return `# ${tournaments.length} tournament${tournaments.length > 1 ? "s" : ""}, ${span}, e.g. "${name}"`;
}

// Organiser names already in the file, whether active or commented out.
function listedOrganisers(text) {
  return new Set(
    text
      .split("\n")
      .map((line) => line.replace(/^\s*#\s?/, "").split(" #")[0].trim())
      .filter(Boolean)
  );
}

async function writeOrganisers(index) {
  const byOrganiser = new Map();
  for (const t of Object.values(index)) {
    if (!t) continue;
    const key = t.organiser.replace(/\s+/g, " ").trim() || "(no organiser)";
    byOrganiser.set(key, [...(byOrganiser.get(key) ?? []), t]);
  }

  const existing = await readOr(ORGANISERS, "");
  const listed = listedOrganisers(existing);
  const fresh = [...byOrganiser.keys()].filter((o) => !listed.has(o)).sort((a, b) => a.localeCompare(b, "nb"));
  if (!fresh.length) return console.error("organisers.txt: no new organisers");

  const width = Math.min(60, Math.max(...fresh.map((o) => o.length)));
  const lines = fresh.map((o) => `${o.padEnd(width)}  ${describe(byOrganiser.get(o))}`);
  const header = existing
    ? `\n# --- New organisers found ${new Date().toISOString().slice(0, 10)} ---\n`
    : [
        "# Cup2000 organisers to include (Norwegian badminton only).",
        "# One organiser per line. Delete or comment out (#) the ones to exclude.",
        "# Everything after ' #' on a line is just info. Later runs append new organisers at the bottom.",
        "",
        "",
      ].join("\n");
  await writeFile(ORGANISERS, existing + header + lines.join("\n") + "\n");
  console.error(`organisers.txt: added ${fresh.length} organisers`);
}

const [from = 1, to] = process.argv.slice(2).map(Number);
await mkdir(`${DIR}data`, { recursive: true });
const index = JSON.parse(await readOr(INDEX, "{}"));
await scan(index, from, to);
await writeOrganisers(index);
