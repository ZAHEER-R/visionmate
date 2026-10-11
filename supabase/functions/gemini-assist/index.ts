import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "Gemini is not configured on the server." }, 503);

  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
    const intentMode = body.mode === "intent";
    if (!prompt) return json({ error: "A prompt is required." }, 400);
    if (imageBase64.length > 4_000_000) return json({ error: "Image is too large. Capture a smaller frame." }, 413);
    if (imageBase64 && !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return json({ error: "Unsupported image format." }, 400);
    }

    const configuredModels = (Deno.env.get("GEMINI_MODELS") || "gemini-2.5-flash,gemini-2.5-flash-lite")
      .split(",").map(value => value.trim()).filter(Boolean);
    if (!configuredModels.length) return json({ error: "No Gemini models are configured on the server." }, 503);
    const requestedModel = typeof body.model === "string" && configuredModels.includes(body.model) ? body.model : "";
    const models = requestedModel
      ? [requestedModel, ...configuredModels.filter(model => model !== requestedModel)]
      : configuredModels;
    const parts: Record<string, unknown>[] = [{ text: prompt }];
    if (imageBase64) parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });

    let lastStatus = 0;
    for (const model of models) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
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
