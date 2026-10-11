import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const speechModel = "gemini-3.8-flash-lite-tts";
const speechLanguages: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi"
};

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "Gemini is not configured on the server." }, 503);

  try {
    const body = await request.json();
    const speechMode = body.mode === "speech";
    const speechText = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
    const language = typeof body.language === "string" ? body.language : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
    const intentMode = body.mode === "intent";
    if (speechMode && (!speechText || !speechLanguages[language])) {
      return json({ error: "Text and a supported spoken language are required for speech." }, 400);
    }
    if (!speechMode && !prompt) return json({ error: "A prompt is required." }, 400);
    if (imageBase64.length > 4_000_000) return json({ error: "Image is too large. Capture a smaller frame." }, 413);
    if (imageBase64 && !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return json({ error: "Unsupported image format." }, 400);
    }

    const configuredModels = (Deno.env.get("GEMINI_MODELS") || "gemini-2.5-flash,gemini-2.5-flash-lite")
      .split(",").map(value => value.trim()).filter(Boolean);
    if (!configuredModels.length && !speechMode) return json({ error: "No Gemini models are configured on the server." }, 503);
    const requestedModel = typeof body.model === "string" && configuredModels.includes(body.model) ? body.model : "";
    const models = requestedModel
      ? [requestedModel, ...configuredModels.filter(model => model !== requestedModel)]
      : configuredModels;
    if (speechMode) {
      let spokenText = speechText;
      if (language !== "en") {
        let translated = false;
        let lastTranslationStatus = 0;
        for (const model of configuredModels) {
          const translationResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [{
                  text: `Translate this assistant message into ${speechLanguages[language]}. Return only the translation, preserving its meaning, names, and numbers. Do not answer it or add commentary.\n\n${speechText}`
                }]
              }],
              generationConfig: { temperature: 0, maxOutputTokens: 1000 }
            })
          });
          const translationPayload = await translationResponse.json().catch(() => ({}));
          if (translationResponse.ok) {
            spokenText = (translationPayload?.candidates?.[0]?.content?.parts || [])
              .map((part: { text?: string }) => part.text || "").join("").trim();
            if (spokenText) {
              translated = true;
              break;
            }
          }
          lastTranslationStatus = translationResponse.status;
          if (![404, 429, 503].includes(translationResponse.status)) {
            console.error("Gemini speech translation failed:", translationResponse.status, translationPayload?.error?.message || "Provider error");
            return json({ error: "Gemini could not translate speech into the selected language." }, 502);
          }
        }
        if (!translated) {
          console.error("Gemini speech translation models exhausted; last status:", lastTranslationStatus);
          return json({ error: "Gemini could not translate speech into the selected language. Check model access and try again." }, 503);
        }
      }

      const speechResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: speechModel,
          input: [{ type: "user_input", content: [{ type: "text", text: spokenText }] }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: "Kore" }] },
          store: false
        })
      });
      const speechPayload = await speechResponse.json().catch(() => ({}));
      if (!speechResponse.ok) {
        console.error("Gemini TTS request failed:", speechResponse.status, speechPayload?.error?.message || "Provider error");
        return json({ error: "Gemini could not generate speech audio. Check TTS model access and try again." },
          [404, 429, 503].includes(speechResponse.status) ? 503 : 502);
      }
      type GeminiAudioPart = { type?: string; data?: string; mime_type?: string; mimeType?: string };
      const audioParts: GeminiAudioPart[] = Array.isArray(speechPayload?.steps)
        ? speechPayload.steps.filter((step: { type?: string }) => step.type === "model_output")
          .flatMap((step: { content?: GeminiAudioPart[] }) => Array.isArray(step.content) ? step.content : [])
        : [];
      const audio = audioParts.find(part => part.type === "audio" && typeof part.data === "string");
      if (!audio?.data) return json({ error: "Gemini returned no speech audio." }, 502);
      return json({ audioBase64: audio.data, mimeType: audio.mime_type || audio.mimeType || "audio/wav", model: speechModel });
    }

    const parts: Record<string, unknown>[] = [{ text: prompt }];
    if (imageBase64) parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });

    let lastStatus = 0;
    for (const model of models) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: intentMode
            ? "You are VisionMate's in-app voice command interpreter. Follow the user's prompt schema exactly and return only the requested JSON. Write the user-facing speech value in the language specified by the user prompt. Never claim access to installed apps, the operating system, contacts unless supplied, or device controls. Never identify people or infer emotion, intent, dangerousness, or threat. Never provide walking/crossing directions or claim any route is safe. Do not initiate calls/messages; return only an allowlisted app action for the frontend to present for confirmation."
            : "You are VisionMate, an accessible assistant. Be concise, kind, and state uncertainty. Describe only clearly visible image content. Never declare any path, road, or crossing safe and never give mobility or obstacle-avoidance instructions. For possible visible hazards, state that this is uncertain and may be wrong. AI output must not replace a cane, guide dog, or trusted assistance." }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: intentMode ? 0 : 0.2,
            maxOutputTokens: intentMode ? 350 : 500,
            ...(intentMode ? { responseMimeType: "application/json" } : {})
          }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        const responseParts = payload?.candidates?.[0]?.content?.parts || [];
        const text = responseParts.map((part: { text?: string }) => part.text || "").join("").trim();
        if (!text) return json({ error: "Gemini returned no response text." }, 502);
        return json({ text, model });
      }
      lastStatus = response.status;
      if (![404, 429, 503].includes(response.status)) {
        console.error("Gemini request failed:", response.status, payload?.error?.message || "Provider error");
        return json({ error: "Gemini could not complete the request. Check server configuration and try again." }, 502);
      }
    }
    console.error("Gemini fallback models exhausted; last status:", lastStatus);
    return json({ error: "All configured Gemini models are unavailable or rate-limited. Try again shortly." }, 503);
  } catch (error) {
    console.error("Gemini function error:", error);
    return json({ error: "The AI request could not be processed." }, 500);
  }
});
