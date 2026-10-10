import { runAnuvaadhub } from "./anuvaadhub.js";
import { translateText as translateWithBhashini } from "./supabase.js";

export async function machineTranslate({ text, sourceLanguage, targetLanguage, provider = "anuvaadhub" }) {
  if (provider === "bhashini") {
    return translateWithBhashini({ text, sourceLanguage, targetLanguage });
  }
  if (provider !== "anuvaadhub") throw new Error("Select a supported translation provider.");
  const normalized = String(text || "").trim();
  if (!normalized || normalized.split(/\s+/u).length > 50) {
    throw new Error("Anuvaadhub machine translation accepts 1 to 50 words.");
  }
  const result = await runAnuvaadhub({ task: "mt", text: normalized, sourceLanguage, targetLanguage });
  if (typeof result.text !== "string" || !result.text.trim()) throw new Error("Anuvaadhub returned no translation.");
  return result.text;
}
