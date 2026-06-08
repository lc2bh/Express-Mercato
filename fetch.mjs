// fetch.mjs — Récupère les transferts récents via API-Football (plan GRATUIT)
// et les écrit dans data.json. Conçu pour tourner via GitHub Actions toutes
// les 15 min, soit ~96 appels/jour (sous la limite gratuite de 100/jour).
//
// Stratégie : 1 seule requête par exécution. On tourne dans la liste des
// équipes (teams.json) en fonction de l'heure, pour répartir le quota sur la
// journée et couvrir un maximum de clubs.

import fs from "node:fs";

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE = "https://v3.football.api-sports.io";
const DATA_FILE = "data.json";
const TEAMS_FILE = "teams.json";

const SLOT_MINUTES = 15;   // doit correspondre au cron du workflow
const MAX_ENTRIES = 120;   // taille max du flux conservé
const KEEP_DAYS = 75;      // on ne garde que les transferts récents
const MIN_REMAINING = 3;   // marge de sécurité sur le quota quotidien

if (!API_KEY) {
  console.error("❌ API_FOOTBALL_KEY manquant (à définir dans les secrets GitHub).");
  process.exit(1);
}

// 1) Équipes suivies
const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, "utf8"));
if (!Array.isArray(teams) || teams.length === 0) {
  console.error("❌ teams.json est vide ou invalide.");
  process.exit(1);
}

// 2) Sélection de l'équipe du créneau courant (rotation déterministe)
const slot = Math.floor(Date.now() / (SLOT_MINUTES * 60 * 1000));
const team = teams[slot % teams.length];
console.log(`Créneau ${slot} → équipe « ${team.name} » (id ${team.id})`);

// 3) Appel API
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

// 4) Transformation en entrées simples, faciles à afficher côté appli
const cutoff = Date.now() - KEEP_DAYS * 86400000;
const incoming = [];
for (const row of json.response ?? []) {
  const player = row.player?.name ?? "Inconnu";
  for (const t of row.transfers ?? []) {
    const d = new Date(t.date).getTime();
    if (Number.isNaN(d) || d < cutoff) continue;
    incoming.push({
      id: `${row.player?.id}-${t.date}-${t.teams?.in?.id ?? "x"}`,
      player,
      date: t.date,
      type: t.type ?? null,
      from: t.teams?.out?.name ?? "?",
      fromLogo: t.teams?.out?.logo ?? null,
      to: t.teams?.in?.name ?? "?",
      toLogo: t.teams?.in?.logo ?? null,
    });
  }
}
console.log(`Transferts récents trouvés pour cette équipe : ${incoming.length}`);

// 5) Fusion avec l'existant + dédoublonnage + tri + plafond
let existing = [];
try {
  existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")).transfers ?? [];
} catch { /* premier passage : data.json n'existe pas encore */ }

const byId = new Map();
for (const e of [...existing, ...incoming]) {
  const d = new Date(e.date).getTime();
  if (Number.isNaN(d) || d < cutoff) continue;
  byId.set(e.id, e);
}
const merged = [...byId.values()]
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, MAX_ENTRIES);

// 6) Écriture
const out = {
  updatedAt: new Date().toISOString(),
  lastTeamChecked: team.name,
  requestsRemaining: remaining,
  count: merged.length,
  transfers: merged,
};
fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
console.log(`✅ data.json écrit : ${merged.length} transferts au total.`);
