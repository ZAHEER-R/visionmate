import { APP_CONFIG } from "./config.js";
import { auth } from "./auth.js";
import { speech } from "./speech.js";
import { CameraController } from "./camera.js";
import { answerFor } from "./intent.js";
import { animateView, pressFeedback, setVisionActive } from "./gsap-animations.js";
import {
  getSupabaseClient, invokeAssistant, saveOwnedRecord, listOwnedRecords, deleteOwnedRecord, saveProfileRecord,
  loadLatestConversation, saveChatMessage, saveActivityEvent, loadUserSettings, saveUserSettings
} from "./supabase.js";
import { machineTranslate } from "./mt.js";
import { recognizeImage } from "./cv.js";
import { speakWithProvider } from "./tts.js";
import { recordWav, stopRecording } from "./stt.js";
import { runAnuvaadhub } from "./anuvaadhub.js";
import { saveFirebaseProfile } from "./firebase.js";

const root = document.querySelector("#view-root");
const nav = document.querySelector("#bottom-nav");
const state = {
  page: "welcome",
  profile: auth.getProfile() || {},
  onboarding: {},
  authMode: null,
  authStep: 0,
  visionActive: false,
  camera: null,
  map: null,
  mapMarker: null,
  locationWatchId: null,
  menuPhotoUrl: null,
  pendingCall: null,
  conversationId: null,
  conversationPromise: null,
  conversationHistoryLoaded: false,
  recordingPromise: null,
  scheduledReminders: new Set(),
  batteryAlerts: localStorage.getItem("visionmate.batteryAlerts") !== "off",
  permissionChecked: false,
  language: localStorage.getItem("visionmate.language") || APP_CONFIG.defaultLanguage,
  translation: ""
};

speech.setLanguage(state.language);

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const languageOptions = (selected = state.language) => Object.entries(APP_CONFIG.languages).map(([key, item]) =>
  `<option value="${key}" ${selected === key ? "selected" : ""}>${item.name}</option>`).join("");
const icon = (name) => {
  const icons = {
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>',
    language: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h12M10 3v2m5 0c0 6-4 10-9 12m1-8c1.5 3 4.5 6 8 7m-1 3 4-9 4 9m-6.5-3h5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>'
  };
  return icons[name] || "";
};

