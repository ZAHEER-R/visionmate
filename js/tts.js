import { runAnuvaadhub } from "./anuvaadhub.js";
import { speech } from "./speech.js";

export async function speakWithProvider(text, gender = "female", sourceLanguage = "en") {
  const safeText = String(text || "").normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!safeText) throw new Error("Enter text using letters, numbers, and spaces.");
  if (safeText.split(/\s+/u).length > 30) throw new Error("Anuvaadhub speech accepts up to 30 words.");
  const result = await runAnuvaadhub({ task: "tts", text: safeText, gender, sourceLanguage });
  if (typeof result.audioUrl !== "string" || !result.audioUrl.startsWith("https://")) {
    throw new Error("Anuvaadhub returned an invalid audio link.");
  }
  await speech.playAudio(result.audioUrl);
  return safeText;
}
