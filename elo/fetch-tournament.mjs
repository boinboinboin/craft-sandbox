// Fetch all match results for one Cup2000 tournament.
// Usage: node fetch-tournament.mjs <tournamentid> [outfile.json]
import { writeFile } from "node:fs/promises";

const BASE = "https://www.cup2000.com";
const SERVICE = `${BASE}/Publisher/SearchTournamentsService.aspx`;
// The service answers 455 to non-browser user agents.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const DELAY_MS = 250;
// Event type (e=) is fixed across tournaments: 0 men's singles, 1 men's doubles,
// 2 women's singles, 3 women's doubles, 4 mixed doubles. Some tournaments put
// mixed-gender singles under 0 or 2 as well.
const SINGLES_EVENTS = new Set(["0", "2"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 1) {
  await sleep(DELAY_MS);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    if (attempt < 3) return get(url, attempt + 1);
    throw new Error(`${res.status} for ${url}`);
  }
  return res.text();
}

// Returns null for tournaments that don't exist (empty body).
async function service(id, params = {}) {
  const body = await get(`${SERVICE}?${new URLSearchParams({ tournamentid: id, ...params })}`);
  return body ? JSON.parse(body) : null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescape = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);

const stripTags = (s) => unescape(s.replace(/<[^>]*>/g, "")).trim();
const oneLine = (s) => s.replace(/\s+/g, " ").trim();

// "Name, Club" -> { name, club }
function parsePlayer(s) {
  const str = unescape(s);
  const i = str.lastIndexOf(", ");
  return i === -1 ? { name: str, club: null } : { name: str.slice(0, i), club: str.slice(i + 2) };
}

// Match array layout (from SearchTournaments.js):
// [0] match no, [2] time, [3] score, [4] event title, [5] winner (1|2),
// [6]/[7] side names (empty in draw pages), [8]/[9] player index into the draw's player list,
// [17]/[18] side withdrawn
function parseMatch(m, players, ctx) {
  const side = (names, idx) => (names.length ? names : players.get(idx) ?? []).map(parsePlayer);
  const score = m[3] ?? "";
  return {
    ...ctx,
    matchNo: m[0],
    time: m[2],
    score,
    walkover: /w\.?o/i.test(score),
    winner: m[5],
    side1: side(m[6], m[8]),
    side2: side(m[7], m[9]),
  };
}

// renderMethod 3: one group. data = [title, standings, [matches, venues], ...]
function parseGroup(data, ctx) {
  const players = new Map(data[1].map((row) => [row[0], row[5]]));
  return data[2][0].map((m) => parseMatch(m, players, { ...ctx, draw: unescape(data[0]) }));
}

// renderMethod 4: knockout. data = [title, players, [[round, [matches, venues]], ...]]
function parseKnockout(data, ctx) {
  const players = new Map(data[1].map((row) => [row[0], row[3]]));
  return data[2].flatMap(([round, [matches]]) =>
    matches.map((m) => parseMatch(m, players, { ...ctx, draw: unescape(data[0]), round }))
  );
}

function parseDrawPage(res, ctx) {
  if (res.renderMethod === 3) return parseGroup(res.data, ctx);
  if (res.renderMethod === 4) return parseKnockout(res.data, ctx);
  throw new Error(`Unhandled renderMethod ${res.renderMethod} for ${JSON.stringify(ctx)}`);
}

async function fetchEvent(id, c, e, ctx) {
  const res = await service(id, { c, e });
  if (res.renderMethod !== 2) return parseDrawPage(res, ctx);

  // Event with several draws: [p, groupCount (0 = knockout), title, ...]
  const matches = [];
  for (const [p, groups] of res.data) {
    if (groups > 0) {
      for (let g = 1; g <= groups; g++) matches.push(...parseDrawPage(await service(id, { c, e, p, g }), ctx));
    } else {
      matches.push(...parseDrawPage(await service(id, { c, e, p }), ctx));
    }
  }
  return matches;
}

// Name, organiser and date from the tournament front page, or null if the id doesn't exist.
export async function fetchTournamentInfo(id) {
  const front = await service(id);
  if (!front) return null;
  const html = front.data;
  const field = (label) => stripTags(html.match(new RegExp(`${label}</span></td><td>(.*?)</td>`))?.[1] ?? "");

  // The name is only in the page title, not in the service response.
  const page = await get(`${BASE}/tournament-software/show-tournaments/?tournamentid=${id}`);
  const name = oneLine(unescape(page.match(/#\d+:\s*([^<]+)</)?.[1] ?? ""));

  return { tournamentId: +id, name, organiser: oneLine(field("Organiser")), date: field("Date"), html };
}

export async function fetchTournament(id) {
  const info = await fetchTournamentInfo(id);
  if (!info) throw new Error(`Tournament ${id} not found`);
  const { html, ...meta } = info;

  // Class rows: <tr><td>SEN E</td><td><a href="?tournamentid=..&c=0&e=4" ...>Mixed double</a> ...
  const events = [];
  for (const [, cls, links] of html.matchAll(/<tr><td>([^<]+)<\/td><td>(.*?)<\/td><\/tr>/g)) {
    for (const [, c, e, ev] of links.matchAll(/[?&]c=(\d+)&e=(\d+)"[^>]*>([^<]+)</g)) {
      if (SINGLES_EVENTS.has(e)) events.push({ c, e, className: unescape(cls), eventName: unescape(ev) });
    }
  }

  const matches = [];
  for (const { c, e, className, eventName } of events) {
    const eventMatches = await fetchEvent(id, c, e, { className, eventName });
    matches.push(...eventMatches.filter((m) => m.side1.length === 1 && m.side2.length === 1));
  }

  const byNo = new Map(matches.map((m) => [m.matchNo, m]));
  return {
    ...meta,
    fetchedAt: new Date().toISOString(),
    events: events.length,
    matches: [...byNo.values()],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, out] = process.argv.slice(2);
  if (!id) {
    console.error("Usage: node fetch-tournament.mjs <tournamentid> [outfile.json]");
    process.exit(1);
  }
  const t = await fetchTournament(id);
  const played = t.matches.filter((m) => m.winner === 1 || m.winner === 2);
  console.error(`${t.name} (${t.date}): ${t.events} events, ${t.matches.length} matches, ${played.length} with a winner`);
  const json = JSON.stringify(t, null, 2);
  if (out) await writeFile(out, json);
  else console.log(json);
}