function setPage(page, announce = true) {
  if (page !== "vision" && state.locationWatchId !== null) {
    navigator.geolocation?.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
  }
  state.page = page;
  const pages = {
    welcome: renderWelcome,
    onboarding: renderOnboarding,
    auth: renderAuth,
    home: renderHome,
    vision: renderVision,
    voice: renderVoice,
    translate: renderTranslate,
    me: renderMe,
    permissions: renderPermissions
  };
  (pages[page] || renderHome)();
  nav.hidden = !auth.getSession();
  nav.querySelectorAll("[data-nav]").forEach(button => {
    if (button.dataset.nav === page) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const target = root.firstElementChild;
  animateView(target);
  document.querySelector("#main-content").focus({ preventScroll: true });
  if (announce) speech.speak(pageAnnouncement(page));
}

function selectedGeminiModel() {
  const preference = localStorage.getItem("visionmate.model") || "auto";
  return preference === "auto" ? undefined : preference;
}

function pageAnnouncement(page) {
  const messages = {
    welcome: "Welcome to VisionMate. Your eyes, your voice, your independence.",
    onboarding: "Let’s get to know you. I’ll ask a few short questions.",
    auth: "Choose how you would like to continue.",
    home: `Welcome${state.profile.firstName ? `, ${state.profile.firstName}` : ""}. Home is ready.`,
    vision: "Vision companion. Camera preview and demo guidance. This prototype cannot detect hazards.",
    voice: "Voice agent. Ask a question or type a command.",
    translate: "Translator. Enter text and choose a language.",
    me: "Profile and settings.",
    permissions: "Permission setup. You control whether each permission is allowed."
  };
  return messages[page] || "";
}

function renderWelcome() {
  root.innerHTML = `<div class="page">
    <div class="welcome-grid">
      <section class="hero-title">
        <div class="eyebrow">A companion by your side</div>
        <h1>Your world,<br><span>within reach.</span></h1>
        <p class="lead">A voice-first companion designed to make everyday moments feel more connected. Start with a warm hello, and we’ll take it one step at a time.</p>
        <div class="hero-actions">
          <button class="button button-primary" type="button" data-action="start-onboarding">Meet VisionMate ${icon("arrow")}</button>
          <button class="button button-secondary" type="button" data-action="login">I already have an account</button>
        </div>
        <p class="footer-note">Your eyes, your voice, your independence.<br>Prototype note: this app does not yet detect hazards or provide reliable navigation.</p>
      </section>
      <aside class="hero-art" aria-label="VisionMate voice companion visual">
        <div class="hero-orb">${icon("eye")}</div>
        <div class="orb-caption"><span>A familiar voice, whenever you need one</span><span>MADE TO BE BESIDE YOU</span></div>
      </aside>
    </div>
    <div class="card-grid">
      <article class="feature-card" data-animate><div class="feature-icon">${icon("eye")}</div><h3>See more together</h3><p>A camera preview and spoken companion tools, built with accessibility in mind.</p></article>
      <article class="feature-card" data-animate><div class="feature-icon">${icon("mic")}</div><h3>Just say what you need</h3><p>Talk or type to explore the voice agent and phone-control demo.</p></article>
      <article class="feature-card" data-animate><div class="feature-icon">${icon("shield")}</div><h3>Your choices come first</h3><p>You stay in control of your profile, language, and device permissions.</p></article>
    </div>
  </div>`;
}

function renderOnboarding() {
  const fields = [
    { key: "heardFrom", label: "How did you hear about VisionMate?", type: "text", placeholder: "A friend, an organization, online…" },
    { key: "firstName", label: "What’s your first name?", type: "text", placeholder: "First name" },
    { key: "lastName", label: "And your last name?", type: "text", placeholder: "Last name" },
    { key: "age", label: "How old are you?", type: "number", placeholder: "Age", min: 1, max: 120 },
    { key: "gender", label: "How would you like to describe your gender?", type: "select", options: ["Woman", "Man", "Non-binary", "Prefer not to say", "Self-describe"] }
  ];
  const index = state.authStep;
  const field = fields[index];
  const value = state.onboarding[field.key] || "";
  const input = field.type === "select"
    ? `<select id="onboarding-value" name="${field.key}" aria-label="${field.label}" required><option value="">Choose an option</option>${field.options.map(option => `<option ${value === option ? "selected" : ""}>${option}</option>`).join("")}</select>`
    : `<input id="onboarding-value" name="${field.key}" type="${field.type}" value="${escapeHtml(value)}" placeholder="${field.placeholder}" ${field.min ? `min="${field.min}" max="${field.max}"` : ""} required autocomplete="${field.key === "firstName" ? "given-name" : field.key === "lastName" ? "family-name" : "off"}>`;
  root.innerHTML = `<div class="page"><div class="auth-wrap"><section class="panel">
    <div class="eyebrow">A little about you · ${index + 1} of ${fields.length}</div>
    <h2>${field.label}</h2>
    <p class="lead">You can answer by voice or use the large field below. You can edit these details later.</p>
    <div class="form-stack"><div class="field"><label for="onboarding-value">${field.label}</label>${input}</div></div>
    <div class="progress-dots" aria-label="Question ${index + 1} of ${fields.length}">${fields.map((_, i) => `<span class="${i === index ? "current" : i < index ? "done" : ""}"></span>`).join("")}</div>
    <div class="form-actions"><button type="button" class="button button-primary" data-action="onboarding-next">${index === fields.length - 1 ? "Save and continue" : "Continue"} ${icon("arrow")}</button><button type="button" class="button button-secondary" data-action="listen-onboarding">${icon("mic")} Answer by voice</button>${index > 0 ? '<button type="button" class="mini-link" data-action="onboarding-back">Go back</button>' : '<button type="button" class="mini-link" data-action="back-welcome">Go back</button>'}</div>
  </section></div></div>`;
  requestAnimationFrame(() => document.querySelector("#onboarding-value")?.focus({ preventScroll: true }));
}

function renderAuth() {
  const mode = state.authMode;
  if (!mode) {
    const firebaseReady = APP_CONFIG.firebase.apiKey && !APP_CONFIG.firebase.apiKey.startsWith("YOUR_");
    root.innerHTML = `<div class="page"><div class="auth-wrap"><section class="panel">
      <div class="eyebrow">Your account, your way</div><h2>How would you like to continue?</h2>
      <p class="lead">Your profile is saved on this device. Sign in to connect an account, or continue with Google.</p>
      <div class="integration-status ${firebaseReady ? "" : "integration-pending"}"><span class="status-dot"></span><div><strong>Google sign-in</strong><span>${firebaseReady ? "Firebase configuration found. Google provider must also be enabled in Firebase Authentication." : "Setup required · Add your web app configuration and enable Google provider in Firebase Authentication."}</span></div></div>
      <div class="choice-grid">
        <button class="button button-secondary" type="button" data-action="google">${icon("arrow")} Continue with Google</button>
        <button class="button button-secondary" type="button" data-action="auth-mode" data-mode="create">Create account with email</button>
        <button class="button button-secondary" type="button" data-action="auth-mode" data-mode="login">Log in with email</button>
        <button class="button button-secondary" type="button" data-action="auth-mode" data-mode="reset">Forgot password</button>
      </div>
      <p class="footer-note">${firebaseReady ? "Google and email sign-in use Firebase Authentication." : "Account actions are disabled until Firebase is configured; VisionMate will not create a fake login session."}</p>
      <a class="mini-link" href="./README.md" target="_blank" rel="noopener">View setup instructions</a>
      <div class="form-actions"><button class="button button-secondary" type="button" data-action="back-welcome">Back to welcome</button></div>
    </section></div></div>`;
    return;
  }
  const titles = { create: "Create your account", login: "Welcome back", reset: "Reset your password" };
  root.innerHTML = `<div class="page"><div class="auth-wrap"><section class="panel">
    <div class="eyebrow">Secure sign-in</div><h2>${titles[mode]}</h2>
    <p class="lead">${mode === "reset" ? "We’ll send a password reset email if Firebase is configured." : "Your details stay private to your account."}</p>
    <form id="auth-form" class="form-stack">
      <div class="field"><label for="auth-email">Email address</label><input id="auth-email" type="email" autocomplete="email" required></div>
      ${mode !== "reset" ? '<div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="current-password" minlength="6" required></div>' : ""}
      <div class="form-actions"><button class="button button-primary" type="submit">${mode === "create" ? "Create account" : mode === "login" ? "Log in" : "Send reset email"}</button><button class="button button-secondary" type="button" data-action="auth-home">Back</button></div>
    </form>
  </section></div></div>`;
}

function renderHome() {
  const firstName = escapeHtml(state.profile.firstName || "friend");
  root.innerHTML = `<div class="page">
    <div class="section-head"><div><div class="eyebrow">Your companion is here</div><h1>Good to have you,<br><span class="mint">${firstName}.</span></h1><p class="lead">What would you like to do together?</p></div></div>
    <div class="card-grid">
      <button class="feature-card button-large" type="button" data-nav="vision"><div class="feature-icon">${icon("eye")}</div><h3>Vision companion</h3><p>Open camera preview and companion demo.</p></button>
      <button class="feature-card button-large" type="button" data-nav="voice"><div class="feature-icon">${icon("mic")}</div><h3>Voice agent</h3><p>Speak or type a request to VisionMate.</p></button>
      <button class="feature-card button-large" type="button" data-nav="translate"><div class="feature-icon">${icon("language")}</div><h3>Translator</h3><p>Translate text and hear it spoken.</p></button>
      <button class="feature-card button-large" type="button" data-nav="me"><div class="feature-icon">${icon("shield")}</div><h3>Profile & settings</h3><p>Manage your details, language, and permissions.</p></button>
    </div>
    <div class="status-banner" style="margin-top:20px">${icon("shield")}<div><strong>Prototype safety note</strong><p>This version does not detect obstacles, read camera text, or give navigation instructions. Never rely on it as a mobility aid.</p></div></div>
  </div>`;
  if (!state.permissionChecked) {
    state.permissionChecked = true;
    setTimeout(() => {
      if (state.page === "home") {
        setPage("permissions", false);
        speech.speak("Before we continue, I’d like to explain a few optional permissions. You can allow or skip each one.");
      }
    }, 700);
  }
}

function renderPermissions() {
  const permissions = [
    ["camera", "Camera", "Show a live camera preview. No hazard detection is available."],
    ["location", "Location", "Share your location only when you choose, including with SOS."],
    ["notifications", "Notifications", "Receive helpful reminders from this device."],
    ["microphone", "Microphone", "Use speech recognition when supported by your browser."]
  ];
  root.innerHTML = `<div class="page">
    <div class="page-intro"><div class="eyebrow">Optional device access</div><h2>Your permissions</h2><p class="lead">Each permission is optional and requested only after you choose Allow.</p></div>
    <div class="status-banner">${icon("shield")}<div><strong>You’re in control</strong><p>VisionMate will ask your browser only after you tap a permission button. You can skip any of them.</p></div></div>
    <div class="permission-grid">${permissions.map(([key,label,description]) => `<div class="permission-item" data-animate><div><strong>${label}</strong><span>${description}</span></div><button class="button button-secondary" type="button" data-action="permission" data-permission="${key}">Allow</button></div>`).join("")}</div>
    <p class="footer-note">“Display over other apps” is an Android-native permission; it can only be enabled when VisionMate is packaged as an APK/TWA.</p>
    <div class="form-actions"><button class="button button-primary" type="button" data-action="permissions-done">Continue to Home ${icon("arrow")}</button></div>
  </div>`;
}

function renderVision() {
  root.innerHTML = `<div class="page">
    <div class="section-head"><div class="page-intro"><div class="eyebrow">Vision companion</div><h2>Let’s look together.</h2><p class="lead">A camera preview, with an honest voice about what this prototype can and cannot do.</p></div></div>
    <div class="companion-layout">
      <section id="vision-preview" class="vision-preview ${state.visionActive ? "active" : ""}" aria-label="Camera preview panel">
        <video id="camera-video" class="camera-video ${state.visionActive ? "" : "hidden"}" autoplay muted playsinline aria-label="Live camera preview"></video>
        <div class="camera-visual ${state.visionActive ? "hidden" : ""}" aria-hidden="true"><div class="camera-frame"></div><div class="camera-eye">${icon("eye")}</div></div>
        <img id="menu-photo" class="menu-photo hidden" alt="Camera frame captured for menu reading">
        <div class="preview-top"><span class="live-label"><span class="status-dot"></span><span id="vision-status">${state.visionActive ? "PREVIEW ACTIVE" : "READY WHEN YOU ARE"}</span></span><span class="confidence">AI descriptions can be wrong</span></div>
        <div class="preview-bottom"><div class="preview-caption"><strong id="vision-caption">I’m here with you.</strong><span id="vision-detail">Start the camera preview when you’re safely stationary. I cannot identify hazards.</span></div></div>
      </section>
      <aside class="companion-controls">
        <div class="safety-note"><strong>Walking guidance is not available.</strong> VisionMate can describe a single requested image, but it is not continuous video analysis or validated hazard detection. Do not use it while walking or crossing roads; use your cane, guide dog, or trusted assistance.</div>
        <button id="camera-toggle" class="button button-primary button-large" type="button" data-action="toggle-camera">${icon("eye")} ${state.visionActive ? "Stop camera preview" : "Start camera preview"}</button>
        <button class="button button-secondary button-large" type="button" data-action="read-demo">Read a menu or sign</button>
        <button class="button button-secondary" type="button" data-action="capture-menu">Capture and describe this view</button>
        <button class="button button-secondary" type="button" data-action="capture-scene">Describe one camera image</button>
        <div class="control-row"><button class="button button-secondary" type="button" data-action="ask-clear">Ask for walking guidance</button><button class="button button-secondary" type="button" data-action="sos">SOS · share location</button></div>
        <form id="vision-command" class="voice-command"><input id="vision-text" aria-label="Ask VisionMate" placeholder="Ask me anything…" autocomplete="off"><button class="button button-primary" type="submit" aria-label="Send question">${icon("arrow")}</button></form>
      </aside>
    </div>
    <section class="panel map-panel"><div class="map-heading"><div><div class="eyebrow">Location</div><h3>My map</h3><p class="muted">Location tracking starts only when you request it. It is not turn-by-turn navigation.</p></div><button class="button button-secondary" type="button" data-action="track-location">Start location tracking</button></div><div id="location-map" role="region" aria-label="Map showing your current location"></div><p id="location-status" class="footer-note" aria-live="polite">Location is off.</p></section>
  </div>`;
  setVisionActive(state.visionActive);
  initializeMap();
}

function renderVoice() {
  state.conversationId = null;
  state.conversationPromise = null;
  state.conversationHistoryLoaded = false;
  root.innerHTML = `<div class="page"><div class="page-intro"><div class="eyebrow">Voice agent</div><h2>Tell me what’s on your mind.</h2><p class="lead">Talk or type. VisionMate can save notes, set best-effort reminders, open supported websites, and ask before opening your phone dialer.</p></div>
    <section class="panel" style="padding:22px">
      <div id="conversation" class="conversation" aria-label="Conversation with VisionMate"><div class="message" data-welcome-message>Hi${state.profile.firstName ? ` ${escapeHtml(state.profile.firstName)}` : ""}. I can save notes and reminders, open supported websites, and start a phone call after your confirmation. I cannot close apps or control phone-wide settings.</div></div>
      <p id="voice-caption" class="voice-caption" aria-live="polite">Your live speech transcript will appear here.</p>
      <form id="voice-command" class="voice-command" style="margin-top:15px"><input id="voice-text" aria-label="Type a message for VisionMate" placeholder="Try “open WhatsApp” or ask a question…" autocomplete="off"><button class="button button-primary" type="submit" aria-label="Send message">${icon("arrow")}</button></form>
      <div class="form-actions"><button class="button button-secondary" type="button" data-action="listen-voice">${icon("mic")} Browser voice input</button><button id="anuvaadhub-record" class="button button-secondary" type="button" data-action="record-anuvaadhub">Record WAV · Anuvaadhub ASR</button><button class="button button-secondary" type="button" data-action="sos">SOS · share location</button></div>
    </section>
    <div class="section-head extra-section-heading"><div><div class="eyebrow">Your tools</div><h2>Notes, apps & contacts</h2><p class="lead">Save notes here, open supported web apps, or call a contact with your confirmation.</p></div></div>
    <div class="assistant-tools">
      <section class="panel tool-card"><h3>Quick note</h3><p class="muted">Say “write a note…” in chat, or type below. Notes stay on this device and sync to Supabase when available.</p>
        <form id="note-form" class="form-stack"><div class="field"><label for="note-input">Note text</label><textarea id="note-input" name="note" required placeholder="What should I remember?"></textarea></div><button class="button button-primary" type="submit">Save note</button></form>
        <div id="notes-list" class="saved-list"></div>
      </section>
      <section class="panel tool-card"><h3>Tasks & reminders</h3><p class="muted">Reminders sync to Supabase when available. Browser alerts may not ring after VisionMate closes.</p>
        <form id="reminder-form" class="form-stack"><div class="field"><label for="reminder-title">What should I remind you?</label><input id="reminder-title" name="title" required></div><div class="field"><label for="reminder-time">When?</label><input id="reminder-time" name="dueAt" type="datetime-local" required></div><button class="button button-primary" type="submit">Set reminder</button></form>
        <div id="reminders-list" class="saved-list"></div>
      </section>
      <section class="panel tool-card"><h3>Open a web app</h3><p class="muted">A browser can open supported websites. It cannot launch or close arbitrary apps on your phone.</p>
        <div class="quick-actions"><button class="button button-secondary" type="button" data-action="open-app" data-app="classroom">Classroom</button><button class="button button-secondary" type="button" data-action="open-app" data-app="whatsapp">WhatsApp</button><button class="button button-secondary" type="button" data-action="open-app" data-app="maps">Maps</button><button class="button button-secondary" type="button" data-action="open-app" data-app="gmail">Gmail</button></div>
        <div class="safety-note">“Close app” and phone-wide light/dark mode require a native Android app with explicit OS permissions. Not available from this website.</div>
      </section>
      <section class="panel tool-card"><h3>Call a contact</h3><p class="muted">Save a contact on this device and to Supabase when available. Tapping Call opens the phone dialer; you review and place the call there.</p>
        <form id="contact-form" class="form-stack"><div class="field"><label for="contact-name">Contact name</label><input id="contact-name" name="name" required></div><div class="field"><label for="contact-phone">Phone number</label><input id="contact-phone" name="phone" type="tel" autocomplete="tel" required></div><button class="button button-primary" type="submit">Save contact</button></form>
        <div id="contacts-list" class="saved-list"></div>
      </section>
      <section class="panel tool-card"><h3>Anuvaadhub text to speech</h3><p class="muted">Provider limit: 30 words; letters, numbers, and spaces only. Choose a provider voice.</p>
        <form id="tts-form" class="form-stack"><div class="field"><label for="tts-input">Text to speak</label><textarea id="tts-input" name="text" maxlength="300" required placeholder="Enter a short phrase"></textarea></div><div class="field"><label for="tts-gender">Provider voice</label><select id="tts-gender" name="gender"><option value="female">Female</option><option value="male">Male</option></select></div><button class="button button-primary" type="submit">Speak with Anuvaadhub</button></form>
      </section>
    </div>
    <p class="footer-note">Confidence is the confidence of the demo’s intent match, not a guarantee that its answer is correct. Phone actions require your confirmation and device support.</p></div>`;
  renderSavedItems();
    getLocalItems("reminders").forEach(scheduleReminder);
    loadCloudItems();
    restoreConversation();
}

function getLocalItems(kind) {
  try { return JSON.parse(localStorage.getItem(`visionmate.${kind}`) || "[]"); }
  catch (error) { console.error(`Could not read ${kind}:`, error); return []; }
}

function renderSavedItems() {
  const notes = document.querySelector("#notes-list");
  const contacts = document.querySelector("#contacts-list");
  const reminders = document.querySelector("#reminders-list");
  const render = (items, type) => items.map(item => {
    if (type === "notes") return `<div class="saved-item"><span>${escapeHtml(item.content || item.note)}</span><button class="icon-button" type="button" aria-label="Delete note" data-action="delete-item" data-kind="notes" data-id="${escapeHtml(item.id)}">Delete</button></div>`;
    if (type === "contacts") return `<div class="saved-item"><span><strong>${escapeHtml(item.display_name || item.name)}</strong><br>${escapeHtml(item.phone)}</span><button class="button button-secondary" type="button" data-action="call-contact" data-phone="${escapeHtml(item.phone)}">Call</button></div>`;
    return `<div class="saved-item"><span><strong>${escapeHtml(item.title)}</strong><br>${new Date(item.due_at || item.dueAt).toLocaleString()}</span><button class="icon-button" type="button" aria-label="Delete reminder" data-action="delete-item" data-kind="reminders" data-id="${escapeHtml(item.id)}">Delete</button></div>`;
  }).join("");
  if (notes) notes.innerHTML = render(getLocalItems("notes"), "notes") || '<p class="muted">No notes saved yet.</p>';
  if (contacts) contacts.innerHTML = render(getLocalItems("contacts"), "contacts") || '<p class="muted">No contacts saved yet.</p>';
  if (reminders) reminders.innerHTML = render(getLocalItems("reminders"), "reminders") || '<p class="muted">No reminders scheduled yet.</p>';
}

async function saveItem(kind, item) {
  const localItems = getLocalItems(kind);
  const localRecord = { ...item, id: crypto.randomUUID(), created_at: new Date().toISOString(), _pendingSync: true };
  localItems.unshift(localRecord);
  localStorage.setItem(`visionmate.${kind}`, JSON.stringify(localItems));
  const table = { notes: "notes", contacts: "contacts", reminders: "reminders" }[kind];
  if (table) {
    let client = null;
    try {
      client = await getSupabaseClient();
      if (client) {
        const record = await saveOwnedRecord(table, item);
        localItems[0] = { ...record, _pendingSync: false };
        localStorage.setItem(`visionmate.${kind}`, JSON.stringify(localItems));
      }
    } catch (error) {
      logActivity("permission_denied", { permission: type }, "failed");
      console.error(`Supabase ${kind} sync failed:`, error);
      const feedback = `${kind} saved on this device, but cloud sync failed: ${error.message}`;
      speech.speak(feedback);
      toast(feedback);
    }
  }
  logActivity(`${kind}_saved`);
  renderSavedItems();
  return localRecord;
}

function loadSpeechVoices() {
  const select = document.querySelector("#speech-voice");
  if (!select || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  select.innerHTML = `<option value="">Default (${APP_CONFIG.languages[state.language].name})</option>` +
    voices.filter(voice => voice.lang.toLowerCase().startsWith(state.language)).map(voice =>
      `<option value="${escapeHtml(voice.name)}" ${speech.voiceName === voice.name ? "selected" : ""}>${escapeHtml(voice.name)}</option>`).join("");
  if (speech.voiceName && !voices.some(voice => voice.name === speech.voiceName)) speech.voiceName = "";
  if (speech.voiceName && !voices.find(voice => voice.name === speech.voiceName)?.lang.toLowerCase().startsWith(state.language)) {
    speech.voiceName = "";
    localStorage.removeItem("visionmate.voice");
  }
}

function renderTranslate() {
  const preferredTarget = localStorage.getItem("visionmate.translationTarget") || "hi";
  const targetLanguage = preferredTarget === state.language ? (state.language === "en" ? "hi" : "en") : preferredTarget;
  root.innerHTML = `<div class="page"><div class="page-intro"><div class="eyebrow">Translator</div><h2>Make yourself understood.</h2><p class="lead">Translate short text with Anuvaadhub or Bhashini, or dictate using browser speech recognition.</p></div>
    <div class="translate-grid">
      <section class="panel translate-card"><h3>Your message</h3><label class="sr-only" for="translate-input">Text to translate</label><textarea id="translate-input" placeholder="Type a phrase to translate…">${escapeHtml(state.translation)}</textarea>
        <div class="field"><label for="source-language">From</label><select id="source-language">${languageOptions()}</select></div>
        <div class="field"><label for="target-language">To</label><select id="target-language">${languageOptions(targetLanguage)}</select></div>
        <div class="field"><label for="translation-provider">Translation provider</label><select id="translation-provider"><option value="anuvaadhub" ${localStorage.getItem("visionmate.translationProvider") !== "bhashini" ? "selected" : ""}>Anuvaadhub MT · max 50 words</option><option value="bhashini" ${localStorage.getItem("visionmate.translationProvider") === "bhashini" ? "selected" : ""}>Bhashini</option></select></div>
        <div class="form-actions"><button class="button button-primary" type="button" data-action="translate-text">Translate</button><button class="button button-secondary" type="button" data-action="speak-translation">Speak message</button><button class="button button-secondary" type="button" data-action="listen-translation">${icon("mic")} Dictate</button></div>
        <p id="translation-output" class="translation-output" aria-live="polite"></p>
      </section>
      <section class="panel translate-card"><div class="feature-icon">${icon("language")}</div><h3>Language support</h3><p class="muted">English, Hindi, Tamil, Telugu, Kannada, Malayalam, and Punjabi are available where the selected provider has a model route.</p><div class="safety-note">Provider translations can be incorrect. Do not use them for emergency, medical, or other critical translation.</div></section>
    </div></div>`;
}

function renderMe() {
  const profile = state.profile;
  const firebaseReady = APP_CONFIG.firebase.apiKey && !APP_CONFIG.firebase.apiKey.startsWith("YOUR_");
  root.innerHTML = `<div class="page"><div class="page-intro"><div class="eyebrow">Your space</div><h2>Profile & settings</h2><p class="lead">Your details are stored on this device unless you connect Firebase.</p></div>
    <section class="panel" style="padding:24px"><h3>Your profile</h3><form id="profile-form" class="profile-grid">
      <div class="field"><label for="profile-first">First name</label><input id="profile-first" name="firstName" value="${escapeHtml(profile.firstName || "")}"></div>
      <div class="field"><label for="profile-last">Last name</label><input id="profile-last" name="lastName" value="${escapeHtml(profile.lastName || "")}"></div>
      <div class="field"><label for="profile-age">Age</label><input id="profile-age" name="age" type="number" min="1" max="120" value="${escapeHtml(profile.age || "")}"></div>
      <div class="field"><label for="profile-gender">Gender</label><select id="profile-gender" name="gender"><option value="">Choose</option>${["Woman","Man","Non-binary","Prefer not to say","Self-describe"].map(value => `<option ${profile.gender === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
      <div class="field"><label for="profile-email">Email</label><input id="profile-email" type="email" name="email" value="${escapeHtml(profile.email || "")}" autocomplete="email"></div>
      <div class="form-actions"><button type="submit" class="button button-primary">Save profile</button><button type="button" class="button button-secondary" data-action="link-email">Link / verify email</button></div>
    </form></section>
    <section style="margin-top:28px"><h3>Preferences</h3><div class="settings-grid">
      <label class="setting-row"><span><strong>Spoken language</strong><span>Voice prompts and speech</span></span><select id="settings-language">${languageOptions()}</select></label>
      <label class="setting-row"><span><strong>Speech voice</strong><span>Choose an installed device voice</span></span><select id="speech-voice" aria-label="Speech voice"></select></label>
      <label class="setting-row"><span><strong>Speech speed</strong><span>Adjust spoken feedback pace</span></span><input id="speech-rate" type="range" min="0.7" max="1.2" step="0.05" value="${speech.rate}" aria-label="Speech speed"></label>
      <label class="setting-row"><span><strong>Gemini assistant model</strong><span>Fallback tries configured models if rate-limited</span></span><select id="gemini-model" aria-label="Gemini assistant model"><option value="auto">VisionMate Auto (configured fallback)</option><option value="gemini-2.5-flash">Gemini Flash</option><option value="gemini-2.5-flash-lite">Gemini Flash Lite</option></select></label>
      <label class="setting-row"><span><strong>VisionMate appearance</strong><span>Change this app only, not phone settings</span></span><select id="app-theme" aria-label="VisionMate appearance"><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label class="setting-row"><span><strong>Battery alerts</strong><span>Warn when battery is low</span></span><input id="battery-toggle" class="switch" type="checkbox" checked aria-label="Battery alerts"></label>
      <div class="setting-row"><span><strong>Battery level</strong><span id="battery-description">Checking device support…</span></span><div class="battery-level"><div class="battery-icon"><div id="battery-fill" class="battery-fill"></div></div><span id="battery-value">—</span></div></div>
    </div></section>
    <section class="panel" style="padding:22px;margin-top:22px"><h3>Permissions</h3><p class="muted">Camera, location, microphone, and notifications are optional. Manage them in your browser’s site settings or review the setup checklist.</p><button class="button button-secondary" type="button" data-action="permissions">Review permissions</button></section>
    <section class="panel integrations-card"><div class="eyebrow">Connections</div><h3>Providers & setup</h3>
      <div class="integration-status ${firebaseReady ? "" : "integration-pending"}"><span class="status-dot"></span><div><strong>Firebase Authentication</strong><span id="firebase-status">${firebaseReady ? "Firebase web config found. Enable Google and Email/Password providers in Firebase Console." : "Google sign-in and email/password need configuration in js/config.js and Firebase Console."}</span></div></div>
      <div class="integration-status integration-pending"><span class="status-dot"></span><div><strong>Supabase database</strong><span id="supabase-status">Checking Supabase project settings…</span></div></div>
      <div class="integration-status integration-pending"><span class="status-dot"></span><div><strong>Gemini vision & assistant</strong><span>Requires deployed gemini-assist Edge Function and server-side GEMINI_API_KEY. Requests can still fail if model quotas are exhausted.</span></div></div>
      <div class="integration-status integration-pending"><span class="status-dot"></span><div><strong>Bhashini translation</strong><span>Requires deployed bhashini-translate Edge Function, credentials, pipeline, and the selected language pair.</span></div></div>
      <div class="integration-status integration-pending"><span class="status-dot"></span><div><strong>Phone controls</strong><span>Native Android integration required to open/close arbitrary apps or change device-wide appearance.</span></div></div>
      <a class="mini-link" href="./README.md" target="_blank" rel="noopener">Read Firebase and API-key setup guide</a>
    </section>
    <div class="form-actions"><button class="button button-danger" type="button" data-action="sign-out">Sign out</button></div>
    <p class="footer-note">Android “display over other apps” is only available after packaging as an APK/TWA. This web prototype cannot access or control other apps.</p>
  </div>`;
  monitorBattery();
  document.querySelector("#battery-toggle").checked = state.batteryAlerts;
  loadSpeechVoices();
  document.querySelector("#app-theme").value = document.documentElement.dataset.theme || "dark";
  document.querySelector("#gemini-model").value = localStorage.getItem("visionmate.model") || "auto";
  restoreAccountSettings();
  getSupabaseClient().then(client => {
    const status = document.querySelector("#supabase-status");
    if (status) status.textContent = client
      ? "Connected for this browser session. Anonymous records belong to this browser until explicitly linked to a user account."
      : "Not configured. Add the project URL and publishable anon key to js/config.js.";
  }).catch(error => {
    console.error("Could not verify Supabase configuration:", error);
    const status = document.querySelector("#supabase-status");
    if (status) status.textContent = `Configuration check failed: ${error.message}`;
  });
}

function announceResponse(command, target) {
  const result = answerFor(command, state.language);
  const message = `${result.text} Confidence ${result.confidence} percent.`;
  speech.speak(message);
  if (target) {
    const bubble = document.createElement("div");
    bubble.className = "message";
    bubble.textContent = `${result.text} Confidence: ${result.confidence}%.`;
    target.append(bubble);
  }
  const caption = document.querySelector("#vision-caption");
  const detail = document.querySelector("#vision-detail");
  if (caption && detail) {
    caption.textContent = "Here’s what I can tell you.";
    detail.textContent = `${result.text} Confidence: ${result.confidence}%.`;
  }
}

function addMessage(text, target = document.querySelector("#conversation"), isUser = false) {
  if (!target) return;
  const bubble = document.createElement("div");
  bubble.className = `message${isUser ? " user" : ""}`;
  bubble.textContent = text;
  target.append(bubble);
  target.scrollTop = target.scrollHeight;
  if (target.id === "conversation") persistChatMessage(isUser ? "user" : "assistant", text);
}

function getConversation() {
  if (!state.conversationPromise) {
    state.conversationPromise = loadLatestConversation().then(conversation => {
      state.conversationId = conversation?.id || null;
      return conversation;
    }).catch(error => {
      state.conversationPromise = null;
      throw error;
    });
  }
  return state.conversationPromise;
}

async function restoreConversation() {
  try {
    const conversation = await getConversation();
    const target = document.querySelector("#conversation");
    if (!conversation || !target || state.page !== "voice" || state.conversationHistoryLoaded) return;
    state.conversationHistoryLoaded = true;
    if (!conversation.messages.length) return;
    target.querySelector("[data-welcome-message]")?.remove();
    const fragment = document.createDocumentFragment();
    for (const message of conversation.messages) {
      const bubble = document.createElement("div");
      bubble.className = `message${message.role === "user" ? " user" : ""}`;
      bubble.textContent = message.content;
      fragment.append(bubble);
    }
    const firstMessage = target.querySelector(".message");
    if (firstMessage) target.insertBefore(fragment, firstMessage);
    else target.append(fragment);
  } catch (error) {
    console.error("Could not restore conversation history:", error);
    toast(`Chat history could not be loaded: ${error.message}`);
  }
}

async function persistChatMessage(role, content) {
  try {
    const conversation = await getConversation();
    if (conversation?.id) await saveChatMessage(conversation.id, role, content);
  } catch (error) {
    console.error("Could not save chat message:", error);
    toast(`Chat message could not be saved: ${error.message}`);
  }
}

function logActivity(actionType, details = {}, status = "performed") {
  saveActivityEvent(actionType, status, details).catch(error => {
    console.error("Could not save action history:", error);
    toast(`Action history could not be saved: ${error.message}`);
  });
}

function persistSettings(changes) {
  saveUserSettings(changes).catch(error => {
    console.error("Could not save account settings:", error);
    toast(`Settings changed on this device, but account sync failed: ${error.message}`);
  });
}

async function restoreAccountSettings() {
  try {
    const settings = await loadUserSettings();
    if (!settings || state.page !== "me") return;
    if (settings.language && APP_CONFIG.languages[settings.language]) {
      state.language = settings.language;
      localStorage.setItem("visionmate.language", settings.language);
      speech.setLanguage(settings.language);
      const languageSelect = document.querySelector("#settings-language");
      if (languageSelect) languageSelect.value = settings.language;
    }
    if (settings.theme === "dark" || settings.theme === "light") {
      updateAppearance(settings.theme);
      const themeSelect = document.querySelector("#app-theme");
      if (themeSelect) themeSelect.value = settings.theme;
    }
    if (typeof settings.speechRate === "number") {
      speech.rate = settings.speechRate;
      const rateInput = document.querySelector("#speech-rate");
      if (rateInput) rateInput.value = String(settings.speechRate);
    }
    if (typeof settings.speechVoice === "string") {
      speech.voiceName = settings.speechVoice;
      localStorage.setItem("visionmate.voice", settings.speechVoice);
      loadSpeechVoices();
    }
    if (typeof settings.batteryAlerts === "boolean") {
      state.batteryAlerts = settings.batteryAlerts;
      localStorage.setItem("visionmate.batteryAlerts", settings.batteryAlerts ? "on" : "off");
      const batteryToggle = document.querySelector("#battery-toggle");
      if (batteryToggle) batteryToggle.checked = settings.batteryAlerts;
    }
    if (typeof settings.geminiModel === "string") {
      localStorage.setItem("visionmate.model", settings.geminiModel);
      const modelSelect = document.querySelector("#gemini-model");
      if (modelSelect) modelSelect.value = settings.geminiModel;
    }
    if (typeof settings.translationTarget === "string" && APP_CONFIG.languages[settings.translationTarget]) {
      localStorage.setItem("visionmate.translationTarget", settings.translationTarget);
    }
    if (settings.translationProvider === "anuvaadhub" || settings.translationProvider === "bhashini") {
      localStorage.setItem("visionmate.translationProvider", settings.translationProvider);
    }
  } catch (error) {
    console.error("Could not restore account settings:", error);
    toast(`Account settings could not be loaded: ${error.message}`);
  }
}

function updateAppearance(theme) {
  const value = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = value;
  localStorage.setItem("visionmate.theme", value);
}

function setSpeechVoice(query) {
  const voices = window.speechSynthesis?.getVoices() || [];
  const match = voices.find(voice => voice.name.toLowerCase().includes(query.toLowerCase()) ||
    voice.lang.toLowerCase().includes(query.toLowerCase()));
  if (!match) {
    speech.speak(`I could not find an installed voice matching ${query}. You can choose an available voice in Me settings.`);
    return false;
  }
  speech.voiceName = match.name;
  localStorage.setItem("visionmate.voice", match.name);
  persistSettings({ speechVoice: match.name });
  speech.speak(`Voice changed to ${match.name}.`);
  return true;
}

async function handleCommand(command) {
  const text = command.trim();
  if (!text) return;
  logActivity("assistant_command", { characterCount: text.length }, "requested");
  addMessage(text, document.querySelector("#conversation"), true);
  const noteMatch = text.match(/(?:write|save|take|make)\s+(?:a\s+)?note(?:\s+(?:that|saying|to))?\s*[:,-]?\s*(.+)/i);
  if (noteMatch) {
    const record = await saveItem("notes", { content: noteMatch[1].trim() });
    const response = `I saved this note on this device: ${record.content}`;
    addMessage(response); speech.speak(response); return;
  }
  const timerMatch = text.match(/\b(?:set|start)\s+(?:a\s+)?timer\s+for\s+(\d+)\s+(second|seconds|minute|minutes|hour|hours)\b/i);
  if (timerMatch) {
    const unit = timerMatch[2].toLowerCase();
    const duration = Number(timerMatch[1]) * (unit.startsWith("hour") ? 3600000 : unit.startsWith("minute") ? 60000 : 1000);
    const dueAt = new Date(Date.now() + duration);
    const record = await saveItem("reminders", { title: "Timer finished", due_at: dueAt.toISOString() });
    scheduleReminder(record);
    const response = `Timer set for ${timerMatch[1]} ${timerMatch[2]}. Keep VisionMate open; this browser timer may not run in the background.`;
    addMessage(response); speech.speak(response); return;
  }
  const reminderMatch = text.match(/remind me to\s+(.+?)\s+in\s+(\d+)\s+(minute|minutes|hour|hours)/i);
  if (reminderMatch) {
    const count = Number(reminderMatch[2]);
    const dueAt = new Date(Date.now() + count * (reminderMatch[3].toLowerCase().startsWith("hour") ? 3600000 : 60000));
    const record = await saveItem("reminders", { title: reminderMatch[1].trim(), due_at: dueAt.toISOString() });
    scheduleReminder(record);
    const response = `I’ll remind you to ${record.title} at ${dueAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Keep VisionMate open; browser reminders may not run after it closes.`;
    addMessage(response); speech.speak(response); return;
  }
  if (/change (?:my )?voice to|use (?:a )?voice called/i.test(text)) {
    const requested = text.replace(/^.*?(?:change (?:my )?voice to|use (?:a )?voice called)\s*/i, "").trim();
    setSpeechVoice(requested); return;
  }
  const themeMatch = text.match(/\b(?:turn on|switch to|change to|use)\s+(dark|light)\s+mode\b/i);
  if (themeMatch) {
    updateAppearance(themeMatch[1].toLowerCase());
    persistSettings({ theme: themeMatch[1].toLowerCase() });
    const response = `VisionMate is now using ${themeMatch[1].toLowerCase()} appearance. I cannot change your phone’s system theme from a website.`;
    addMessage(response); speech.speak(response); return;
  }
  if (/\b(close|quit|exit)\s+(?:the\s+)?(?:app|application|whatsapp|gmail|maps)\b/i.test(text)) {
    const response = "I can’t close other apps from a website. Android app-control permissions require a native app; you can use your phone’s app switcher.";
    addMessage(response); speech.speak(response); return;
  }
  if (/read (?:the )?(?:menu|sign|label|document)|menu/.test(text.toLowerCase())) {
    if (state.page !== "vision") setPage("vision", false);
    const response = "Please point the camera at the menu and hold your phone steady. Then tap Capture and describe this view. I’ll try to read the text, but may miss or misread items.";
    addMessage(response); speech.speak(response); return;
  }
  if (/^\s*(?:sos|emergency help|help me)\s*$/i.test(text)) {
    triggerSos(); return;
  }
  if (/\b(?:track|show|share|find)\s+(?:my\s+)?location\b/i.test(text)) {
    if (state.page !== "vision") setPage("vision", false);
    setTimeout(() => {
      if (state.locationWatchId === null) beginLocationTracking();
      else speech.speak("Location tracking is already on.");
    }, 250);
    return;
  }
  if (/walk|walking|guide me|path clear|road|pothole|obstacle|risk/i.test(text)) {
    const response = "I can’t safely guide walking or confirm road hazards. Please stop and use your cane, guide dog, trusted person, or a validated mobility aid. This camera prototype must not be used for navigation.";
    addMessage(response); speech.speak(response); return;
  }
  const callMatch = text.match(/\bcall\s+(.+?)(?:\s+please)?$/i);
  if (callMatch) {
    const contact = getLocalItems("contacts").find(item =>
      (item.display_name || item.name || "").toLowerCase() === callMatch[1].trim().toLowerCase());
    if (!contact) {
      const response = `I could not find ${callMatch[1].trim()} in your saved contacts. Add the contact in Voice tools first.`;
      addMessage(response); speech.speak(response); return;
    }
    state.pendingCall = contact.phone;
    const bubble = document.createElement("div");
    bubble.className = "message";
    bubble.textContent = `Call ${contact.display_name || contact.name}? Tap Call to open the dialer, then confirm the call on your phone.`;
    const button = document.createElement("button");
    button.type = "button"; button.className = "button button-primary"; button.textContent = `Call ${contact.display_name || contact.name}`;
    button.dataset.action = "call-contact"; button.dataset.phone = contact.phone;
    bubble.append(button); document.querySelector("#conversation")?.append(bubble);
    persistChatMessage("assistant", bubble.textContent);
    speech.speak(`I found ${contact.display_name || contact.name}. I’ve added a call button. Tap it to open your phone dialer.`);
    return;
  }
  const openMatch = text.match(/\bopen\s+(?:the\s+)?(whatsapp|gmail|maps|google classroom|classroom|class)\b/i);
  if (openMatch) {
    const app = /class/i.test(openMatch[1]) ? "classroom" : openMatch[1].toLowerCase();
    const button = document.createElement("button");
    button.type = "button"; button.className = "button button-primary"; button.textContent = `Open ${app}`;
    button.dataset.action = "open-app"; button.dataset.app = app;
    const bubble = document.createElement("div"); bubble.className = "message";
    bubble.textContent = `I can open ${app} in a new browser tab, if it is available.`;
    bubble.append(button); document.querySelector("#conversation")?.append(bubble);
    persistChatMessage("assistant", bubble.textContent);
    speech.speak(`I can open ${app} in a browser tab. Tap the button to continue.`);
    return;
  }
  try {
    const result = await invokeAssistant({ prompt: text, model: selectedGeminiModel() });
    addMessage(`${result.text} AI-generated response; please verify important information.`);
    speech.speak(`${result.text} AI-generated response. Please verify important information.`);
  } catch (error) {
    console.error("Assistant request failed:", error);
    const result = answerFor(text, state.language);
    const fallback = `${result.text} Confidence ${result.confidence} percent. ${error.message}`;
    addMessage(fallback); speech.speak(fallback); toast(error.message);
  }
}

function scheduleReminder(reminder) {
  if (state.scheduledReminders.has(reminder.id)) return;
  const dueTimestamp = new Date(reminder.due_at || reminder.dueAt).getTime();
  if (!Number.isFinite(dueTimestamp) || dueTimestamp <= Date.now()) return;
  state.scheduledReminders.add(reminder.id);
  const checkDue = () => {
    const remaining = dueTimestamp - Date.now();
    if (remaining > 0) {
      setTimeout(checkDue, Math.min(remaining, 2147480000));
      return;
    }
    const message = `Reminder: ${reminder.title}`;
    speech.speak(message);
    if ("Notification" in window && Notification.permission === "granted") new Notification("VisionMate reminder", { body: reminder.title });
    state.scheduledReminders.delete(reminder.id);
  };
  checkDue();
}

async function loadCloudItems() {
  try {
    const client = await getSupabaseClient();
    if (!client) return;
    for (const kind of ["notes", "contacts", "reminders"]) {
      const records = await listOwnedRecords(kind);
      if (!records) continue;
      const localItems = getLocalItems(kind);
      const pendingItems = localItems.filter(item => item._pendingSync);
      const uploaded = [];
      const syncedLocalIds = new Set();
      for (const item of pendingItems) {
        const { id, created_at, _pendingSync, ...record } = item;
        const saved = await saveOwnedRecord(kind, record).catch(error => {
          console.error(`Could not sync a local ${kind} item:`, error);
          return null;
        });
        if (saved) {
          uploaded.push({ ...saved, _pendingSync: false });
          syncedLocalIds.add(id);
        }
      }
      const combined = [...uploaded, ...records, ...localItems.filter(item => item._pendingSync && !syncedLocalIds.has(item.id))];
      const unique = [...new Map(combined.map(item => [item.id, item])).values()];
      localStorage.setItem(`visionmate.${kind}`, JSON.stringify(unique));
    }
    renderSavedItems();
    getLocalItems("reminders").forEach(scheduleReminder);
  } catch (error) {
    console.error("Could not sync saved items from Supabase:", error);
    toast(`Cloud sync unavailable: ${error.message}`);
  }
}

function initializeMap(attempt = 0) {
  const element = document.querySelector("#location-map");
  if (!element) return;
  if (!window.L) {
    if (attempt < 30) setTimeout(() => initializeMap(attempt + 1), 150);
    else document.querySelector("#location-status").textContent = "Map library did not load. Check your connection.";
    return;
  }
  if (state.map) { state.map.remove(); state.map = null; state.mapMarker = null; }
  state.map = window.L.map(element, { zoomControl: true }).setView([20.5937, 78.9629], 4);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);
}

function beginLocationTracking() {
  const status = document.querySelector("#location-status");
  if (!navigator.geolocation) {
    status.textContent = "Location is not supported by this browser.";
    speech.speak(status.textContent); return;
  }
  if (state.locationWatchId !== null) {
    navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
    status.textContent = "Location tracking stopped.";
    const button = document.querySelector('[data-action="track-location"]');
    if (button) button.textContent = "Start location tracking";
    speech.speak(status.textContent); return;
  }
  status.textContent = "Waiting for location permission…";
  const button = document.querySelector('[data-action="track-location"]');
  if (button) button.textContent = "Stop location tracking";
  state.locationWatchId = navigator.geolocation.watchPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    if (!state.map || !window.L) return;
    const point = [latitude, longitude];
    if (state.mapMarker) state.mapMarker.setLatLng(point);
    else state.mapMarker = window.L.marker(point).addTo(state.map).bindPopup("Your current location");
    state.map.setView(point, 16);
    status.textContent = `Location updated. Estimated accuracy ${Math.round(accuracy)} metres.`;
  }, error => {
    state.locationWatchId = null;
    status.textContent = `Location unavailable: ${error.message}`;
    const trackButton = document.querySelector('[data-action="track-location"]');
    if (trackButton) trackButton.textContent = "Start location tracking";
    speech.speak(status.textContent);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  speech.speak("Location tracking is on. It shows your position only and does not provide route guidance.");
}

function triggerSos() {
  if (navigator.vibrate) navigator.vibrate([450, 120, 450, 120, 850]);
  speech.speak("SOS requested. I’ll try to find your current location. This prototype does not automatically call emergency services.");
  if (!navigator.geolocation) {
    toast("Location is unavailable. Please contact a trusted person or local emergency services directly.");
    return;
  }
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    const link = `https://maps.google.com/?q=${latitude},${longitude}`;
    const message = `Your location is ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.`;
    speech.speak(`${message} Tap the location link to view it. This prototype does not contact emergency services.`);
    const alert = document.querySelector("#live-feedback");
    if (alert) {
      document.querySelector(".sos-map-link")?.remove();
      const linkElement = document.createElement("a");
      linkElement.href = link;
      linkElement.target = "_blank";
      linkElement.rel = "noopener noreferrer";
      linkElement.textContent = "Open SOS location in Google Maps";
      linkElement.className = "sos-map-link";
      linkElement.setAttribute("aria-label", "Open SOS location in Google Maps");
      alert.after(linkElement);
    }
    toast(message);
  }, error => {
    console.error("SOS location request failed:", error);
    speech.speak(`I could not get your location. ${error.message}. Please call for help directly.`);
    toast("Could not get location. Contact a trusted person or emergency services directly.");
  }, { enableHighAccuracy: true, timeout: 12000 });
}

async function captureAndDescribe(mode = "menu") {
  const video = document.querySelector("#camera-video");
  if (!state.visionActive || !video?.videoWidth) {
    speech.speak("Start the camera preview first, then point it at the menu or object.");
    return;
  }
  const canvas = document.createElement("canvas");
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / video.videoWidth, maxEdge / video.videoHeight);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageUrl = canvas.toDataURL("image/jpeg", 0.82);
  const image = document.querySelector("#menu-photo");
  image.src = imageUrl;
  image.classList.remove("hidden");
  const prompt = "Describe the visible scene briefly for accessibility. Mention only clearly visible objects and any possible obstacle or hazard that is directly apparent, using cautious language. Do not infer hidden dangers, say that an area or path is safe, or tell the user how to walk or avoid objects. This single image may be incomplete or wrong.";
  speech.speak(mode === "scene"
    ? "I’ve captured one camera frame. I’ll describe visible details, but I cannot reliably identify hazards or guide walking. Please remain stationary and use a trusted mobility aid."
    : "I’ve captured one frame. I’ll try to read the visible text. I may misread it, so please verify important details.");
  try {
    let text;
    if (mode === "scene") {
      const result = await invokeAssistant({
        prompt,
        imageBase64: imageUrl.split(",")[1],
        mimeType: "image/jpeg",
        model: selectedGeminiModel()
      });
      text = result.text;
    } else {
      text = await recognizeImage(imageUrl.split(",")[1], "image/jpeg", state.language);
    }
    document.querySelector("#vision-caption").textContent = mode === "scene" ? "One-frame Gemini scene description" : "Anuvaadhub OCR · verify the result";
    document.querySelector("#vision-detail").textContent = text;
    speech.speak(`${text} This image reading can be wrong. Please verify important details.`);
  } catch (error) {
    console.error("Camera image analysis failed:", error);
    speech.speak(`I could not read this image. ${error.message}`);
    toast(error.message);
  }
}

async function startAnuvaadhubRecording(button) {
  const caption = document.querySelector("#voice-caption");
  if (!caption) return;
  button.dataset.action = "stop-anuvaadhub-recording";
  button.textContent = "Stop recording";
  speech.speak("Recording for Anuvaadhub speech recognition. Speak now; your recording is limited to twenty seconds.");
  try {
    const wav = await recordWav(status => {
      caption.textContent = `${status} Live recognized words are not available until the recording is processed.`;
    });
    caption.textContent = "Processing recording with Anuvaadhub…";
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the recorded WAV audio."));
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(wav);
    });
    const result = await runAnuvaadhub({ task: "asr", audioBase64: base64, sourceLanguage: state.language });
    const transcript = typeof result.text === "string" ? result.text.trim() : "";
    if (!transcript) throw new Error("Anuvaadhub returned no transcript.");
    caption.textContent = `Anuvaadhub transcript: ${transcript}`;
    const input = document.querySelector("#voice-text");
    if (input) input.value = transcript;
    speech.speak(`I heard: ${transcript}. The transcript is in the message field. Review it and press Send to continue.`);
  } catch (error) {
    console.error("Anuvaadhub speech recognition failed:", error);
    caption.textContent = `Speech recognition failed: ${error.message}`;
    speech.speak(`I could not process that recording. ${error.message}`);
    toast(error.message);
  } finally {
    button.dataset.action = "record-anuvaadhub";
    button.textContent = "Record WAV · Anuvaadhub ASR";
  }
}

