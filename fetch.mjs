// fetch.mjs — 1×/jour : transferts confirmés (par club, avec ligue) + rumeurs (flux RSS gratuit)
import fs from "node:fs";

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE = "https://v3.football.api-sports.io";
const DATA_FILE = "data.json";
const TEAMS_FILE = "teams.json";
const MAX_ENTRIES = 250, KEEP_DAYS = 90, MIN_REMAINING = 2, DELAY_MS = 7000;
const RSS_URL = "https://www.theguardian.com/football/transfer-window/rss";
const RUMOR_MAX = 30;

if (!API_KEY) { console.error("❌ clé manquante"); process.exit(1); }

const CLUB_LEAGUE = {
33:"Premier League",50:"Premier League",40:"Premier League",42:"Premier League",49:"Premier League",47:"Premier League",34:"Premier League",66:"Premier League",51:"Premier League",48:"Premier League",52:"Premier League",45:"Premier League",55:"Premier League",39:"Premier League",36:"Premier League",35:"Premier League",65:"Premier League",46:"Premier League",41:"Premier League",63:"Premier League",
541:"La Liga",529:"La Liga",530:"La Liga",536:"La Liga",533:"La Liga",531:"La Liga",548:"La Liga",543:"La Liga",532:"La Liga",538:"La Liga",546:"La Liga",728:"La Liga",
496:"Serie A",505:"Serie A",489:"Serie A",492:"Serie A",497:"Serie A",487:"Serie A",499:"Serie A",502:"Serie A",503:"Serie A",500:"Serie A",495:"Serie A",494:"Serie A",
157:"Bundesliga",165:"Bundesliga",173:"Bundesliga",168:"Bundesliga",169:"Bundesliga",161:"Bundesliga",163:"Bundesliga",172:"Bundesliga",160:"Bundesliga",167:"Bundesliga",170:"Bundesliga",182:"Bundesliga",
85:"Ligue 1",81:"Ligue 1",80:"Ligue 1",91:"Ligue 1",79:"Ligue 1",84:"Ligue 1",94:"Ligue 1",83:"Ligue 1",96:"Ligue 1",93:"Ligue 1",82:"Ligue 1",116:"Ligue 1",
211:"Liga Portugal",212:"Liga Portugal",228:"Liga Portugal",217:"Liga Portugal",
194:"Eredivisie",197:"Eredivisie",209:"Eredivisie",201:"Eredivisie",
645:"Süper Lig",611:"Süper Lig",549:"Süper Lig",998:"Süper Lig",
2932:"Saudi Pro League",2939:"Saudi Pro League",2938:"Saudi Pro League",2929:"Saudi Pro League",
1602:"MLS",1609:"MLS",1616:"MLS"
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function parseApiDate(s){
  if(!s) return null;
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(m){var d=new Date(m[1]+"-"+m[2]+"-"+m[3]+"T00:00:00Z");return isNaN(d.getTime())?null:d;}
  m=/^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if(m){var yy=Number(m[3]);var y=yy<=30?2000+yy:1900+yy;var d2=new Date(y+"-"+m[2]+"-"+m[1]+"T00:00:00Z");return isNaN(d2.getTime())?null:d2;}
  var d3=new Date(s);return isNaN(d3.getTime())?null:d3;
}

const teams = JSON.parse(fs.readFileSync(TEAMS_FILE,"utf8"));
const cutoff = Date.now() - KEEP_DAYS*86400000;
const incoming = [];
let remaining = 999;

for (const team of teams) {
  if (remaining <= MIN_REMAINING) break;
  const league = CLUB_LEAGUE[team.id] || "";
  try {
    const res = await fetch(`${BASE}/transfers?team=${team.id}`, { headers: { "x-apisports-key": API_KEY } });
    remaining = Number(res.headers.get("x-ratelimit-requests-remaining") ?? remaining);
    const json = await res.json();
    for (const row of json.response ?? []) {
      const player = row.player?.name ?? "Inconnu";
      for (const t of row.transfers ?? []) {
        const d = parseApiDate(t.date);
        if (!d || d.getTime() < cutoff) continue;
        const iso = d.toISOString().slice(0,10);
        incoming.push({
          id: `${row.player?.id}-${iso}-${t.teams?.in?.id ?? "x"}`,
          kind: "confirmed", player, date: iso, type: t.type ?? null, league,
          from: t.teams?.out?.name ?? "?", fromLogo: t.teams?.out?.logo ?? null,
          to: t.teams?.in?.name ?? "?", toLogo: t.teams?.in?.logo ?? null,
        });
      }
    }
  } catch (e) { console.warn("Erreur", team.name, e.message); }
  await sleep(DELAY_MS);
}

try {
  const r = await fetch(RSS_URL);
  const xml = await r.text();
  const items = xml.split("<item>").slice(1);
  let n = 0;
  for (const it of items) {
    if (n >= RUMOR_MAX) break;
    const t = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const l = (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const p = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    const title = t.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (!title) continue;
    const d = new Date(p);
    const iso = isNaN(d.getTime()) ? new Date().toISOString().slice(0,10) : d.toISOString().slice(0,10);
    incoming.push({
      id: "rss-" + (l || title).slice(0,70),
      kind: "rumor", player: title, date: iso, league: "",
      from: "", to: "", source: "The Guardian",
      link: l.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || null,
    });
    n++;
  }
  console.log("Rumeurs RSS: " + n);
} catch (e) { console.warn("RSS:", e.message); }

let existing = [];
try { existing = JSON.parse(fs.readFileSync(DATA_FILE,"utf8")).transfers ?? []; } catch {}
const byId = new Map();
for (const e of [...existing, ...incoming]) {
  const d = parseApiDate(e.date);
  if (!d || d.getTime() < cutoff) continue;
  byId.set(e.id, e);
}
const merged = [...byId.values()].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,MAX_ENTRIES);
const out = { updatedAt:new Date().toISOString(), lastTeamChecked:teams.length+" clubs + RSS", requestsRemaining:remaining, count:merged.length, transfers:merged };
fs.writeFileSync(DATA_FILE, JSON.stringify(out,null,2));
console.log(`✅ ${merged.length} entrées.`);
