// Fetch every player registered on badmintonportalen.no (NBF), with their unique ids.
// Usage: node fetch-players.mjs
//
// The SearchPlayer service returns at most 100 players per query, but the player number
// filter is a prefix match and all numbers are six digits (10xxxx-11xxxx). So we query
// prefixes and split any truncated one into ten longer prefixes until nothing is truncated.
// Writes data/players.json.
import { writeFile, mkdir } from "node:fs/promises";
import { call, unescape } from "./portalen.mjs";

const START_PREFIXES = ["10", "11"];
const OUT = new URL("./data/players.json", import.meta.url).pathname;

async function searchByNumberPrefix(prefix) {
  const d = await call("SearchPlayer", {
    selectfunction: "SPSel1",
    name: "",
    clubid: "",
    playernumber: prefix,
    gender: "",
    agegroupid: "",
    searchteam: false,
    licenseonly: false,
    agegroupcontext: 0,
    tournamentdate: "",
  });
  return { truncated: d.ListTruncated, players: parseRows(d.Html) };
}

// Each row: onclick="SPSel1('internalId', 'playerNumber', 'Name', 'clubId', 'Club', 'M|K')"
function parseRows(html) {
  return [...html.matchAll(/SPSel1\('(\d*)', '(\d*)', '(.*?)', '(\d*)', '(.*?)', '(\w*)'\)/g)].map(
    ([, id, number, name, clubId, club, gender]) => ({
      id: +id,
      number: number && +number,
      name: unescape(name).replace(/\s+/g, " ").trim(),
      clubId: clubId && +clubId,
      club: unescape(club),
      gender,
    })
  );
}

const players = new Map();
const queue = [...START_PREFIXES];
let requests = 0;
while (queue.length) {
  const prefix = queue.shift();
  const { truncated, players: found } = await searchByNumberPrefix(prefix);
  requests++;
  for (const p of found) players.set(p.id, p);
  if (truncated) queue.push(...Array.from({ length: 10 }, (_, i) => prefix + i));
  if (requests % 50 === 0) console.error(`${requests} requests, ${players.size} players, ${queue.length} prefixes queued`);
}

await mkdir(new URL("./data", import.meta.url).pathname, { recursive: true });
const list = [...players.values()].sort((a, b) => a.number - b.number);
await writeFile(OUT, JSON.stringify(list, null, 1));
console.error(`Done: ${list.length} players from ${requests} requests -> ${OUT}`);