async function syncProfile(profile) {
  const syncTasks = [
    saveProfileRecord(profile).then(() => "").catch(error => {
      console.error("Supabase profile sync failed:", error);
      return `Supabase: ${error.message}`;
    })
  ];
  if (auth.getSession()) {
    syncTasks.push(saveFirebaseProfile(profile).then(saved => saved ? "" : "Firebase profile was not synced.")
      .catch(error => {
        console.error("Firebase profile sync failed:", error);
        return `Firebase: ${error.message}`;
      }));
  }
  const failures = (await Promise.all(syncTasks)).filter(Boolean);
  if (failures.length) toast(`Profile saved on this device. ${failures.join(" ")}`);
}

function monitorBattery() {
  const desc = document.querySelector("#battery-description");
  const value = document.querySelector("#battery-value");
  const fill = document.querySelector("#battery-fill");
  if (!navigator.getBattery) {
    desc.textContent = "Battery status is not available in this browser.";
    value.textContent = "—";
    return;
  }
  navigator.getBattery().then(battery => {
    const update = () => {
      const percent = Math.round(battery.level * 100);
      value.textContent = `${percent}%`;
      fill.style.width = `${percent}%`;
      desc.textContent = battery.charging ? "Charging" : "Device battery level";
      if (!battery.charging && percent <= APP_CONFIG.batteryWarningPercent && document.querySelector("#battery-toggle")?.checked) {
        const alertKey = `visionmate.battery-alert.${percent}`;
        if (!sessionStorage.getItem(alertKey)) {
          sessionStorage.setItem(alertKey, "1");
          speech.speak(`Battery is at ${percent} percent. Consider charging your device.`);
        }
      }
    };
    update();
    battery.addEventListener("levelchange", update);
    battery.addEventListener("chargingchange", update);
  }).catch(error => {
    console.error("Battery information could not be read:", error);
    desc.textContent = "Could not read battery status.";
  });
}

