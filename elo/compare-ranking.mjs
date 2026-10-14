// Compare our Elo ratings with the official NBF ranking lists (fetch-ranking.mjs, then rate.mjs).
// Usage: node compare-ranking.mjs
//
// For each season's final official list, both systems pick a favourite for every game in the
// 12 months after the list date between two players on that list: the one with more official
// points, and the one with the higher Elo rating at the same date (from data/ratings-weekly.json).
// Also prints the Spearman rank correlation between official points and Elo.
import { readFileSync, readdirSync } from "node:fs";
import { collectGames } from "./rate.mjs";

const DIR = new URL("data/", import.meta.url).pathname;
const DAY_MS = 86_400_000;
const weekly = JSON.parse(readFileSync(`${DIR}ratings-weekly.json`, "utf8")).pools;
const games = collectGames();

// Rating at the end of the last full week before `day`, or null if the player hadn't started yet.
function eloAt(pool, id, day) {
  const h = weekly[pool][id];
  if (!h) return null;
  const i = Math.floor((Date.parse(day) - Date.parse(h.from)) / (7 * DAY_MS)) - 1;
  return i < 0 ? null : h.ratings[Math.min(i, h.ratings.length - 1)];
}

const ranks = (values) => {
  const r = [];
  values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).forEach(([, i], k) => (r[i] = k));
  return r;
};
function spearman(xs, ys) {
  const [a, b, mean] = [ranks(xs), ranks(ys), (xs.length - 1) / 2];
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (a[i] - mean) * (b[i] - mean);
    va += (a[i] - mean) ** 2;
    vb += (b[i] - mean) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

const percent = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-").padStart(6);
const total = { n: 0, official: 0, elo: 0, disagree: 0, eloRight: 0 };
console.log("season   pool   games  official  elo     | disagree: elo right | spearman (players)");
for (const file of readdirSync(`${DIR}ranking`).sort()) {
  const list = JSON.parse(readFileSync(`${DIR}ranking/${file}`, "utf8"));
  const end = list.period.split(" til ")[1].split(".").reverse().join("-"); // "30.06.2026" -> "2026-06-30"
  const until = new Date(Date.parse(end) + 365 * DAY_MS).toISOString().slice(0, 10);
  for (const pool of ["men", "women"]) {
    const points = new Map(list[pool].map((p) => [p.id, p.points]));
    const elo = new Map(list[pool].map((p) => [p.id, eloAt(pool, p.id, end)]));
    const both = list[pool].filter((p) => elo.get(p.id) != null);
    const rho = spearman(both.map((p) => p.points), both.map((p) => elo.get(p.id)));

    const s = { n: 0, official: 0, elo: 0, disagree: 0, eloRight: 0 };
    for (const g of games) {
      if (g.pool !== pool || g.day <= end || g.day > until || g.s === 0.5) continue;
      const [pa, pb, ea, eb] = [points.get(g.a.id), points.get(g.b.id), elo.get(g.a.id), elo.get(g.b.id)];
      if (pa == null || pb == null || ea == null || eb == null || pa === pb || ea === eb) continue;
      const officialRight = pa > pb === (g.s === 1);
      const eloRight = ea > eb === (g.s === 1);
      s.n++;
      s.official += officialRight;
      s.elo += eloRight;
      if (officialRight !== eloRight) {
        s.disagree++;
        s.eloRight += eloRight;
      }
    }
    for (const k in total) total[k] += s[k];
    console.log(
      `${list.season}  ${pool.padEnd(6)} ${String(s.n).padStart(5)}   ${percent(s.official, s.n)}  ${percent(s.elo, s.n)}  | ` +
        `${String(s.disagree).padStart(4)}: ${percent(s.eloRight, s.disagree)}   | ${rho.toFixed(3)} (${both.length})`
    );
  }
}
console.log(
  `Total ${total.n} games: official favourite won ${percent(total.official, total.n).trim()}, ` +
    `Elo favourite ${percent(total.elo, total.n).trim()}. ` +
    `They disagree on ${total.disagree} games; Elo was right in ${percent(total.eloRight, total.disagree).trim()} of them.`
);
