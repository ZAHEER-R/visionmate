import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const envFile = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const fileValues = Object.fromEntries(envFile.split(/\r?\n/u).flatMap(line => {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
  if (!match) return [];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [[match[1], value]];
}));
const getValue = name => (process.env[name] || fileValues[name] || "").trim();
const getPublicValue = name => {
  const value = getValue(name);
  return !value || /^(YOUR_|CHANGE_ME)/iu.test(value) ? "" : value;
};

const supabaseUrl = getPublicValue("SUPABASE_URL");
const supabaseAnonKey = getPublicValue("SUPABASE_ANON_KEY");
const firebaseConfig = {
  apiKey: getPublicValue("FIREBASE_API_KEY"),
  authDomain: getPublicValue("FIREBASE_AUTH_DOMAIN"),
  projectId: getPublicValue("FIREBASE_PROJECT_ID"),
  appId: getPublicValue("FIREBASE_APP_ID"),
  databaseURL: getPublicValue("FIREBASE_DATABASE_URL")
};

if (supabaseUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL is invalid.");
  }
  if (!["https:", "http:"].includes(parsedUrl.protocol)) throw new Error("SUPABASE_URL must use HTTP or HTTPS.");
}

if (firebaseConfig.authDomain?.includes("/")) {
  throw new Error("FIREBASE_AUTH_DOMAIN is invalid.");
}

const config = {};
if (supabaseUrl || supabaseAnonKey) {
  config.supabase = {
    ...(supabaseUrl ? { url: new URL(supabaseUrl).toString().replace(/\/$/u, "") } : {}),
    ...(supabaseAnonKey ? { anonKey: supabaseAnonKey } : {})
  };
}
const configuredFirebase = Object.fromEntries(Object.entries(firebaseConfig).filter(([, value]) => value));
if (Object.keys(configuredFirebase).length) config.firebase = configuredFirebase;

fs.writeFileSync(
  path.join(root, "js", "runtime-config.js"),
  `globalThis.VISIONMATE_CONFIG = Object.freeze(${JSON.stringify(config)});\n`,
  "utf8"
);
console.log("Generated optional public browser configuration. Firebase sign-in is optional; no private provider keys were included.");