async function requestPermission(type, button) {
  button.disabled = true;
  try {
    if (type === "camera") {
      const stream = await navigator.mediaDevices?.getUserMedia({ video: true, audio: false });
      stream?.getTracks().forEach(track => track.stop());
    } else if (type === "microphone") {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
      stream?.getTracks().forEach(track => track.stop());
    } else if (type === "location") {
      if (!navigator.geolocation) throw new Error("Location is not supported in this browser.");
      await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }));
    } else if (type === "notifications") {
      if (!("Notification" in window)) throw new Error("Notifications are not supported in this browser.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications were not allowed.");
    }
    logActivity("permission_granted", { permission: type });
    button.textContent = "Allowed";
    speech.speak(`${type} permission granted.`);
  } catch (error) {
    console.error(`Could not request ${type} permission:`, error);
    button.textContent = "Try again";
    speech.speak(`${type} permission was not granted. ${error.message || "You can change it in browser settings."}`);
  } finally {
    button.disabled = false;
  }
}

async function toggleCamera(button) {
  const video = document.querySelector("#camera-video");
  if (state.visionActive) {
    state.camera?.stop();
    state.camera = null;
    state.visionActive = false;
    video.classList.add("hidden");
    document.querySelector(".camera-visual")?.classList.remove("hidden");
    document.querySelector("#vision-preview")?.classList.remove("active");
    document.querySelector("#vision-status").textContent = "READY WHEN YOU ARE";
    document.querySelector("#vision-detail").textContent = "Start the camera preview when you’re safely stationary. I cannot identify hazards.";
    button.innerHTML = `${icon("eye")} Start camera preview`;
    speech.speak("Camera preview stopped. Remember, I cannot detect obstacles.");
    return;
  }
  try {
    state.camera = new CameraController(video);
    await state.camera.start();
    state.visionActive = true;
    video.classList.remove("hidden");
    document.querySelector(".camera-visual")?.classList.add("hidden");
    document.querySelector("#vision-preview")?.classList.add("active");
    document.querySelector("#vision-status").textContent = "PREVIEW ACTIVE";
    document.querySelector("#vision-detail").textContent = "Live preview only. It cannot detect hazards or guide walking.";
    button.innerHTML = `${icon("eye")} Stop camera preview`;
    setVisionActive(true);
    speech.speak("Camera preview is on. I cannot see or detect hazards in this prototype. Please stay stationary and use your trusted mobility aid.");
  } catch (error) {
    console.error("Camera preview could not start:", error);
    state.visionActive = false;
    speech.speak(error.message || "I could not start the camera. Check your browser permissions.");
    toast(error.message || "Camera could not start.");
  }
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = "toast";
  element.setAttribute("role", "alert");
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 5000);
}

