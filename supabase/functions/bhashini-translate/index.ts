import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const userId = Deno.env.get("BHASHINI_USER_ID");
  const apiKey = Deno.env.get("BHASHINI_API_KEY");
  const pipelineId = Deno.env.get("BHASHINI_PIPELINE_ID");
  if (!userId || !apiKey || !pipelineId) return json({ error: "Bhashini translation is not configured on the server." }, 503);

  try {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const sourceLanguage = typeof body.sourceLanguage === "string" ? body.sourceLanguage : "";
    const targetLanguage = typeof body.targetLanguage === "string" ? body.targetLanguage : "";
    if (!text || text.length > 4000 || !sourceLanguage || !targetLanguage) {
      return json({ error: "Provide text (up to 4,000 characters), source language, and target language." }, 400);
    }

    const pipelineResponse = await fetch("https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json", userID: userId, ulcaApiKey: apiKey },
      body: JSON.stringify({
        pipelineTasks: [{ taskType: "translation", config: { language: { sourceLanguage, targetLanguage } } }],
        pipelineRequestConfig: { pipelineId }
      })
    });
    if (!pipelineResponse.ok) {
      console.error("Bhashini pipeline request failed:", pipelineResponse.status);
      return json({ error: "Bhashini could not translate this language pair. Check your pipeline configuration." }, 502);
    }
    const pipeline = await pipelineResponse.json();
    const service = pipeline?.pipelineResponseConfig?.[0];
    const callbackUrl = service?.callbackUrl;
    const config = service?.config;
    if (!callbackUrl || !config) return json({ error: "Bhashini returned an incomplete pipeline configuration." }, 502);

    if (!callbackUrl.startsWith("https://")) return json({ error: "Bhashini returned an invalid callback URL." }, 502);
    const translationResponse = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(service?.headers || {}) },
      body: JSON.stringify({
        pipelineTasks: [{ taskType: "translation", config: { ...config, language: { sourceLanguage, targetLanguage } } }],
        inputData: { input: [{ source: text }] }
      })
    });
    if (!translationResponse.ok) {
      console.error("Bhashini translation request failed:", translationResponse.status);
      return json({ error: "Bhashini translation request failed." }, 502);
    }
    const result = await translationResponse.json();
    const translation = result?.pipelineResponse?.[0]?.output?.[0]?.target;
    if (typeof translation !== "string" || !translation.trim()) return json({ error: "Bhashini returned no translated text." }, 502);
    return json({ translation });
  } catch (error) {
    console.error("Bhashini function error:", error);
    return json({ error: "The translation request could not be processed." }, 500);
  }
});
