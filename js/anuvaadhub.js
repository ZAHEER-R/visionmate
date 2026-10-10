import { APP_CONFIG } from "./config.js";
import { getSupabaseClient } from "./supabase.js";

const languageNames = Object.freeze({
  en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", pa: "Punjabi"
});

export async function runAnuvaadhub(payload) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("Connect the Supabase project before using Anuvaadhub models.");
  const sourceLanguage = payload.sourceLanguage ? languageNames[payload.sourceLanguage] : undefined;
  const targetLanguage = payload.targetLanguage ? languageNames[payload.targetLanguage] : undefined;
  const { data, error } = await client.functions.invoke("anuvaadhub-inference", {
    body: { ...payload, sourceLanguage, targetLanguage }
  });
  if (error) throw new Error(`Anuvaadhub request failed: ${error.message}`);
  if (typeof data?.error === "string") throw new Error(data.error);
  return data;
}

export function supportedProviderLanguages() {
  return Object.keys(APP_CONFIG.languages).filter(code => languageNames[code]);
}
