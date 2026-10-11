import { corsHeaders } from "../_shared/cors.ts";
import { anuvaadhubCatalog } from "../_shared/anuvaadhub-catalog.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const languageNames: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi"
};

const languageTokenSuffixes: Record<string, string> = {
  English: "EN",
  Hindi: "HI",
  Tamil: "TA",
  Telugu: "TE",
  Kannada: "KN",
  Malayalam: "ML",
  Punjabi: "PA"
};

function getAccessToken(language: string) {
  const suffix = languageTokenSuffixes[language];
  if (!suffix) return null;
  return Deno.env.get(`ANUVAADHUB_ACCESS_TOKEN_${suffix}`) || Deno.env.get("ANUVAADHUB_ACCESS_TOKEN") || null;
}

function decodeFile(value: unknown, maxBytes: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maxBytes * 4 / 3) + 8) {
    throw new Error("File is missing or larger than the allowed size.");
  }
  const binary = atob(value);
  if (binary.length > maxBytes) throw new Error("File is larger than the allowed size.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const body = await request.json();
    const task = body.task;
    if (!["mt", "asr", "tts", "ocr"].includes(task)) return json({ error: "Unsupported Anuvaadhub task." }, 400);
    const sourceLanguage = languageNames[body.sourceLanguage];
    if (!sourceLanguage) return json({ error: "Unsupported source language." }, 400);
    const targetLanguage = task === "mt" ? languageNames[body.targetLanguage] : "";
    if (task === "mt" && !targetLanguage) return json({ error: "Unsupported target language." }, 400);
    const tokenLanguage = sourceLanguage;
    const accessToken = getAccessToken(tokenLanguage);
    if (!accessToken) {
      const suffix = languageTokenSuffixes[tokenLanguage];
      return json({ error: `Anuvaadhub ${tokenLanguage} key is not configured. Set ANUVAADHUB_ACCESS_TOKEN_${suffix} in Supabase Edge Function secrets.` }, 503);
    }
    const route = anuvaadhubCatalog.find(item =>
      item.task === task &&
      item.sourceLanguage === sourceLanguage &&
      (task !== "mt" || item.targetLanguage === targetLanguage)
    );
    if (!route) return json({ error: `No approved Anuvaadhub model is available for this ${task} language pair.` }, 404);
    if (new Date(route.accessEndsAt).getTime() <= Date.now()) {
      return json({ error: `The supplied Anuvaadhub model access expired on ${route.accessEndsAt}. Refresh the model catalog and access token.` }, 503);
    }

    let response: Response;
    if (task === "mt") {
      const inputText = typeof body.text === "string" ? body.text.trim() : "";
      const words = inputText ? inputText.split(/\s+/u) : [];
      if (!inputText || words.length > 50) return json({ error: "Machine translation accepts 1 to 50 words." }, 400);
      response = await fetch(route.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "access-token": accessToken },
        body: JSON.stringify({ input_text: inputText })
      });
    } else if (task === "tts") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const words = text ? text.split(/\s+/u) : [];
      if (!text || words.length > 30 || /[^\p{L}\p{N}\s]/u.test(text)) {
        return json({ error: "Text-to-speech accepts up to 30 words and letters/numbers/spaces only." }, 400);
      }
      const gender = body.gender === "male" ? "male" : body.gender === "female" ? "female" : "";
      if (!gender) return json({ error: "Choose a male or female provider voice." }, 400);
      response = await fetch(route.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "access-token": accessToken },
        body: JSON.stringify({ text, gender })
      });
    } else {
      const maxBytes = task === "asr" ? 5 * 1024 * 1024 : 5 * 1024 * 1024;
      const fileBytes = decodeFile(task === "asr" ? body.audioBase64 : body.imageBase64, maxBytes);
      const mimeType = task === "asr" ? "audio/wav" : body.mimeType;
      if (task === "asr" && mimeType !== "audio/wav") return json({ error: "Speech recognition requires a WAV audio file." }, 400);
      if (task === "ocr" && !["image/jpeg", "image/png"].includes(mimeType)) return json({ error: "OCR accepts JPG or PNG images only." }, 400);
      const form = new FormData();
      if (task === "asr") form.append("audio_file", new Blob([fileBytes], { type: mimeType }), "visionmate.wav");
      else form.append("file", new Blob([fileBytes], { type: mimeType }), mimeType === "image/png" ? "capture.png" : "capture.jpg");
      response = await fetch(route.apiUrl, {
        method: "POST",
        headers: { "access-token": accessToken },
        body: form
      });
    }

    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== "success") {
      console.error("Anuvaadhub inference failed:", task, response.status, result?.code || "provider error");
      return json({ error: `Anuvaadhub ${task.toUpperCase()} request failed (${response.status}). Check your token, model route, and quota.` }, 502);
    }
    if (task === "mt") {
      const text = result?.data?.output_text;
      return typeof text === "string" && text.trim() ? json({ text, modelId: route.modelId }) : json({ error: "Anuvaadhub returned no translated text." }, 502);
    }
    if (task === "asr") {
      const text = result?.data?.recognized_text;
      return typeof text === "string" && text.trim() ? json({ text, modelId: route.modelId }) : json({ error: "Anuvaadhub returned no recognized speech." }, 502);
    }
    if (task === "ocr") {
      const text = result?.data?.decoded_text;
      return typeof text === "string" && text.trim() ? json({ text, modelId: route.modelId }) : json({ error: "Anuvaadhub returned no OCR text." }, 502);
    }
    const audioUrl = result?.data?.s3_url;
    if (typeof audioUrl !== "string" || !audioUrl.startsWith("https://")) return json({ error: "Anuvaadhub returned an invalid audio URL." }, 502);
    return json({ audioUrl, modelId: route.modelId });
  } catch (error) {
    console.error("Anuvaadhub function error:", error);
    return json({ error: error instanceof Error ? error.message : "The Anuvaadhub request could not be processed." }, 400);
  }
});
