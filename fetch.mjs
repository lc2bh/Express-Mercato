// fetch.mjs — Une fois par jour, fait le tour de TOUS les clubs de teams.json
// (1 requête par club ≈ 100/jour) et écrit les transferts récents dans data.json.

import fs from "node:fs";

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE = "https://v3.football.api-sports.io";
const DATA_FILE = "data.json";
const TEAMS_FILE = "teams.json";

const MAX_ENTRIES = 200;
const KEEP_DAYS = 90;
const MIN_REMAINING = 2;
const DELAY_MS = 7000;

if (!API_KEY) { console.error("❌ API_FOOTBALL_KEY manquant."); process.exit(1); }

const sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

function parseApiDate(s){
  if(!s) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(m){ var d=new Date(m[1]+"-"+m[2]+"-"+m[3]+"T00:00:00Z"); return isNaN(d.getTime())?null:d; }
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if(m){ var yy=Number(m[3]); var year=yy<=30?2000+yy:1900+yy; var d2=new Date(year+"-"+m[2]+"-"+m[1]+"T00:00:00Z"); return isNaN(d2.getTime())?null:d2; }
  var d3=new Date(s); return isNaN(d3.getTime())?null:d3;
}

const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, "utf8"));
if (!Array.isArray(teams) || teams.length === 0) { console.error("❌ teams.json vide."); process.exit(1); }

const cutoff = Date.now() - KEEP_DAYS * 86400000;
const incoming = [];
let remaining = 999;

for (const team of teams) {
  if (remaining <= MIN_REMAINING) { console.warn("⚠️ Quota presque épuisé — arrêt."); break; }
  try {
    const res = await fetch(`${BASE}/transfers?team=${team.id}`, { headers: { "x-apisports-key": API_KEY } });
    remaining = Number(res.headers.get("x-ratelimit-requests-remaining") ?? remaining);
    const json = await res.json();
    if (json.errors && Object.keys(json.errors).length > 0) console.warn("⚠️", team.name, json.errors);
    for (const row of json.response ?? []) {
      const player = row.player?.name ?? "Inconnu";
      for (const t of row.transfers ?? []) {
        const d = parseApiDate(t.date);
        if (!d || d.getTime() < cutoff) continue;
        const iso = d.toISOString().slice(0, 10);
        incoming.push({
          id: `${row.player?.id}-${iso}-${t.teams?.in?.id ?? "x"}`,
          player, date: iso, type: t.type ?? null,
          from: t.teams?.out?.name ?? "?", fromLogo: t.teams?.out?.logo ?? null,
          to: t.teams?.in?.name ?? "?", toLogo: t.teams?.in?.logo ?? null,
        });
      }
    }
    console.log(`${team.name} → ${incoming.length} cumulés (restant ${remaining})`);
  } catch (e) { console.warn("Erreur", team.name, e.message); }
  await sleep(DELAY_MS);
}

let existing = [];
try { existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")).transfers ?? []; } catch {}
const byId = new Map();
for (const e of [...existing, ...incoming]) {
  const d = parseApiDate(e.date);
  if (!d || d.getTime() < cutoff) continue;
  byId.set(e.id, e);
}
const merged = [...byId.values()].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, MAX_ENTRIES);

const out = { updatedAt: new Date().toISOString(), lastTeamChecked: teams.length + " clubs", requestsRemaining: remaining, count: merged.length, transfers: merged };
fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
console.log(`✅ data.json écrit : ${merged.length} transferts.`);
