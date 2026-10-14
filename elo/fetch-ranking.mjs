// Fetch the official NBF senior singles ranking lists (badmintonportalen.no/NBF/Ranglister/),
// to compare our Elo ratings against.
// Usage: node fetch-ranking.mjs [seasonId...]   (default 2002026 = 2026/2027; "all" = 2002014 to 2002026)
//
// Writes data/ranking/<seasonId>.json: { period, men: [...], women: [...] } with rank, player
// number, internal id (the same id as in our match data), name, club, class and points.
// Finished seasons only keep their final list (a rolling 12 months up to about July 1).
import { mkdirSync, writeFileSync } from "node:fs";
import { call, text } from "./portalen.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const ALL = Array.from({ length: 13 }, (_, i) => String(2002014 + i));
const seasons = process.argv[2] === "all" ? ALL : process.argv.length > 2 ? process.argv.slice(2) : ["2002026"];
const LISTS = { men: "1", women: "3" }; // HS, DS

const args = (season, list, page) => ({
  rankinglistagegroupid: "", rankinglistid: list, seasonid: season, rankinglistversiondate: "",
  agegroupid: "", classid: "", gender: "", clubid: "", searchall: null, regionid: "",
  pointsfrom: "", pointsto: "", rankingfrom: "", rankingto: "", birthdatefromstring: "",
  birthdatetostring: "", agefrom: "", ageto: "", playerid: "", param: "",
  pageindex: String(page), sortfield: "0", getversions: false, getplayer: false,
});

// <tr><td class='rank'>1</td><td class='playerid'>109614</td><td class='name'><a href='/NBF/Spiller/VisSpiller/#36427,...'>Brynjar Hus</a>, NTNUI</td><td class='clas'>E</td><td class='points points'>1224</td></tr>
const ROW =
  /<td class='rank'>(\d+)<\/td><td class='playerid'>(\d+)<\/td><td class='name'><a href='[^']*#(\d+),[^']*'[^>]*>(.*?)<\/a>,?(.*?)<\/td><td class='clas'>(.*?)<\/td><td class='points[^']*'>(\d+)/g;

mkdirSync(`${DIR}data/ranking`, { recursive: true });
for (const season of seasons) {
  const result = { season, fetchedAt: new Date().toISOString() };
  for (const [pool, list] of Object.entries(LISTS)) {
    const rows = [];
    for (let page = 0; ; page++) {
      const { Html: html } = await call("GetRankingListPlayers", args(season, list, page));
      if (page === 0) result.period = text(html.match(/Periode:(.*?)<br/)?.[1] ?? "");
      const found = [...html.matchAll(ROW)].map(([, rank, number, id, name, club, cls, points]) => ({
        rank: +rank, number: +number, id: +id, name: text(name), club: text(club), class: cls, points: +points,
      }));
      rows.push(...found);
      if (!html.includes(`SelectRankingListPage(${page + 1})`)) break;
    }
    result[pool] = rows;
  }
  writeFileSync(`${DIR}data/ranking/${season}.json`, JSON.stringify(result, null, 1));
  console.log(`${season} (${result.period}): ${result.men.length} men, ${result.women.length} women`);
}
