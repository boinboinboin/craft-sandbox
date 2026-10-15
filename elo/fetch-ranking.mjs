// Fetch the official NBF senior ranking lists (badmintonportalen.no/NBF/Ranglister/): singles, to
// compare our Elo ratings against, and doubles and mixed doubles (the Eliteserien lineup rules use
// the ranking points).
// Usage: node fetch-ranking.mjs [seasonId...]   (default 2002026 = 2026/2027; "all" = 2002014 to 2002026)
//
// Writes data/ranking/<seasonId>.json: { period, men, women, mensDoubles, womensDoubles, mixedMen,
// mixedWomen } (lists of rank, player number, internal id (the same id as in our match data), name,
// club, class and points; mixed doubles has one list for men and one for women).
// Finished seasons only keep their final list (a rolling 12 months up to about July 1).
//
// Usage: node fetch-ranking.mjs <seasonId> --before <yyyy-mm-dd>
// fetches the latest version of the lists published before that date (they are updated about twice
// a week) into data/ranking/<seasonId>-<version date>.json, e.g. for the ranking at a past match.
import { mkdirSync, writeFileSync } from "node:fs";
import { call, text } from "./portalen.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const ALL = Array.from({ length: 13 }, (_, i) => String(2002014 + i));
const beforeIndex = process.argv.indexOf("--before");
const before = beforeIndex > 0 ? process.argv[beforeIndex + 1] : null;
const plain = process.argv.slice(2).filter((a, i, all) => a !== "--before" && all[i - 1] !== "--before");
const seasons = plain[0] === "all" ? ALL : plain.length ? plain : ["2002026"];
// HS, DS, HD, DD, MD for women, MD for men
const LISTS = { men: "1", women: "3", mensDoubles: "2", womensDoubles: "4", mixedWomen: "5", mixedMen: "6" };

const args = (season, list, page, version = "") => ({
  rankinglistagegroupid: version ? "2001" : "", rankinglistid: list, seasonid: season, rankinglistversiondate: version,
  agegroupid: "", classid: "", gender: "", clubid: "", searchall: null, regionid: "",
  pointsfrom: "", pointsto: "", rankingfrom: "", rankingto: "", birthdatefromstring: "",
  birthdatetostring: "", agefrom: "", ageto: "", playerid: "", param: "",
  pageindex: String(page), sortfield: "0", getversions: false, getplayer: false,
});

// <tr><td class='rank'>1</td><td class='playerid'>109614</td><td class='name'><a href='/NBF/Spiller/VisSpiller/#36427,...'>Brynjar Hus</a>, NTNUI</td><td class='clas'>E</td><td class='points points'>1224</td></tr>
const ROW =
  /<td class='rank'>(\d+)<\/td><td class='playerid'>(\d+)<\/td><td class='name'><a href='[^']*#(\d+),[^']*'[^>]*>(.*?)<\/a>,?(.*?)<\/td><td class='clas'>(.*?)<\/td><td class='points[^']*'>(\d+)/g;

mkdirSync(`${DIR}data/ranking`, { recursive: true });
// The latest list version (MM/DD/YYYY, as the service takes it) published before a date (yyyy-mm-dd)
async function versionBefore(season, date) {
  const { Versions: versions } = await call("GetRankingListPlayers", { ...args(season, "1", 0), getversions: true });
  const iso = (v) => v.replace(/^(\d\d)\/(\d\d)\/(\d{4})$/, "$3-$1-$2");
  return versions.map((v) => v.Value).filter((v) => v && iso(v) < date).sort((a, b) => iso(b).localeCompare(iso(a)))[0];
}

for (const season of seasons) {
  const version = before ? await versionBefore(season, before) : "";
  if (before && !version) throw new Error(`No ${season} ranking version before ${before}`);
  const result = { season, version: version ? version.replace(/^(\d\d)\/(\d\d)\/(\d{4})$/, "$3-$1-$2") : null, fetchedAt: new Date().toISOString() };
  for (const [pool, list] of Object.entries(LISTS)) {
    const rows = [];
    for (let page = 0; ; page++) {
      const { Html: html } = await call("GetRankingListPlayers", args(season, list, page, version));
      if (page === 0) result.period = text(html.match(/Periode:(.*?)<br/)?.[1] ?? "");
      const found = [...html.matchAll(ROW)].map(([, rank, number, id, name, club, cls, points]) => ({
        rank: +rank, number: +number, id: +id, name: text(name), club: text(club), class: cls, points: +points,
      }));
      rows.push(...found);
      if (!html.includes(`SelectRankingListPage(${page + 1})`)) break;
    }
    result[pool] = rows;
  }
  writeFileSync(`${DIR}data/ranking/${season}${result.version ? `-${result.version}` : ""}.json`, JSON.stringify(result, null, 1));
  console.log(`${season} (${result.period}): ${Object.keys(LISTS).map((pool) => `${result[pool].length} ${pool}`).join(", ")}`);
}
