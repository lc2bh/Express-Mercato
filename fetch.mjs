// fetch.mjs — Récupère les transferts récents via API-Football (plan GRATUIT)
// et les écrit dans data.json. Conçu pour tourner via GitHub Actions toutes
// les 15 min, soit ~96 appels/jour (sous la limite gratuite de 100/jour).

import fs from "node:fs";

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE = "https://v3.football.api-sports.io";
const DATA_FILE = "data.json";
const TEAMS_FILE = "teams.json";

const SLOT_MINUTES = 15;
const MAX_ENTRIES = 120;
const KEEP_DAYS = 90;      // on ne garde que les transferts des ~90 derniers jours
const MIN_REMAINING = 3;

if (!API_KEY) {
  console.error("❌ API_FOOTBALL_KEY manquant (à définir dans les secrets GitHub).");
  process.exit(1);
}

// L'API renvoie les dates au format compact "JJMMAA" (ex : 190806 = 19/08/2006).
// On gère aussi le format ISO "AAAA-MM-JJ". Renvoie un objet Date ou null.
function parseApiDate(s) {
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const [, dd, mm, yy] = m;
    const year = Number(yy) <= 30 ? 2000 + Number(yy) : 1900 + Number(yy);
    const d = new Date(`${year}-${mm}-${dd}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, "utf8"));
if (!Array.isArray(teams) || teams.length === 0) {
  console.error("❌ teams.json est vide ou invalide.");
  process.exit(1);
}

const slot = Math.floor(Date.now() / (SLOT_MINUTES * 60 * 1000));
const team = teams[slot % teams.length];
console.log(`Créneau ${slot} → équipe « ${team.name} » (id ${team.id})`);

const res = await fetch(`${BASE}/transfers?team=${team.id}`, {
  headers: { "x-apisports-key": API_KEY },
});

const remaining = Number(res.headers.get("x-ratelimit-requests-remaining") ?? "999");
console.log(`Requêtes restantes aujourd'hui : ${remaining}`);
if (remaining <= MIN_REMAINING) {
  console.warn("⚠️ Quota presque épuisé — on s'arrête par sécurité.");
  process.exit(0);
}

const json = await res.json();
if (json.errors && Object.keys(json.errors).length > 0) {
  console.error("❌ Erreur API :", json.errors);
  process.exit(1);
}

const cutoff = Date.now() - KEEP_DAYS * 86400000;
const incoming = [];
for (const row of json.response ?? []) {
  const player = row.player?.name ?? "Inconnu";
  for (const t of row.transfers ?? []) {
    const d = parseApiDate(t.date);
    if (!d || d.getTime() < cutoff) continue;
    const iso = d.toISOString().slice(0, 10);
    incoming.push({
      id: `${row.player?.id}-${iso}-${t.teams?.in?.id ?? "x"}`,
      player,
      date: iso,
      type: t.type ?? null,
      from: t.teams?.out?.name ?? "?",
      fromLogo: t.teams?.out?.logo ?? null,
      to: t.teams?.in?.name ?? "?",
      toLogo: t.teams?.in?.logo ?? null,
    });
  }
}
console.log(`Transferts récents trouvés pour cette équipe : ${incoming.length}`);

let existing = [];
try {
  existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")).transfers ?? [];
} catch {}

const byId = new Map();
for (const e of [...existing, ...incoming]) {
  const d = parseApiDate(e.date);
  if (!d || d.getTime() < cutoff) continue;
  byId.set(e.id, e);
}
const merged = [...byId.values()]
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, MAX_ENTRIES);

const out = {
  updatedAt: new Date().toISOString(),
  lastTeamChecked: team.name,
  requestsRemaining: remaining,
  count: merged.length,
  transfers: merged,
};
fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
console.log(`✅ data.json écrit : ${merged.length} transferts au total.`);
