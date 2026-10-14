// Fetch every NBF club with its regional association (krets) from badmintonportalen.no.
// Usage: node fetch-clubs.mjs
//
// Match data names clubs by their short name ("Kristiansand"), while the per-region club
// search (SearchClubInfo) gives full names ("Kristiansand Badmintonklubb"). The club list
// script maps short names to the same club ids, so the two are joined on club id.
// Writes data/clubs.json.
import { writeFile } from "node:fs/promises";
import { call, unescape } from "./portalen.mjs";

const BASE = "https://badmintonportalen.no";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const OUT = new URL("./data/clubs.json", import.meta.url).pathname;
const REGIONS = {
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

// var SportsResultsTeamList = [['NBF', '1'],['Asker', '12'], ...]
async function shortNames() {
  const res = await fetch(`${BASE}/sportsresults/components/clubcomponents/clublistclientscript.aspx?unionid=200`, {
    headers: { "User-Agent": UA },
  });
  const js = await res.text();
  return new Map([...js.matchAll(/\['((?:[^'\\]|\\.)*)', '(\d+)'\]/g)].map(([, name, id]) => [+id, unescape(name)]));
}

// <a href='/NBF/Klub/Info/?clubid=52'>Kristiansand Badmintonklubb</a>
async function regionClubs(regionid) {
  const { html } = await call("SearchClubInfo", {
    clubid: "",
    regionid: String(regionid),
    postalcode1: "",
    postalcode2: "",
    city: "",
    bodyonly: false,
    clubtype: 0,
    categorylist: "",
    pageno: 0,
  });
  return [...html.matchAll(/clubid=(\d+)'>(.*?)<\/a>/g)].map(([, id, name]) => ({ id: +id, fullName: unescape(name) }));
}

const names = await shortNames();
const clubs = [];
for (const [regionId, region] of Object.entries(REGIONS)) {
  const found = await regionClubs(regionId);
  for (const c of found) clubs.push({ id: c.id, name: names.get(c.id) ?? null, fullName: c.fullName, regionId: +regionId, region });
  console.error(`${region}: ${found.length} clubs`);
}
await writeFile(OUT, JSON.stringify(clubs, null, 1));
console.error(`${clubs.length} clubs, ${clubs.filter((c) => !c.name).length} without a short name -> ${OUT}`);
