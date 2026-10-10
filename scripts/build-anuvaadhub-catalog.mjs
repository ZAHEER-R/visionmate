import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] || path.join(root, "megathon_access_1791662430977.json");
const destination = path.join(root, "supabase", "functions", "_shared", "anuvaadhub-catalog.ts");
const rows = JSON.parse(fs.readFileSync(source, "utf8"));
const languages = new Set(["English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Punjabi"]);
const tasks = new Set(["mt", "asr", "tts", "ocr"]);
const unique = new Map();

for (const row of rows) {
  if (!tasks.has(row.model_type) || row.status !== "approved" || !languages.has(row.source_language)) continue;
  if (row.model_type === "mt" && !languages.has(row.target_language)) continue;
  const api = new URL(row.api_url);
  if (api.protocol !== "https:" || api.hostname !== "canvas.iiit.ac.in" || api.username || api.password || api.search || api.hash) {
    throw new Error(`Rejected nonstandard API URL for model ${row.model_id}`);
  }
  const key = row.model_type === "mt"
    ? `${row.model_type}:${row.source_language}:${row.target_language}`
    : `${row.model_type}:${row.source_language}`;
  if (unique.has(key)) continue;
  unique.set(key, {
    task: row.model_type,
    sourceLanguage: row.source_language,
    ...(row.target_language ? { targetLanguage: row.target_language } : {}),
    modelId: String(row.model_id),
    apiUrl: api.toString(),
    accessEndsAt: row.access_end_date,
    requestsPerMinute: Number(row.requests_per_minute) || null
  });
}

fs.writeFileSync(destination, `export const anuvaadhubCatalog = ${JSON.stringify([...unique.values()], null, 2)} as const;\n`, { flag: "w" });
console.log(`Wrote ${unique.size} sanitized model routes. Provider access tokens were not copied.`);
