import { APP_CONFIG } from "./config.js";
import { getFirebaseUser } from "./firebase.js";

let clientPromise;
let firebaseClientPromise;

export async function getSupabaseClient() {
  if (!clientPromise) {
    const initialize = (async () => {
      const { url, anonKey } = APP_CONFIG.supabase;
      if (!url || url.includes("YOUR_PROJECT") || !anonKey || anonKey.includes("YOUR_")) return null;
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const client = createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error(`Supabase session error: ${error.message}`);
      if (!data.session) {
        const result = await client.auth.signInAnonymously();
        if (result.error) {
          const disabled = /anonymous.*(?:disabled|not allowed)|(?:disabled|not allowed).*anonymous/i.test(result.error.message);
          const setup = "Enable Anonymous Sign-Ins in Supabase Dashboard → Authentication → Sign In / Providers, then reload VisionMate. This protected session is used for cloud AI and translation.";
          throw new Error(disabled
            ? `Supabase anonymous sign-in is disabled. ${setup}`
            : `Supabase anonymous sign-in failed: ${result.error.message}`);
        }
      }
      return client;
    })();
    clientPromise = initialize.catch(error => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

async function functionErrorMessage(error, operation) {
  let detail = error?.message || "The request failed.";
  const context = error?.context;
  if (context instanceof Response) {
    const response = context.clone();
    try {
      const payload = await response.json();
      if (typeof payload?.error === "string" && payload.error.trim()) detail = payload.error.trim();
      else if (typeof payload?.message === "string" && payload.message.trim()) detail = payload.message.trim();
    } catch (parseError) {
      console.warn("Could not read the Supabase function error response:", parseError);
    }
    return `${operation} (HTTP ${response.status}): ${detail}`;
  }
  if (context instanceof Error && context.message) detail = context.message;
  return `${operation}: ${detail}`;
}

export function getFirebaseDataClient() {
  if (!firebaseClientPromise) {
    firebaseClientPromise = (async () => {
      const user = await getFirebaseUser();
      if (!user) throw new Error("Sign in with Firebase before accessing your account data.");
      const { url, anonKey } = APP_CONFIG.supabase;
      if (!url || url.includes("YOUR_PROJECT") || !anonKey || anonKey.includes("YOUR_")) {
        throw new Error("Supabase is not configured.");
      }
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      return createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        accessToken: async () => {
          const currentUser = await getFirebaseUser();
          return currentUser ? currentUser.getIdToken() : null;
        }
      });
    })().catch(error => {
      firebaseClientPromise = undefined;
      throw error;
    });
  }
  return firebaseClientPromise;
}

export async function invokeAssistant({ prompt, imageBase64, mimeType = "image/jpeg", model, mode }) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("Supabase cloud AI is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in the deployment environment.");
  const { data, error } = await client.functions.invoke("gemini-assist", {
    body: { prompt, imageBase64, mimeType, model, mode }
  });
  if (error) throw new Error(await functionErrorMessage(error, "VisionMate AI request failed"));
  if (typeof data?.text !== "string" || !data.text.trim()) throw new Error("The AI service returned an empty response.");
  return data;
}

export async function translateText({ text, sourceLanguage, targetLanguage }) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("Supabase translation is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in the deployment environment.");
  const { data, error } = await client.functions.invoke("bhashini-translate", {
    body: { text, sourceLanguage, targetLanguage }
  });
  if (error) throw new Error(await functionErrorMessage(error, "Translation failed"));
  if (typeof data?.translation !== "string" || !data.translation.trim()) throw new Error("The translation provider returned no translated text.");
  return data.translation;
}

export async function saveOwnedRecord(table, record) {
  const client = await getFirebaseDataClient();
  const { data, error } = await client.from(table).insert(record).select().single();
  if (error) throw new Error(`Could not save ${table}: ${error.message}`);
  return data;
}

export async function listOwnedRecords(table) {
  const client = await getFirebaseDataClient();
  const { data, error } = await client.from(table).select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return data;
}

export async function deleteOwnedRecord(table, id) {
  const client = await getFirebaseDataClient();
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) throw new Error(`Could not delete ${table}: ${error.message}`);
  return true;
}

export async function saveProfileRecord(profile) {
  const client = await getFirebaseDataClient();
  const user = await getFirebaseUser();
  if (!user) throw new Error("A Supabase sign-in is required before profile sync.");
  const { error } = await client.from("profiles").upsert({
    id: user.uid,
    first_name: profile.firstName || "",
    last_name: profile.lastName || "",
    age: profile.age || null,
    gender: profile.gender || "",
    preferred_language: profile.preferredLanguage || "en",
    email: user.email || profile.email || null,
    auth_provider: user.providerData[0]?.providerId || "firebase"
  });
  if (error) throw new Error(`Could not sync profile: ${error.message}`);
  return true;
}

export async function loadProfileRecord() {
  const client = await getFirebaseDataClient();
  const user = await getFirebaseUser();
  if (!user) return null;
  const { data, error } = await client.from("profiles").select("*").eq("id", user.uid).maybeSingle();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  return data;
}

export async function loadUserSettings() {
  const client = await getFirebaseDataClient();
  const { data, error } = await client.from("user_settings").select("settings").maybeSingle();
  if (error) throw new Error(`Could not load account settings: ${error.message}`);
  return data?.settings || null;
}

export async function saveUserSettings(changes) {
  const client = await getFirebaseDataClient();
  const current = await loadUserSettings();
  const user = await getFirebaseUser();
  if (!user) throw new Error("Sign in before saving account settings.");
  const settings = { ...(current || {}), ...changes };
  const { error } = await client.from("user_settings").upsert({ user_id: user.uid, settings });
  if (error) throw new Error(`Could not save account settings: ${error.message}`);
  return settings;
}

export async function loadLatestConversation() {
  const client = await getFirebaseDataClient();
  const { data: conversation, error: conversationError } = await client
    .from("assistant_conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversationError) throw new Error(`Could not load conversations: ${conversationError.message}`);
  if (!conversation) {
    const { data, error } = await client.from("assistant_conversations")
      .insert({ title: "VisionMate conversation" }).select("id").single();
    if (error) throw new Error(`Could not create a conversation: ${error.message}`);
    return { id: data.id, messages: [] };
  }
  const { data: messages, error: messagesError } = await client.from("assistant_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (messagesError) throw new Error(`Could not load chat history: ${messagesError.message}`);
  return { id: conversation.id, messages };
}

export async function saveChatMessage(conversationId, role, content) {
  const client = await getFirebaseDataClient();
  const user = await getFirebaseUser();
  if (!user) throw new Error("Sign in before saving chat history.");
  const { data, error } = await client.from("assistant_messages").insert({
    conversation_id: conversationId,
    user_id: user.uid,
    role,
    content
  }).select().single();
  if (error) throw new Error(`Could not save chat message: ${error.message}`);
  const { error: updateError } = await client.from("assistant_conversations")
    .update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  if (updateError) throw new Error(`Message saved but conversation timestamp failed: ${updateError.message}`);
  return data;
}

export async function saveActivityEvent(actionType, status = "performed", details = {}) {
  const client = await getFirebaseDataClient();
  const { data, error } = await client.from("activity_events")
    .insert({ action_type: actionType, status, details }).select().single();
  if (error) throw new Error(`Could not save activity event: ${error.message}`);
  return data;
}
