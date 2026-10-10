import { runAnuvaadhub } from "./anuvaadhub.js";

export async function recognizeImage(imageBase64, mimeType = "image/jpeg", sourceLanguage = "en") {
  if (!["image/jpeg", "image/png"].includes(mimeType)) throw new Error("OCR supports JPG or PNG images.");
  const result = await runAnuvaadhub({ task: "ocr", imageBase64, mimeType, sourceLanguage });
  if (typeof result.text !== "string" || !result.text.trim()) throw new Error("OCR returned no visible text.");
  return result.text;
}