function getOnboardingValue() {
  const input = document.querySelector("#onboarding-value");
  if (!input || !input.reportValidity()) return null;
  const value = input.value.trim();
  if (input.name === "age" && (Number(value) < 1 || Number(value) > 120)) {
    speech.speak("Please enter an age between 1 and 120.");
    return null;
  }
  return value;
}

async function completeAuth(method, credentials = {}) {
  try {
    const result = await auth.signIn(method, credentials);
    logActivity(method === "reset" ? "password_reset" : "sign_in", { method }, result.firebase ? "performed" : "failed");
    if (method === "reset") {
      speech.speak(result.firebase ? "Password reset email sent. Check your inbox." : "Password reset requires Firebase setup. No email was sent.");
      toast(result.firebase ? "Password reset email sent." : "Firebase is not configured. No email was sent.");
      return;
    }
    state.profile = auth.getProfile() || state.profile;
    speech.speak(result.firebase ? "You’re signed in. Welcome to VisionMate." : "You’re in the local demo. Your profile stays on this device.");
    setPage("home", false);
    state.permissionChecked = false;
    if (result.firebase) {
      syncProfile(state.profile);
      speech.speak("You’re signed in. Welcome to VisionMate.");
    }
  } catch (error) {
    speech.speak(error.message);
    toast(error.message);
  }
}

function handleAction(action, element) {
  switch (action) {
    case "start-onboarding":
      state.authStep = 0;
      state.onboarding = {};
      setPage("onboarding");
      speech.speak(`${APP_CONFIG.languages[state.language].greeting} ${document.querySelector("#onboarding-value")?.labels?.[0]?.textContent || "How did you hear about VisionMate?"}`);
      break;
    case "login":
      state.authStep = 0; state.authMode = null; setPage("auth");
      break;
    case "back-welcome":
      state.authMode = null; state.authStep = 0; setPage("welcome"); speech.speak("Welcome screen."); break;
    case "auth-mode":
      state.authMode = element.dataset.mode; setPage("auth"); break;
    case "auth-home":
      state.authMode = null; setPage("auth"); break;
    case "onboarding-next": {
      const value = getOnboardingValue();
      if (value === null) { speech.speak("Please fill in this answer before continuing."); break; }
      const keys = ["heardFrom","firstName","lastName","age","gender"];
      state.onboarding[keys[state.authStep]] = value;
      state.authStep += 1;
      if (state.authStep < keys.length) {
        renderOnboarding();
        speech.speak(document.querySelector("h2")?.textContent || "Please answer the next question.");
      } else {
        state.profile = { ...state.profile, ...state.onboarding, age: Number(state.onboarding.age), createdAt: new Date().toISOString() };
        auth.saveProfile(state.profile);
        syncProfile(state.profile);
        state.authMode = null;
        setPage("auth");
        speech.speak("Thanks. Your profile is saved on this device. Now choose how you would like to continue.");
      }
      break;
    }
    case "onboarding-back":
      state.authStep = Math.max(0, state.authStep - 1); renderOnboarding(); speech.speak(document.querySelector("h2")?.textContent); break;
    case "listen-onboarding":
      speech.speak("I’m listening.");
      speech.listen({ onResult: text => { const input = document.querySelector("#onboarding-value"); if (input) { input.value = text; speech.speak(`I heard ${text}. Tap continue if that is right.`); } }, onError: message => { speech.speak(message); toast(message); } });
      break;
    case "google": completeAuth("google"); break;
    case "toggle-camera": toggleCamera(element); break;
    case "read-demo":
      speech.speak("Please point the camera at the menu and hold your phone steady. Start the preview if needed, then tap Capture and describe this view. Stay safely stationary.");
      if (!state.visionActive) {
        toggleCamera(document.querySelector("#camera-toggle"));
      }
      break;
    case "capture-menu":
      logActivity("menu_ocr_requested");
      captureAndDescribe();
      break;
    case "capture-scene":
      logActivity("scene_description_requested");
      captureAndDescribe("scene");
      break;
    case "ask-clear":
      speech.speak("I can’t confirm whether a path is clear or guide you safely. Please stop and use your cane, guide dog, trusted person, or another validated mobility aid.");
      break;
    case "track-location": logActivity("location_tracking_requested", {}, "requested"); beginLocationTracking(); break;
    case "sos": logActivity("sos_requested", {}, "requested"); triggerSos(); break;
    case "open-app": {
      const urls = { whatsapp: "https://web.whatsapp.com/", gmail: "https://mail.google.com/", maps: "https://maps.google.com/", classroom: "https://classroom.google.com/" };
      const url = urls[element.dataset.app];
      if (!url) { speech.speak("That website is not in the approved app list."); break; }
      window.open(url, "_blank", "noopener,noreferrer");
      logActivity("open_web_app", { app: element.dataset.app });
      speech.speak(`Opening ${element.dataset.app} in a new browser tab. You may need to sign in.`);
      break;
    }
    case "call-contact": {
      const phone = String(element.dataset.phone || "").replace(/[^\d+*#,;]/g, "");
      if (!phone || !/^[+*#,;0-9]{3,40}$/.test(phone)) { speech.speak("That phone number is invalid."); break; }
      logActivity("call_contact", {}, "requested");
      if (window.confirm(`Open your phone dialer for ${phone}? You will need to confirm the call on your device.`)) {
        window.location.href = `tel:${phone}`;
        logActivity("call_contact", {}, "performed");
        speech.speak("Opening the phone dialer. Confirm the call on your phone.");
      } else {
        logActivity("call_contact", {}, "cancelled");
        speech.speak("Call cancelled.");
      }
      break;
    }
    case "delete-item": {
      const kind = element.dataset.kind;
      const items = getLocalItems(kind).filter(item => String(item.id) !== element.dataset.id);
      localStorage.setItem(`visionmate.${kind}`, JSON.stringify(items));
      deleteOwnedRecord(kind, element.dataset.id).catch(error => { console.error("Cloud delete failed:", error); toast(error.message); });
      renderSavedItems(); speech.speak("Removed."); break;
    }
    case "listen-voice":
      speech.speak("I’m listening.");
      speech.listen({ onResult: text => {
        const caption = document.querySelector("#voice-caption");
        if (caption) caption.textContent = `You said: ${text}`;
        handleCommand(text).catch(error => { console.error("Voice command failed:", error); speech.speak(`I could not complete that request. ${error.message}`); });
      }, onTranscript: text => { const caption = document.querySelector("#voice-caption"); if (caption) caption.textContent = `Listening: ${text}`; }, onError: message => { speech.speak(message); toast(message); } });
      break;
    case "record-anuvaadhub":
      startAnuvaadhubRecording(element);
      break;
    case "stop-anuvaadhub-recording":
      stopRecording();
      speech.speak("Recording stopped. Processing your speech.");
      break;
    case "listen-translation":
      speech.speak("I’m listening.");
      speech.listen({ onResult: text => { const input = document.querySelector("#translate-input"); if (input) input.value = text; speech.speak(`I heard ${text}. Choose Translate to translate it.`); }, onTranscript: text => { const input = document.querySelector("#translate-input"); if (input) input.value = text; }, onError: message => { speech.speak(message); toast(message); } });
      break;
    case "speak-translation": {
      const text = document.querySelector("#translate-input")?.value.trim();
      if (!text) { speech.speak("Type or dictate a message first."); break; }
      speech.speak(text, { lang: APP_CONFIG.languages[state.language].voice }); break;
    }
    case "translate-text": {
      const text = document.querySelector("#translate-input").value.trim();
      const output = document.querySelector("#translation-output");
      if (!text) { speech.speak("Enter a phrase to translate first."); break; }
      const sourceLanguage = document.querySelector("#source-language").value;
      const targetLanguage = document.querySelector("#target-language").value;
      const provider = document.querySelector("#translation-provider").value;
      if (sourceLanguage === targetLanguage) { speech.speak("Choose two different languages."); output.textContent = "Source and target languages must be different."; break; }
      output.textContent = "Translating…";
      machineTranslate({ text, sourceLanguage, targetLanguage, provider }).then(translation => {
        output.textContent = translation;
        speech.speak(`${translation} Provider translation; please verify important meaning.`, { lang: APP_CONFIG.languages[targetLanguage].voice });
      }).catch(error => {
        console.error(`${provider} translation failed:`, error);
        output.textContent = error.message;
        speech.speak(error.message); toast(error.message);
      });
      break;
    }
    case "permission":
      logActivity("permission_requested", { permission: element.dataset.permission }, "requested");
      requestPermission(element.dataset.permission, element);
      break;
    case "permissions-done": setPage("home"); break;
    case "permissions": setPage("permissions"); break;
    case "link-email":
      speech.speak("To link an email securely, configure Firebase and sign in first. Email OTP linking is not yet enabled in this prototype.");
      toast("Email verification is not configured in this prototype.");
      break;
    case "sign-out":
      logActivity("sign_out");
      auth.signOut(); state.permissionChecked = false; setPage("welcome"); speech.speak("You have been signed out."); break;
  }
}

document.addEventListener("click", event => {
  const navButton = event.target.closest("[data-nav]");
  if (navButton) {
    const page = navButton.dataset.nav;
    if (!auth.getSession()) { speech.speak("Please continue or log in first."); setPage("welcome", false); return; }
    pressFeedback(navButton);
    logActivity("navigation", { page });
    if (state.visionActive && page !== "vision") { state.camera?.stop(); state.camera = null; state.visionActive = false; }
    setPage(page);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    pressFeedback(actionButton);
    handleAction(actionButton.dataset.action, actionButton);
  }
});

document.addEventListener("submit", async event => {
  if (event.target.id === "auth-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const mode = state.authMode;
    await completeAuth(mode, { email: form.get("email"), password: form.get("password") });
  } else if (event.target.id === "voice-command" || event.target.id === "vision-command") {
    event.preventDefault();
    const input = event.target.querySelector("input");
    const command = input.value.trim();
    if (!command) { speech.speak("Type a request first."); return; }
    input.value = "";
    if (event.target.id === "voice-command") {
      handleCommand(command).catch(error => {
        console.error("Voice command failed:", error);
        speech.speak(`I could not complete that request. ${error.message}`);
        toast(error.message);
      });
    } else {
      const result = await invokeAssistant({ prompt: command, model: selectedGeminiModel() }).catch(error => {
        console.error("Vision question failed:", error);
        speech.speak(error.message); toast(error.message); return null;
      });
      if (result) {
        document.querySelector("#vision-caption").textContent = "Here’s what I can tell you.";
        document.querySelector("#vision-detail").textContent = result.text;
        speech.speak(`${result.text} AI-generated answer. Please verify important information.`);
      }
    }
  } else if (event.target.id === "tts-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const text = String(form.get("text") || "").trim();
    const gender = String(form.get("gender") || "female");
    try {
      speech.speak("Generating speech with Anuvaadhub.");
      const spokenText = await speakWithProvider(text, gender, state.language);
      speech.speak(`Anuvaadhub audio is playing for: ${spokenText}`);
    } catch (error) {
      console.error("Anuvaadhub text to speech failed:", error);
      speech.speak(`Text to speech failed. ${error.message}`);
      toast(error.message);
    }
  } else if (event.target.id === "note-form") {
    event.preventDefault();
    try {
      const content = new FormData(event.target).get("note").trim();
      if (!content) return;
      await saveItem("notes", { content });
      event.target.reset();
      speech.speak("I saved your note.");
    } catch (error) {
      console.error("Could not save note:", error); speech.speak(error.message); toast(error.message);
    }
  } else if (event.target.id === "contact-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const display_name = form.get("name").trim();
    const phone = form.get("phone").trim();
    if (!/^[+*#,;0-9()\s.-]{3,40}$/.test(phone)) {
      speech.speak("Please check the phone number. It contains unsupported characters.");
      return;
    }
    try {
      await saveItem("contacts", { display_name, phone });
      event.target.reset();
      speech.speak(`Contact ${display_name} saved on this device.`);
    } catch (error) {
      console.error("Could not save contact:", error); speech.speak(error.message); toast(error.message);
    }
  } else if (event.target.id === "reminder-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const dueAt = new Date(form.get("dueAt"));
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      speech.speak("Choose a reminder time in the future.");
      return;
    }
    try {
      const record = await saveItem("reminders", { title: form.get("title").trim(), due_at: dueAt.toISOString() });
      scheduleReminder(record);
      event.target.reset();
      speech.speak(`Reminder set for ${dueAt.toLocaleString()}. Keep VisionMate open for this browser reminder.`);
    } catch (error) {
      console.error("Could not set reminder:", error); speech.speak(error.message); toast(error.message);
    }
  } else if (event.target.id === "profile-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    state.profile = { ...state.profile, firstName: form.get("firstName").trim(), lastName: form.get("lastName").trim(), age: form.get("age") ? Number(form.get("age")) : "", gender: form.get("gender"), email: form.get("email").trim() };
    auth.saveProfile(state.profile);
    logActivity("profile_updated");
    syncProfile(state.profile);
    speech.speak("Profile saved on this device.");
    toast("Profile saved.");
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "settings-language") {
    state.language = event.target.value;
    speech.setLanguage(state.language);
    localStorage.setItem("visionmate.language", state.language);
    persistSettings({ language: state.language });
    speech.speak(`Spoken language set to ${APP_CONFIG.languages[state.language].name}.`);
    setPage("me", false);
  } else if (event.target.id === "source-language") {
    if (document.querySelector("#translation-output")) document.querySelector("#translation-output").textContent = "";
  } else if (event.target.id === "target-language") {
    localStorage.setItem("visionmate.translationTarget", event.target.value);
    persistSettings({ translationTarget: event.target.value });
    if (document.querySelector("#translation-output")) document.querySelector("#translation-output").textContent = "";
    speech.speak(`Translation target set to ${APP_CONFIG.languages[event.target.value].name}.`);
  } else if (event.target.id === "translation-provider") {
    localStorage.setItem("visionmate.translationProvider", event.target.value);
    persistSettings({ translationProvider: event.target.value });
    speech.speak(`Translation provider set to ${event.target.options[event.target.selectedIndex].text}.`);
  } else if (event.target.id === "speech-rate") {
    speech.rate = Number(event.target.value);
    persistSettings({ speechRate: speech.rate });
    speech.speak("Speech speed updated.");
  } else if (event.target.id === "speech-voice") {
    speech.voiceName = event.target.value;
    localStorage.setItem("visionmate.voice", speech.voiceName);
    persistSettings({ speechVoice: speech.voiceName });
    speech.speak("Speech voice updated.");
  } else if (event.target.id === "app-theme") {
    updateAppearance(event.target.value);
    persistSettings({ theme: event.target.value });
    speech.speak(`VisionMate appearance changed to ${event.target.value}. This affects VisionMate only.`);
  } else if (event.target.id === "battery-toggle") {
    state.batteryAlerts = event.target.checked;
    localStorage.setItem("visionmate.batteryAlerts", state.batteryAlerts ? "on" : "off");
    persistSettings({ batteryAlerts: state.batteryAlerts });
    speech.speak(state.batteryAlerts ? "Battery alerts are on." : "Battery alerts are off.");
  } else if (event.target.id === "gemini-model") {
    localStorage.setItem("visionmate.model", event.target.value);
    persistSettings({ geminiModel: event.target.value });
    speech.speak(event.target.value === "auto" ? "Gemini model set to automatic fallback." : `Gemini model preference set to ${event.target.options[event.target.selectedIndex].text}. The server may fall back to other configured models.`);
  }
});

document.querySelector("#audio-toggle").addEventListener("click", event => {
  speech.enabled = !speech.enabled;
  event.currentTarget.setAttribute("aria-label", speech.enabled ? "Turn spoken feedback off" : "Turn spoken feedback on");
  event.currentTarget.innerHTML = speech.enabled
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm6 4 5 6m0-6-5 6"/></svg>';
  if (speech.enabled) speech.speak("Spoken feedback is on.");
  else { window.speechSynthesis?.cancel(); document.querySelector("#live-feedback").textContent = "Spoken feedback is off."; }
});

window.addEventListener("beforeunload", () => state.camera?.stop());
window.addEventListener("beforeunload", () => {
  if (state.locationWatchId !== null) navigator.geolocation?.clearWatch(state.locationWatchId);
});
window.speechSynthesis?.addEventListener("voiceschanged", loadSpeechVoices);
updateAppearance(localStorage.getItem("visionmate.theme") || "dark");
setPage(auth.getSession() ? "home" : (auth.getProfile() ? "auth" : "welcome"), false);
if (!auth.getProfile() && !auth.getSession()) {
  setTimeout(() => speech.speak(APP_CONFIG.languages[state.language].greeting), 350);
}
