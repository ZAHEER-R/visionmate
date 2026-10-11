import { APP_CONFIG } from "./config.js";
import { auth } from "./auth.js";
import { speech } from "./speech.js";
import { CameraController } from "./camera.js";
import { answerFor } from "./intent.js";
import { animateView, pressFeedback, setVisionActive } from "./gsap-animations.js";
import {
  invokeAssistant, saveOwnedRecord, listOwnedRecords, deleteOwnedRecord, saveProfileRecord,
  loadProfileRecord, loadLatestConversation, saveChatMessage, saveActivityEvent, loadUserSettings, saveUserSettings
} from "./supabase.js";
import { machineTranslate } from "./mt.js";
import { speakWithProvider } from "./tts.js";
import { recordWav, stopRecording } from "./stt.js";
import { runAnuvaadhub } from "./anuvaadhub.js";
import { saveFirebaseProfile } from "./firebase.js";
import { getWalkingRoute } from "./routes.js";

const root = document.querySelector("#view-root");
const nav = document.querySelector("#bottom-nav");
const state = {
  page: "welcome",
  navigationHistory: [],
  profile: auth.getProfile() || {},
  onboarding: {},
  authMode: null,
  authStep: 0,
  visionActive: false,
  visionMonitorTimer: null,
  visionMonitoring: false,
  assistanceMode: localStorage.getItem("visionmate.assistanceMode") || "describe",
  privacyMode: localStorage.getItem("visionmate.privacyMode") !== "off",
  camera: null,
  cameraZoom: Math.max(1, Math.min(4, Number(localStorage.getItem("visionmate.cameraZoom")) || 1)),
  map: null,
  mapMarker: null,
  routeMap: null,
  locationWatchId: null,
  menuPhotoUrl: null,
  pendingCall: null,
  emergencyLocation: null,
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
if (!localStorage.getItem("visionmate.speechEngine") && state.language !== "en") {
  speech.setEngine("gemini");
  localStorage.setItem("visionmate.speechEngine", "gemini");
}

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

function setPage(page, announce = true, recordHistory = true) {
  if (recordHistory && state.page && state.page !== page) state.navigationHistory.push(state.page);
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
    go: renderGo,
    vision: renderVision,
    voice: renderVoice,
    translate: renderTranslate,
    me: renderMe,
    permissions: renderPermissions,
    emergency: renderEmergency
  };
  if (page !== "vision") stopVisionMonitoring();
  if (page !== "vision" && state.visionActive) {
    state.camera?.stop();
    state.camera = null;
    state.visionActive = false;
  }
  (pages[page] || renderHome)();
  nav.hidden = false;
  nav.querySelectorAll("[data-nav]").forEach(button => {
    if (button.dataset.nav === page) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const lensButton = nav.querySelector('[data-action="open-vision-lens"]');
  if (lensButton) {
    if (page === "vision") lensButton.setAttribute("aria-current", "page");
    else lensButton.removeAttribute("aria-current");
  }
  const target = root.firstElementChild;
  animateView(target);
  document.querySelector("#main-content").focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (announce) speech.speak(pageAnnouncement(page));
}

function selectedGeminiModel() {
  const preference = localStorage.getItem("visionmate.model") || "auto";
  return preference === "auto" ? undefined : preference;
}

function pageAnnouncement(page) {
  const messages = {
    welcome: "VisionMate is ready. Camera and microphone start only when you ask.",
    onboarding: "Let’s get to know you. I’ll ask a few short questions.",
    auth: "Choose how you would like to continue.",
    home: `Welcome${state.profile.firstName ? `, ${state.profile.firstName}` : ""}. Home is ready.`,
    go: "Where would you like to go? Go can show an informational distance and time estimate, not turn-by-turn or safety guidance.",
    vision: "Vision assist. Optional camera analysis can be wrong and cannot detect hazards or guide movement.",
    voice: "Voice agent. Ask a question or type a command.",
    translate: "Translator. Enter text and choose a language.",
    me: "Profile and settings.",
    permissions: "Permission setup. You control whether each permission is allowed.",
    emergency: "Emergency support. Phone calls require your confirmation and device support."
  };
  return messages[page] || "";
}

function languageConfirmation(language) {
  return {
    en: "Spoken language set to English.",
    hi: "बोली जाने वाली भाषा हिंदी पर सेट है।",
    ta: "பேசும் மொழி தமிழாக மாற்றப்பட்டது.",
    te: "మాట్లాడే భాష తెలుగుకు మార్చబడింది.",
    kn: "ಮಾತನಾಡುವ ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಿಸಲಾಗಿದೆ.",
    ml: "സംസാരിക്കുന്ന ഭാഷ മലയാളത്തിലേക്ക് മാറ്റി.",
    pa: "ਬੋਲੀ ਜਾਣ ਵਾਲੀ ਭਾਸ਼ਾ ਪੰਜਾਬੀ ਵਿੱਚ ਬਦਲ ਦਿੱਤੀ ਗਈ ਹੈ."
  }[language];
}

function firebaseConfigurationReady() {
  return ["apiKey", "authDomain", "projectId", "appId"].every(key => {
    const value = APP_CONFIG.firebase[key];
    return typeof value === "string" && value.length > 0 && !value.startsWith("YOUR_");
  });
}

function renderWelcome() {
  root.innerHTML = `<div class="page app-page">
    <section class="app-greeting"><div><div class="eyebrow">VISIONMATE · ASSIST</div><h1>What do you need?</h1><p>Use VisionMate as a guest or sign in to sync your account.</p></div><span class="app-language">${APP_CONFIG.languages[state.language].name}</span></section>
    <section class="app-action-grid" aria-label="VisionMate tools">
      <button class="app-action-card app-action-primary" type="button" data-action="open-vision-lens"><span>${icon("eye")}</span><strong>Open Vision Lens</strong><small>Start camera with your permission</small></button>
      <button class="app-action-card" type="button" data-action="start-guest"><span>${icon("arrow")}</span><strong>Continue as guest</strong><small>Use features with local-only data</small></button>
      <button class="app-action-card" type="button" data-action="emergency"><span>!</span><strong>Emergency help</strong><small>Call or share location</small></button>
      <button class="app-action-card" type="button" data-action="login"><span>${icon("shield")}</span><strong>Sign in</strong><small>Optional cloud sync</small></button>
    </section>
    <section class="offline-card"><span class="status-dot"></span><div><strong id="offline-status">Checking connection…</strong><p>Emergency contacts and on-device speech may still work offline. Visual AI needs internet.</p></div></section>
    <p class="safety-note">Camera and microphone start only when you ask. VisionMate cannot confirm that walking routes are safe; keep using your mobility aid.</p>
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
    const firebaseReady = firebaseConfigurationReady();
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
      <div class="form-actions"><button class="button button-primary" type="button" data-action="start-guest">Skip sign-in · continue as guest</button></div>
      <p class="footer-note">${firebaseReady ? "Google and email sign-in use Firebase Authentication." : "Account actions are disabled until Firebase is configured; VisionMate will not create a fake login session."}</p>
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
  const activity = readLocalActivity();
  const chatHistory = readLocalChatHistory();
  root.innerHTML = `<div class="page app-page">
    <section class="app-greeting"><div><div class="eyebrow">YOUR ASSISTANT</div><h1>Hello, ${firstName}</h1><p>What would you like help with?</p></div><button class="app-profile-button" type="button" data-nav="me" aria-label="Open profile and settings">${icon("shield")}</button></section>
    <button class="quick-ask-card" type="button" data-action="open-vision-lens"><span>${icon("eye")}</span><div><strong>Open Vision Lens</strong><small>Start the camera and ask it to read a menu, label, or document</small></div><b>›</b></button>
    <div class="app-section-title"><h2>Your tools</h2><span>Tap to start</span></div>
    <section class="app-action-grid" aria-label="Assistive features">
      <button class="app-action-card app-action-primary" type="button" data-action="open-vision-lens"><span>${icon("eye")}</span><strong>Vision Lens</strong><small>Open the camera and read a menu or document</small></button>
      <button class="app-action-card" type="button" data-nav="voice"><span>${icon("mic")}</span><strong>Ask anything</strong><small>Voice, notes, reminders</small></button>
      <button class="app-action-card" type="button" data-nav="translate"><span>${icon("language")}</span><strong>Translate</strong><small>Speak in your language</small></button>
      <button class="app-action-card app-action-emergency" type="button" data-action="emergency"><span>!</span><strong>Emergency</strong><small>Call trusted contact</small></button>
    </section>
    <section class="insights-panel panel" aria-label="Your local usage insights">
      <div class="app-section-title"><h2>Insights</h2><span>On this device</span></div>
      <div class="insights-grid">
        <div><strong>${activity.filter(item => item.type === "vision_analysis").length}</strong><span>Image reads</span></div>
        <div><strong>${getLocalItems("notes").length}</strong><span>Saved notes</span></div>
        <div><strong>${chatHistory.length}</strong><span>Chat messages</span></div>
      </div>
    </section>
    <section class="offline-card"><span class="status-dot"></span><div><strong id="offline-status">Checking connection…</strong><p>Local emergency tools can open offline. Visual AI and cloud sync need internet.</p></div>    </section>
    <p class="safety-note"><strong>For awareness only.</strong> VisionMate cannot guide walking, detect hazards reliably, or confirm a crossing is safe. Keep using your mobility aid.</p>
  </div>`;
  updateConnectionStatus();
  state.permissionChecked = true;
}

function renderPermissions() {
  const permissions = [
    ["camera", "Camera", "Show a live camera preview. No hazard detection is available."],
    ["location", "Location", "Share your location only when you choose, including with SOS."],
    ["notifications", "Notifications", "Receive helpful reminders from this device."],
    ["microphone", "Microphone", "Use speech recognition when supported by your browser."],
    ["overlay", "Display over other apps", "Native Android permission. A website cannot request or enable this permission."]
  ];
  root.innerHTML = `<div class="page">
    <div class="page-intro"><div class="eyebrow">Optional device access</div><h2>Your permissions</h2><p class="lead">Each permission is optional and requested only after you choose Allow.</p></div>
    <div class="status-banner">${icon("shield")}<div><strong>You’re in control</strong><p>VisionMate will ask your browser only after you tap a permission button. You can skip any of them.</p></div></div>
    <div class="permission-grid">${permissions.map(([key,label,description]) => `<div class="permission-item" data-animate><div><strong>${label}</strong><span>${description}</span></div>${key === "overlay" ? '<span class="permission-unavailable">Native app only</span>' : `<button class="button button-secondary" type="button" data-action="permission" data-permission="${key}">Allow</button>`}</div>`).join("")}</div>
    <p class="footer-note">“Display over other apps” is unavailable in this web app. It requires a separately built Android app with the appropriate OS permission and user approval.</p>
    <div class="form-actions"><button class="button button-primary" type="button" data-action="permissions-done">Continue to Home ${icon("arrow")}</button></div>
  </div>`;
}

function renderVision() {
  root.innerHTML = `<div class="page">
    <div class="section-head"><div class="page-intro"><div class="eyebrow">VISION ASSIST</div><h2>What should I help with?</h2><p class="lead">Choose a focus, then start the camera when you are ready.</p></div></div>
    <div class="companion-layout">
      <section id="vision-preview" class="vision-preview ${state.visionActive ? "active" : ""}" aria-label="Camera preview panel">
        <video id="camera-video" class="camera-video ${state.visionActive ? "" : "hidden"}" autoplay muted playsinline aria-label="Live camera preview"></video>
        <div class="camera-visual ${state.visionActive ? "hidden" : ""}" aria-hidden="true"><div class="camera-frame"></div><div class="camera-eye">${icon("eye")}</div></div>
        <img id="menu-photo" class="menu-photo hidden" alt="Camera image captured for analysis">
        <div class="preview-top"><span class="live-label"><span class="status-dot"></span><span id="vision-status">${getCameraStatusLabel()}</span></span><span class="confidence">AI · unverified</span></div>
        <div class="preview-bottom"><div class="preview-caption"><strong id="vision-caption">Your camera is off</strong><span id="vision-detail">Start a preview when safely stationary. Nothing is analyzed until you request it.</span></div></div>
      </section>
      <aside class="companion-controls">
        <div class="field"><label for="assistance-mode">Personal assistance focus</label><select id="assistance-mode">
          <option value="describe" ${state.assistanceMode === "describe" ? "selected" : ""}>Describe this scene</option>
          <option value="reading" ${state.assistanceMode === "reading" ? "selected" : ""}>Read text & documents</option>
          <option value="shopping" ${state.assistanceMode === "shopping" ? "selected" : ""}>Shopping & product details</option>
          <option value="indoor" ${state.assistanceMode === "indoor" ? "selected" : ""}>Indoor signs & landmarks</option>
          <option value="directional" ${state.assistanceMode === "directional" ? "selected" : ""}>Describe left / center / right in image</option>
        </select></div>
        <button id="camera-toggle" class="button button-primary button-large" type="button" data-action="toggle-camera">${icon("eye")} ${state.visionActive ? "Stop camera preview" : "Start camera preview"}</button>
        <div class="camera-controls" aria-label="Camera controls">
          <div class="field camera-zoom-control"><label for="camera-zoom">Camera zoom <output id="camera-zoom-value" for="camera-zoom">${state.cameraZoom.toFixed(1)}x</output></label><input id="camera-zoom" type="range" min="1" max="4" step="0.5" value="${state.cameraZoom}" aria-describedby="camera-zoom-help" ${state.visionActive ? "" : "disabled"}><small id="camera-zoom-help">Uses camera zoom when available; otherwise enlarges and crops the preview.</small></div>
          <div class="vision-tools"><button class="button button-secondary" type="button" data-action="switch-camera" ${state.visionActive ? "" : "disabled"}>Switch front / rear camera</button><button class="button button-secondary" type="button" data-action="fullscreen-camera" ${state.visionActive ? "" : "disabled"}>Fullscreen preview</button></div>
        </div>
        <div class="vision-tools">
          <button class="button button-secondary" type="button" data-action="capture-focus">Run my focus</button>
          <button class="button button-secondary" type="button" data-action="capture-document">Capture & read text</button>
        </div>
        <form id="vision-command" class="voice-command"><input id="vision-text" aria-label="Ask a question about the camera view" placeholder="Ask about this view…" autocomplete="off"><button class="button button-primary" type="submit" aria-label="Ask VisionMate">${icon("arrow")}</button></form>
        <div class="vision-tools"><button class="button button-secondary" type="button" data-action="listen-vision">${icon("mic")} Ask by voice</button><button class="button button-secondary" type="button" data-action="object-search">Find an object</button></div>
        <div class="monitor-card"><div><strong>Periodic scene updates</strong><small>One image every 30 seconds · keep app open · stop anytime</small></div><button class="button button-secondary" type="button" data-action="monitor-toggle">${state.visionMonitoring ? "Stop updates" : "Start updates"}</button></div>
        <label class="privacy-control"><input id="privacy-mode" type="checkbox" ${state.privacyMode ? "checked" : ""}><span><strong>People privacy mode</strong><small>Ask AI not to describe or identify people. Does not blur or mask the image.</small></span></label>
        <div class="safety-note"><strong>Not navigation or hazard detection.</strong> Left/right refers only to position inside this single camera image. Do not use VisionMate while walking or crossing. Indoor signs can be described; this app cannot guide you to a room.</div>
        <p class="footer-note">When you request AI analysis, one still image is sent to the configured provider. Review that provider’s data policy and avoid capturing people or sensitive documents without consent.</p>
        <button class="button button-danger" type="button" data-action="emergency">Emergency support</button>
      </aside>
    </div>
    <section class="panel map-panel"><div class="map-heading"><div><div class="eyebrow">LOCATION ONLY</div><h3>My position</h3><p class="muted">Location tracking starts only when requested. This is not indoor or turn-by-turn navigation.</p></div><button class="button button-secondary" type="button" data-action="track-location">Show location</button></div><div id="location-map" role="region" aria-label="Map showing your current location"></div><p id="location-status" class="footer-note" aria-live="polite">Location is off.</p></section>
  </div>`;
  setVisionActive(state.visionActive);
  initializeMap();
}

function getCameraStatusLabel() {
  const track = state.camera?.stream?.getVideoTracks?.()[0];
  if (!state.visionActive || track?.readyState !== "live") return "CAMERA OFF";
  return `${state.camera.facingMode === "user" ? "FRONT" : "REAR"} CAMERA ON`;
}

function renderEmergency() {
  const offlineMode = localStorage.getItem("visionmate.emergencyMode") === "on";
  const trustedPhone = localStorage.getItem(emergencyContactKey()) || "";
  root.innerHTML = `<div class="page emergency-page">
    <div class="page-intro"><div class="eyebrow">EMERGENCY SUPPORT</div><h2>Get help from someone you trust.</h2><p class="lead">Use these tools only as you choose. The app does not automatically contact emergency services.</p></div>
    <section class="offline-card emergency-status"><span class="status-dot"></span><div><strong id="emergency-connection">${navigator.onLine ? "Online" : "Offline"} · emergency screen available</strong><p>Calls use your phone connection. Text messages may need cellular service. Location may be unavailable indoors.</p></div></section>
    <section class="panel emergency-contact-panel"><h3>Trusted contact</h3><form id="emergency-contact-form" class="form-stack">
      <div class="field"><label for="emergency-phone">Phone number</label><input id="emergency-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(trustedPhone)}" placeholder="+1 555 000 0000" required></div>
      <button class="button button-secondary" type="submit">Save on this device</button>
    </form>
    <div class="emergency-actions"><button class="button button-danger" type="button" data-action="emergency-call" ${trustedPhone ? "" : "disabled"}>Call trusted contact</button><button class="button button-secondary" type="button" data-action="emergency-location">Get my location</button><button class="button button-secondary" type="button" data-action="emergency-sms" ${trustedPhone ? "" : "disabled"}>Prepare location text</button></div>
    <p id="emergency-location-output" class="translation-output" aria-live="polite">Location has not been requested.</p></section>
    <section class="panel offline-mode-panel"><label class="setting-row"><span><strong>Offline emergency screen</strong><span>Keep this help screen available when network is lost.</span></span><input id="offline-emergency-mode" class="switch" type="checkbox" ${offlineMode ? "checked" : ""}></label><p class="safety-note">Offline mode does not provide AI vision, automatic hazard alerts, or guaranteed emergency messaging. Keep local emergency numbers and contacts available.</p></section>
    <button class="button button-secondary" type="button" data-action="emergency-back">Back to VisionMate</button>
  </div>`;
}

function renderVoice() {
  state.conversationId = null;
  state.conversationPromise = null;
  state.conversationHistoryLoaded = false;
  root.innerHTML = `<div class="page"><div class="page-intro"><div class="eyebrow">Voice agent</div><h2>Tell me what’s on your mind.</h2><p class="lead">Press and hold Talk or use browser voice input. Say “open Vision Lens” or “read this menu” to start the camera and ask Gemini to read one still image.</p></div>
    <section class="panel" style="padding:22px">
      <div id="conversation" class="conversation" aria-label="Conversation with VisionMate"><div class="message" data-welcome-message>Hi${state.profile.firstName ? ` ${escapeHtml(state.profile.firstName)}` : ""}. I can save notes and reminders, open supported websites, and start a phone call after your confirmation. I cannot close apps or control phone-wide settings.</div></div>
      <p id="voice-caption" class="voice-caption" aria-live="polite">Your live speech transcript will appear here.</p>
      <form id="voice-command" class="voice-command" style="margin-top:15px"><input id="voice-text" aria-label="Type a message for VisionMate" placeholder="Try “open Vision Lens” or “read this menu”…" autocomplete="off"><button class="button button-primary" type="submit" aria-label="Send message">${icon("arrow")}</button></form>
      <div class="form-actions"><button id="push-to-talk" class="button button-primary push-to-talk" type="button" aria-label="Press and hold to speak">${icon("mic")} Press and hold to talk</button><button class="button button-secondary" type="button" data-action="listen-voice">${icon("mic")} Browser voice input</button><button id="anuvaadhub-record" class="button button-secondary" type="button" data-action="record-anuvaadhub">Record WAV · Anuvaadhub ASR</button><button class="button button-secondary" type="button" data-action="sos">SOS · share location</button></div>
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
      <section class="panel tool-card"><h3>Anuvaadhub text to speech</h3><p class="muted">Provider limit: 30 words; letters, numbers, and spaces only. Select one of the seven supported languages.</p>
        <form id="tts-form" class="form-stack"><div class="field"><label for="tts-input">Text to speak</label><textarea id="tts-input" name="text" maxlength="300" required placeholder="Enter a short phrase"></textarea></div><div class="field"><label for="tts-language">Speech language</label><select id="tts-language" name="language">${languageOptions(state.language)}</select></div><div class="field"><label for="tts-gender">Provider voice</label><select id="tts-gender" name="gender"><option value="female">Female</option><option value="male">Male</option></select></div><button class="button button-primary" type="submit">Speak with Anuvaadhub</button></form>
      </section>
    </div>
    <p class="footer-note">Visual and spoken AI may be wrong. Phone actions require your confirmation and device support; this website cannot control phone-wide settings or other apps.</p></div>`;
  renderSavedItems();
  getLocalItems("reminders").forEach(scheduleReminder);
  loadCloudItems();
  restoreConversation();
  bindPushToTalk();
}

function bindPushToTalk() {
  const button = document.querySelector("#push-to-talk");
  if (!button) return;
  let listening = false;
  const start = event => {
    if (listening || (event.type === "keydown" && event.repeat)) return;
    listening = true;
    event.preventDefault();
    button.classList.add("is-listening");
    button.textContent = "Listening · release to send";
    const caption = document.querySelector("#voice-caption");
    speech.listen({
      onResult: text => {
        if (caption) caption.textContent = `You said: ${text}`;
        handleCommand(text).catch(error => {
          console.error("Press-and-hold voice command failed:", error);
          speech.speak(`I could not complete that request. ${error.message}`);
          toast(error.message);
        });
      },
      onTranscript: text => { if (caption) caption.textContent = `Listening: ${text}`; },
      onError: message => { if (caption) caption.textContent = message; speech.speak(message); toast(message); }
    });
  };
  const stop = () => {
    if (!listening) return;
    listening = false;
    button.classList.remove("is-listening");
    button.textContent = "Press and hold to talk";
    speech.stopListening();
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("lostpointercapture", stop);
  button.addEventListener("keydown", event => {
    if (event.key === " " || event.key === "Enter") start(event);
  });
  button.addEventListener("keyup", event => {
    if (event.key === " " || event.key === "Enter") stop();
  });
}

function getLocalItems(kind) {
  try { return JSON.parse(localStorage.getItem(localItemsKey(kind)) || "[]"); }
  catch (error) { console.error(`Could not read ${kind}:`, error); return []; }
}

function localItemsKey(kind) {
  const userId = auth.getUserId() || (auth.isGuest() ? "guest" : null);
  return userId ? `visionmate.${userId}.${kind}` : `visionmate.${kind}`;
}

function readLocalChatHistory() {
  try {
    return JSON.parse(localStorage.getItem(localChatHistoryKey()) || "[]");
  } catch (error) {
    console.error("Could not read local chat history:", error);
    return [];
  }
}

function readLocalActivity() {
  try {
    return JSON.parse(localStorage.getItem(localActivityKey()) || "[]");
  } catch (error) {
    console.error("Could not read local insights:", error);
    return [];
  }
}

function localChatHistoryKey() {
  return `visionmate.${auth.getUserId() || (auth.isGuest() ? "guest" : "device")}.chatHistory`;
}

function localActivityKey() {
  return `visionmate.${auth.getUserId() || (auth.isGuest() ? "guest" : "device")}.localActivity`;
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
  const localRecord = {
    ...item,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    _pendingSync: Boolean(auth.getUserId())
  };
  localItems.unshift(localRecord);
  localStorage.setItem(localItemsKey(kind), JSON.stringify(localItems));
  const table = { notes: "notes", contacts: "contacts", reminders: "reminders" }[kind];
  if (table && auth.getUserId()) {
    try {
      const record = await saveOwnedRecord(table, item);
      if (record) {
        localItems[0] = { ...record, _pendingSync: false };
        localStorage.setItem(localItemsKey(kind), JSON.stringify(localItems));
      }
    } catch (error) {
      logActivity("cloud_sync_failed", { kind }, "failed");
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
  const engine = document.querySelector("#speech-engine");
  if (engine) engine.value = speech.engine;
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

function renderGo() {
  root.innerHTML = `<div class="page">
    <div class="page-intro"><div class="eyebrow">GO · ROUTE ESTIMATE</div><h2>Where would you like to go?</h2><p class="lead">Get an approximate pedestrian-route distance and time from your current location.</p></div>
    <section class="panel route-panel">
      <form id="route-form" class="route-form">
        <div class="field"><label for="route-destination">Destination</label><input id="route-destination" name="destination" type="text" maxlength="120" autocomplete="street-address" placeholder="For example, Charminar, Hyderabad" required></div>
        <label class="route-consent"><input id="route-consent" name="routeConsent" type="checkbox" required><span>I agree to share my current location and destination with Photon place search and Valhalla routing (public OpenStreetMap-based services) for this estimate. VisionMate does not store them.</span></label>
        <button class="button button-primary" type="submit">Estimate distance and time</button>
      </form>
      <p id="route-result" class="route-result" role="status" aria-live="polite">No route estimate requested.</p>
      <section id="route-map-container" class="route-map-container" hidden aria-label="Route map">
        <h3 id="route-map-heading">Estimated pedestrian route</h3>
        <div id="route-map" role="region" aria-label="Map showing the estimated route from your current location to the destination"></div>
        <p class="footer-note">This public route is not verified for accessibility or safety. Map tiles are provided by OpenStreetMap.</p>
      </section>
      <div class="safety-note"><strong>Informational only.</strong> Distance and time are estimates, not turn-by-turn directions. The route may omit sidewalks, accessible crossings, closures, or hazards. Do not rely on it for safe travel; use a validated navigation aid and your mobility aid or trusted assistance.</div>
    </section>
  </div>`;
}

function renderMe() {
  const profile = state.profile;
  const storageCopy = auth.isGuest()
    ? "Guest notes, settings, and chat history are stored only in this browser on this device."
    : "Profile and assistant history sync to your signed-in account. Device permissions and emergency numbers stay on this device.";
  root.innerHTML = `<div class="page"><div class="page-intro"><div class="eyebrow">Your space</div><h2>Profile & settings</h2><p class="lead">${storageCopy}</p></div>
    <section id="profile-card" class="panel profile-card">
      <button class="profile-card-toggle" type="button" data-action="toggle-profile" aria-expanded="false" aria-controls="profile-card-content">
        <span><strong>Your profile</strong><span id="profile-summary">${escapeHtml([profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Add your name")}${profile.email ? ` · ${escapeHtml(profile.email)}` : ""}</span></span><span class="profile-expand-label">Show details</span>
      </button>
      <div id="profile-card-content" class="profile-card-content" aria-hidden="true" inert>
        <div class="profile-card-actions"><button type="button" class="button button-secondary" data-action="edit-profile">Edit profile</button><button type="button" class="button button-secondary" data-action="close-profile">Close</button></div>
        <form id="profile-form" class="profile-grid" hidden>
          <div class="field"><label for="profile-first">First name</label><input id="profile-first" name="firstName" value="${escapeHtml(profile.firstName || "")}"></div>
          <div class="field"><label for="profile-last">Last name</label><input id="profile-last" name="lastName" value="${escapeHtml(profile.lastName || "")}"></div>
          <div class="field"><label for="profile-age">Age</label><input id="profile-age" name="age" type="number" min="1" max="120" value="${escapeHtml(profile.age || "")}"></div>
          <div class="field"><label for="profile-gender">Gender</label><select id="profile-gender" name="gender"><option value="">Choose</option>${["Woman","Man","Non-binary","Prefer not to say","Self-describe"].map(value => `<option ${profile.gender === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
          <div class="field"><label for="profile-email">Email</label><input id="profile-email" type="email" name="email" value="${escapeHtml(profile.email || "")}" autocomplete="email"></div>
          <div class="form-actions"><button type="submit" class="button button-primary">Save profile</button></div>
        </form>
      </div>
    </section>
    <section class="panel history-panel"><div class="app-section-title"><h2>Recent chat history</h2><span>Saved on this device</span></div><div id="profile-chat-history" class="profile-chat-history"><p class="muted">Loading recent messages…</p></div></section>
    <section style="margin-top:20px"><h3>Preferences</h3><div class="settings-grid">
      <label class="setting-row"><span><strong>Spoken language</strong><span>Voice prompts and speech</span></span><select id="settings-language">${languageOptions()}</select></label>
      <label class="setting-row"><span><strong>Speech voice</strong><span>Choose an installed device voice</span></span><select id="speech-voice" aria-label="Speech voice"></select></label>
      <label class="setting-row"><span><strong>Speech engine</strong><span>Gemini translates and speaks selected-language feedback online; device voice is faster and can work offline.</span></span><select id="speech-engine" aria-label="Speech engine"><option value="device">Device voice · fast/offline</option><option value="gemini">Gemini voice · online/multilingual</option></select></label>
      <label class="setting-row"><span><strong>Speech speed</strong><span>Adjust spoken feedback pace</span></span><input id="speech-rate" type="range" min="0.7" max="1.2" step="0.05" value="${speech.rate}" aria-label="Speech speed"></label>
      <label class="setting-row"><span><strong>Gemini assistant model</strong><span>Fallback tries configured models if rate-limited</span></span><select id="gemini-model" aria-label="Gemini assistant model"><option value="auto">VisionMate Auto (configured fallback)</option><option value="gemini-2.5-flash">Gemini Flash</option><option value="gemini-2.5-flash-lite">Gemini Flash Lite</option></select></label>
      <label class="setting-row"><span><strong>VisionMate appearance</strong><span>Change this app only, not phone settings</span></span><select id="app-theme" aria-label="VisionMate appearance"><option value="light">Orange and light</option><option value="dark">Dark</option></select></label>
      <label class="setting-row"><span><strong>Battery alerts</strong><span>Warn when battery is low</span></span><input id="battery-toggle" class="switch" type="checkbox" checked aria-label="Battery alerts"></label>
      <div class="setting-row"><span><strong>Battery level</strong><span id="battery-description">Checking device support…</span></span><div class="battery-level"><div class="battery-icon"><div id="battery-fill" class="battery-fill"></div></div><span id="battery-value">—</span></div></div>
    </div></section>
    <section class="panel" style="padding:22px;margin-top:22px"><h3>Permissions</h3><p class="muted">Camera, location, microphone, and notifications are optional. Manage them in your browser’s site settings or review permissions below.</p><button class="button button-secondary" type="button" data-action="permissions">Review permissions</button></section>
    <div class="form-actions"><button class="button button-danger" type="button" data-action="sign-out">${auth.isGuest() ? "Exit guest session" : "Sign out"}</button></div>
    <p class="footer-note">Android “display over other apps” requires a separate native Android implementation. This web app cannot access or control other apps.</p>
  </div>`;
  monitorBattery();
  document.querySelector("#battery-toggle").checked = state.batteryAlerts;
  loadSpeechVoices();
  document.querySelector("#app-theme").value = document.documentElement.dataset.theme || "light";
  document.querySelector("#gemini-model").value = localStorage.getItem("visionmate.model") || "auto";
  document.querySelector("#speech-engine").value = speech.engine;
  renderProfileChatHistory();
  restoreAccountSettings();
}

async function estimateWalkingRoute(form) {
  const destination = document.querySelector("#route-destination")?.value.trim();
  const result = document.querySelector("#route-result");
  const submit = form.querySelector('button[type="submit"]');
  if (!destination || !form.reportValidity()) return;
  if (!navigator.geolocation) throw new Error("Location is not supported by this browser.");
  result.textContent = "Requesting your location, then looking up one route estimate. Location and destination will be sent to Photon and Valhalla.";
  submit.disabled = true;
  speech.speak("Requesting your location for an informational route estimate. Your location and destination will be sent to Photon and Valhalla. This is not safety guidance.");
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    }));
    const route = await getWalkingRoute({
      origin: { latitude: position.coords.latitude, longitude: position.coords.longitude },
      destination,
      language: state.language
    });
    const distance = `${route.distanceKm.toFixed(1)} kilometres`;
    const minutes = Math.max(1, Math.round(route.durationSeconds / 60));
    const summary = `Approximate walking route to ${route.destinationName}: ${distance}, about ${minutes} minutes. This is not turn-by-turn or safety guidance.`;
    result.textContent = summary;
    const mapContainer = document.querySelector("#route-map-container");
    if (mapContainer) mapContainer.hidden = false;
    initializeRouteMap(route);
    logActivity("route_estimate_requested", { provider: "openstreetmap" }, "performed");
    speech.speak(summary);
  } catch (error) {
    console.error("Could not estimate a walking route:", error);
    result.textContent = `Route estimate unavailable: ${error.message}`;
    speech.speak(`Route estimate unavailable. ${error.message}`);
  } finally {
    if (submit.isConnected) submit.disabled = false;
  }
}

async function renderProfileChatHistory() {
  const target = document.querySelector("#profile-chat-history");
  if (!target) return;
  try {
    const history = auth.getUserId()
      ? (await getConversation())?.messages || []
      : readLocalChatHistory();
    target.innerHTML = history.length
      ? history.slice(-12).map(message =>
        `<p class="profile-chat-line ${message.role === "user" ? "profile-chat-user" : ""}"><strong>${message.role === "user" ? "You" : "VisionMate"}:</strong> ${escapeHtml(message.content)}</p>`
      ).join("")
      : '<p class="muted">Your conversations will appear here.</p>';
  } catch (error) {
    console.error("Could not load profile chat history:", error);
    target.innerHTML = `<p class="muted">Chat history unavailable: ${escapeHtml(error.message)}</p>`;
  }
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
  if (!auth.getUserId()) {
    return Promise.resolve({ id: "device", messages: readLocalChatHistory() });
  }
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
  const history = readLocalChatHistory();
  history.push({ role, content, created_at: new Date().toISOString() });
  localStorage.setItem(localChatHistoryKey(), JSON.stringify(history.slice(-200)));
  if (!auth.getUserId()) return;
  try {
    const conversation = await getConversation();
    if (conversation?.id) await saveChatMessage(conversation.id, role, content);
  } catch (error) {
    console.error("Could not sync chat message:", error);
    toast(`Chat saved on this device, but cloud sync failed: ${error.message}`);
  }
}

function logActivity(actionType, details = {}, status = "performed") {
  const activities = readLocalActivity();
  activities.push({ type: actionType, details, status, created_at: new Date().toISOString() });
  localStorage.setItem(localActivityKey(), JSON.stringify(activities.slice(-300)));
  if (!auth.getUserId()) return;
  saveActivityEvent(actionType, status, details).catch(error => {
    console.error("Could not save action history:", error);
    toast(`Action history could not be saved: ${error.message}`);
  });
}

function persistSettings(changes) {
  if (!auth.getUserId()) return;
  saveUserSettings(changes).catch(error => {
    console.error("Could not save account settings:", error);
    toast(`Settings changed on this device, but account sync failed: ${error.message}`);
  });
}

async function restoreAccountSettings() {
  if (!auth.getUserId()) return;
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
    if (settings.speechEngine === "device" || settings.speechEngine === "gemini") {
      speech.setEngine(settings.speechEngine);
      localStorage.setItem("visionmate.speechEngine", settings.speechEngine);
      const engineSelect = document.querySelector("#speech-engine");
      if (engineSelect) engineSelect.value = settings.speechEngine;
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
    if (["describe", "reading", "shopping", "indoor", "directional"].includes(settings.assistanceMode)) {
      state.assistanceMode = settings.assistanceMode;
      localStorage.setItem("visionmate.assistanceMode", settings.assistanceMode);
      const modeSelect = document.querySelector("#assistance-mode");
      if (modeSelect) modeSelect.value = settings.assistanceMode;
    }
    if (typeof settings.privacyMode === "boolean") {
      state.privacyMode = settings.privacyMode;
      localStorage.setItem("visionmate.privacyMode", settings.privacyMode ? "on" : "off");
      const privacyToggle = document.querySelector("#privacy-mode");
      if (privacyToggle) privacyToggle.checked = settings.privacyMode;
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
  const match = voices.find(voice => voice.lang.toLowerCase().startsWith(state.language) &&
    (voice.name.toLowerCase().includes(query.toLowerCase()) || voice.lang.toLowerCase().includes(query.toLowerCase())));
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
  const routeConsentMatch = /\b(?:i (?:agree|consent)|share my location|consent to share)\b/i.test(text);
  const routeDestinationMatch = text.match(/\b(?:estimate(?: distance and time)? to|estimate route to|route(?: estimate)? to|take me to|help me (?:get|reach)(?: to)?|navigate to|directions to|go to|visit|reach)\s+(.+?)(?:\s+from (?:my )?current location)?[.!?]*$/i);
  if (routeConsentMatch) {
    const destination = routeDestinationMatch?.[1]?.replace(/[.!?]+$/u, "").trim() ||
      (state.page === "go" ? document.querySelector("#route-destination")?.value.trim() : "");
    if (!destination) {
      setPage("go", false);
      const response = "Please tell me the destination you want estimated. I will request your location only after you agree to share it.";
      addMessage(response);
      speech.speak(response);
      return;
    }
    setPage("go", false);
    const form = document.querySelector("#route-form");
    document.querySelector("#route-destination").value = destination;
    document.querySelector("#route-consent").checked = true;
    addMessage(`You agreed to share your location and destination for an estimate to ${destination}.`);
    await estimateWalkingRoute(form);
    return;
  }
  const destinationMatch = text.match(/\b(?:estimate(?: route)? to|take me to|help me (?:get|reach)(?: to)?|navigate to|directions to|route to|go to|visit|reach)\s+(.+?)(?:\s+from (?:my )?current location)?[.!?]*$/i);
  if (destinationMatch?.[1]?.trim()) {
    const destination = destinationMatch[1].replace(/[.!?]+$/u, "").trim();
    setPage("go", false);
    document.querySelector("#route-destination").value = destination;
    const response = `I filled in ${destination}. I can show an informational distance and time estimate after you agree to share your location and destination. I cannot give turn-by-turn or safety guidance.`;
    addMessage(response);
    speech.speak(response);
    return;
  }
  if (/\b(?:open|show)\s+(?:the\s+)?(?:go|navigation|route estimates?)\b|\broute estimate\b/i.test(text)) {
    setPage("go", false);
    speech.speak("Go is ready. Enter or dictate a destination, review the location-sharing notice, and choose Estimate distance and time.");
    return;
  }
  if (/\b(?:open|launch|start|show|turn on|enable)\s+(?:the\s+)?(?:vision\s*lens|camera)\b|\bcamera on\b/i.test(text)) {
    await openVisionLens();
    return;
  }
  if (/\b(?:zoom in|zoom closer|zoom out|zoom back)\b/i.test(text)) {
    if (state.page !== "vision") await openVisionLens();
    if (!state.visionActive) return;
    const direction = /\b(?:zoom in|zoom closer)\b/i.test(text) ? 0.5 : -0.5;
    await setCameraZoom(state.cameraZoom + direction, true);
    return;
  }
  if (/\b(?:switch|flip|change)\s+(?:the\s+)?camera\b|\b(?:front|rear)\s+camera\b/i.test(text)) {
    if (state.page !== "vision") await openVisionLens();
    if (!state.visionActive) return;
    await switchCamera();
    return;
  }
  if (/\b(?:fullscreen|full screen)\b/i.test(text)) {
    if (state.page !== "vision") await openVisionLens();
    if (!state.visionActive) return;
    await toggleCameraFullscreen();
    return;
  }
  if (/\b(?:stop|turn off|turn the camera off|close)\s+(?:the\s+)?(?:vision\s*lens|camera|camera preview)\b|\bturn (?:the )?camera off\b|\bcamera off\b/i.test(text)) {
    if (state.page !== "vision") setPage("vision", false);
    if (state.visionActive) await toggleCamera(document.querySelector("#camera-toggle"));
    else {
      addMessage("The camera is already off.");
      speech.speak("The camera is already off.");
    }
    return;
  }
  if (/\b(?:read|scan|capture)\s+(?:(?:this|that|the|a|my)\s+)?(?:menu|sign|label|document|text|receipt)\b/i.test(text)) {
    await openVisionLens({ mode: "reading", capture: true });
    return;
  }
  if (/\b(?:take|capture)\s+(?:(?:a|the)\s+)?(?:photo|picture|image)\b/i.test(text)) {
    await openVisionLens({ mode: state.assistanceMode, capture: true });
    return;
  }
  if (/\b(?:start|enable)\s+(?:continuous\s+)?(?:scene )?updates\b|\bstart monitoring\b/i.test(text)) {
    await openVisionLens();
    await startVisionMonitoring();
    return;
  }
  if (/\b(?:stop|disable)\s+(?:continuous\s+)?(?:scene )?updates\b|\bstop monitoring\b/i.test(text)) {
    stopVisionMonitoring();
    addMessage("Periodic scene updates stopped.");
    speech.speak("Periodic scene updates stopped.");
    return;
  }
  if (/\b(?:volume buttons?|volume up|volume down|hold both buttons)\b/i.test(text)) {
    const response = "Web browsers cannot detect or bind the phone’s volume buttons. Open Voice and press and hold the on-screen Talk button instead.";
    addMessage(response);
    speech.speak(response);
    return;
  }
  if (/\b(?:walk|walking|footpath|sidewalk|pedestrian|path clear|road crossing|cross the road|obstacle|pothole)\b/i.test(text)) {
    const response = "I cannot guide movement, judge footpath safety, or detect hazards reliably. Go can show an informational route distance and time estimate only; please use a validated navigation aid and your cane, guide dog, or trusted human assistance.";
    addMessage(response);
    speech.speak(response);
    return;
  }
  if (/\b(?:navigate|route|destination|directions?)\b/i.test(text)) {
    setPage("go", false);
    const response = "Go can estimate route distance and time after you enter a destination and agree to share your location. It cannot provide turn-by-turn or safety guidance.";
    addMessage(response);
    speech.speak(response);
    return;
  }
  if (/\b(?:buy|purchase|order|add .* to (?:the )?cart|checkout)\b/i.test(text)) {
    const response = "I can help read product details from a camera image, but I cannot control shopping apps, add items to a cart, or place orders. Please review and complete any purchase yourself in the retailer’s app.";
    addMessage(response);
    speech.speak(response);
    return;
  }
  if (/\b(?:is|does|can)\b.{0,40}\b(?:person|man|woman|people)\b.{0,50}\b(?:dangerous|threat|suspicious)\b|\b(?:identify|recognize)\b.{0,30}\bperson\b|\b(?:detect|read|tell me|infer)\b.{0,30}\b(?:emotion|intent|threat)\b/i.test(text)) {
    const response = "I can’t identify people or infer emotion, intent, or dangerousness from an image. I can describe non-person scene details, but this is not a safety monitor.";
    addMessage(response);
    speech.speak(response);
    return;
  }
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
  const objectSearch = text.match(/\bfind (?:my )?(.+)/i);
  if (objectSearch) {
    await openVisionLens({ mode: "object", question: `Find ${objectSearch[1].trim()}`, capture: true });
    return;
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
    const result = await invokeAssistant({
      prompt: `Classify this user's request and return exactly one JSON object with this schema:
{"action":"navigate|capture|start_camera|stop_camera|start_monitor|stop_monitor|emergency|translate|set_language|set_focus|set_theme|open_web|call_contact|answer","page":"","mode":"","query":"","text":"","sourceLanguage":"","targetLanguage":"","value":"","name":"","speech":""}
Use only these pages: home, go, vision, voice, translate, me, permissions. Capture modes: describe, reading, shopping, indoor, directional, object, ask. Focus values: describe, reading, shopping, indoor, directional. Language values: ${Object.keys(APP_CONFIG.languages).join(", ")}. Web app values: whatsapp, gmail, maps, classroom. Theme values: dark, light.
Use capture for a user-requested image description/document/product/sign/object search/question; include mode and query if needed. Use start_camera or start_monitor only for explicit requests to start those features. Use emergency for a request for help. Use translate for a request to translate supplied text and include source/target language codes when stated. Use set_language/set_focus/set_theme only for a clear preference request. Use open_web/call_contact only to present an explicit user-requested action for confirmation. Use answer for ordinary questions or requests that are not a supported in-app action; speech should contain the concise answer or tell the user what you can do. Write every user-facing value, especially speech, in ${APP_CONFIG.languages[state.language].name}. Never claim that anything was done unless it has been done. Do not interpret requests for walking or crossing guidance as capture/navigation; instead refuse that guidance in speech. User request: ${JSON.stringify(text)}`,
      model: selectedGeminiModel(),
      mode: "intent"
    });
    await executeGeminiIntent(result.text);
  } catch (error) {
    console.error("Assistant request failed:", error);
    const unavailable = `I could not connect to the AI service. ${error.message}`;
    addMessage(unavailable); speech.speak(unavailable); toast(error.message);
  }
}

function normalizeGeminiIntent(rawText) {
  const jsonText = rawText.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const intent = JSON.parse(jsonText);
  const allowedActions = new Set([
    "navigate", "capture", "start_camera", "stop_camera", "start_monitor", "stop_monitor",
    "emergency", "translate", "set_language", "set_focus", "set_theme", "open_web",
    "call_contact", "answer"
  ]);
  if (!intent || typeof intent !== "object" || !allowedActions.has(intent.action)) {
    throw new Error("The assistant returned an unsupported app action.");
  }
  for (const key of ["page", "mode", "query", "text", "sourceLanguage", "targetLanguage", "value", "name", "speech"]) {
    if (intent[key] !== undefined && typeof intent[key] !== "string") {
      throw new Error("The assistant returned invalid action details.");
    }
    if (typeof intent[key] === "string") intent[key] = intent[key].slice(0, 2000);
  }
  return intent;
}

function addConfirmedVoiceAction(label, action, attributes = {}) {
  const target = document.querySelector("#conversation");
  if (!target) return false;
  const bubble = document.createElement("div");
  bubble.className = "message";
  bubble.textContent = `${label} I have not done this yet. Choose the button to continue.`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-primary";
  button.textContent = label;
  button.dataset.action = action;
  for (const [key, value] of Object.entries(attributes)) button.dataset[key] = value;
  bubble.append(button);
  target.append(bubble);
  target.scrollTop = target.scrollHeight;
  persistChatMessage("assistant", bubble.textContent);
  speech.speak(bubble.textContent);
  return true;
}

async function executeGeminiIntent(rawText) {
  const intent = normalizeGeminiIntent(rawText);
  const say = text => {
    const message = String(text || "I’m not sure what you’d like me to do. Please try again.").slice(0, 1200);
    addMessage(message);
    speech.speak(message);
  };
  const pages = new Set(["home", "go", "vision", "voice", "translate", "me", "permissions"]);
  const modes = new Set(["describe", "reading", "shopping", "indoor", "directional", "object", "ask"]);
  const webApps = new Set(["whatsapp", "gmail", "maps", "classroom"]);

  switch (intent.action) {
    case "navigate":
      if (!pages.has(intent.page)) return say("I can open Home, Go, Vision, Voice, Translate, Profile, or Permissions.");
      if (!auth.getSession() && intent.page !== "home" && intent.page !== "permissions") {
        state.profile = auth.startGuestSession();
      }
      if (intent.page === "vision") return openVisionLens();
      setPage(intent.page, false);
      return say(pageAnnouncement(intent.page));
    case "capture": {
      const mode = modes.has(intent.mode) ? intent.mode : "describe";
      if (!auth.getSession()) {
        setPage("auth");
        return say("Please sign in before using camera assistance.");
      }
      if (state.page !== "vision") setPage("vision", false);
      if (!state.visionActive) {
        say("I’ll ask the browser to start the camera. Grant permission if prompted, and stay safely stationary.");
        await toggleCamera(document.querySelector("#camera-toggle"));
      }
      if (!state.visionActive) return;
      await captureAndDescribe(mode, intent.query || intent.text || "");
      return;
    }
    case "start_camera":
      if (!auth.getSession()) {
        setPage("auth");
        return say("Please sign in before using the camera.");
      }
      if (state.page !== "vision") setPage("vision", false);
      if (!state.visionActive) await toggleCamera(document.querySelector("#camera-toggle"));
      else say("The camera preview is already on.");
      return;
    case "stop_camera":
      if (state.page !== "vision") setPage("vision", false);
      if (state.visionActive) await toggleCamera(document.querySelector("#camera-toggle"));
      else say("The camera is already off.");
      return;
    case "start_monitor":
      if (!auth.getSession()) {
        setPage("auth");
        return say("Please sign in before starting scene updates.");
      }
      if (state.page !== "vision") setPage("vision", false);
      await startVisionMonitoring();
      return;
    case "stop_monitor":
      stopVisionMonitoring();
      if (state.page === "vision") {
        const button = document.querySelector('[data-action="monitor-toggle"]');
        if (button) button.textContent = "Start updates";
      }
      return say("Periodic scene updates stopped.");
    case "emergency":
      setPage("emergency");
      return say("Opening emergency support. Calls and messages still require your confirmation.");
    case "set_language": {
      const language = (intent.value || "").toLowerCase();
      if (!APP_CONFIG.languages[language]) return say("I can speak English, Hindi, Tamil, Telugu, Kannada, Malayalam, or Punjabi. Open Profile to change languages.");
      state.language = language;
      speech.setLanguage(language);
      speech.setEngine(language === "en" ? "device" : "gemini");
      localStorage.setItem("visionmate.language", language);
      localStorage.setItem("visionmate.speechEngine", speech.engine);
      persistSettings({ language, speechEngine: speech.engine });
      return say(languageConfirmation(language));
    }
    case "set_focus": {
      const focus = (intent.value || "").toLowerCase();
      if (!["describe", "reading", "shopping", "indoor", "directional"].includes(focus)) {
        return say("Choose scene description, reading, shopping, indoor signs, or image positions in Vision Assist.");
      }
      state.assistanceMode = focus;
      localStorage.setItem("visionmate.assistanceMode", focus);
      persistSettings({ assistanceMode: focus });
      if (state.page === "vision") {
        const select = document.querySelector("#assistance-mode");
        if (select) select.value = focus;
      }
      return say(`Assistance focus set to ${focus}.`);
    }
    case "set_theme": {
      const theme = (intent.value || "").toLowerCase();
      if (!["dark", "light"].includes(theme)) return say("VisionMate appearance can be dark or light.");
      updateAppearance(theme);
      persistSettings({ theme });
      return say(`VisionMate appearance set to ${theme}. I cannot change your phone's system theme.`);
    }
    case "translate": {
      const text = (intent.text || intent.query || "").trim().slice(0, 2000);
      const sourceLanguage = (intent.sourceLanguage || state.language).toLowerCase();
      const targetLanguage = (intent.targetLanguage || "").toLowerCase();
      if (!text || !APP_CONFIG.languages[sourceLanguage] || !APP_CONFIG.languages[targetLanguage] || sourceLanguage === targetLanguage) {
        setPage("translate", false);
        return say("I’ve opened Translate. Enter or dictate the text and choose the source and target languages.");
      }
      setPage("translate", false);
      const output = document.querySelector("#translation-output");
      const input = document.querySelector("#translate-input");
      const source = document.querySelector("#source-language");
      const target = document.querySelector("#target-language");
      if (!output || !input || !source || !target) return say("Translate is not ready yet. Please try again.");
      input.value = text;
      source.value = sourceLanguage;
      target.value = targetLanguage;
      output.textContent = "Translating…";
      try {
        const translation = await machineTranslate({
          text,
          sourceLanguage,
          targetLanguage,
          provider: localStorage.getItem("visionmate.translationProvider") || "anuvaadhub"
        });
        output.textContent = translation;
        return say(`Translation: ${translation}. Please verify important meaning.`);
      } catch (error) {
        output.textContent = `Translation failed: ${error.message}`;
        throw error;
      }
    }
    case "open_web": {
      const app = (intent.value || "").toLowerCase();
      if (!webApps.has(app)) return say("I can offer browser links to WhatsApp, Gmail, Maps, or Classroom.");
      if (!addConfirmedVoiceAction(`Open ${app}`, "open-app", { app })) {
        return say("I couldn't show the confirmation button. Please try again from Voice tools.");
      }
      return;
    }
    case "call_contact": {
      const name = (intent.name || "").trim().toLowerCase();
      const contact = getLocalItems("contacts").find(item =>
        (item.display_name || item.name || "").toLowerCase() === name
      );
      if (!contact) return say("I couldn’t find that saved contact. Open Voice tools to add them first.");
      if (!addConfirmedVoiceAction(`Call ${contact.display_name || contact.name}`, "call-contact", { phone: contact.phone })) {
        return say("I couldn't show the call confirmation button. Please try again from Voice tools.");
      }
      return;
    }
    case "answer":
      return say(intent.speech || "I heard you. You can ask about a camera image, translate text, save a note, or ask me to open an app section.");
    default:
      return say("I can’t perform that action from VisionMate.");
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
  if (!auth.getUserId()) return;
  try {
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
      localStorage.setItem(localItemsKey(kind), JSON.stringify(unique));
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

function initializeRouteMap(route, attempt = 0) {
  const element = document.querySelector("#route-map");
  if (!element) return;
  if (!window.L) {
    if (attempt < 30) setTimeout(() => initializeRouteMap(route, attempt + 1), 150);
    else {
      const result = document.querySelector("#route-result");
      if (result) result.textContent += " The map library did not load, so the route line cannot be shown.";
      speech.speak("The route estimate is ready, but the map library did not load.");
    }
    return;
  }
  if (state.routeMap) {
    state.routeMap.remove();
    state.routeMap = null;
  }
  state.routeMap = window.L.map(element, { zoomControl: true });
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.routeMap);
  const line = window.L.polyline(route.geometry, { color: "#c2410c", weight: 6, opacity: 0.85 }).addTo(state.routeMap);
  window.L.marker(route.origin).addTo(state.routeMap).bindPopup("Your location");
  window.L.marker(route.destination).addTo(state.routeMap).bindPopup(escapeHtml(route.destinationName));
  requestAnimationFrame(() => {
    state.routeMap?.invalidateSize();
    state.routeMap?.fitBounds(line.getBounds(), { padding: [24, 24], maxZoom: 16 });
  });
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
  setPage("emergency");
  speech.speak("Emergency help screen. Choose whether to call your trusted contact or prepare a location message. Nothing is sent automatically.");
}

function emergencyContactKey() {
  return `visionmate.${auth.getUserId() || "device"}.emergencyPhone`;
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  const homeStatus = document.querySelector("#offline-status");
  if (homeStatus) homeStatus.textContent = online ? "Online · cloud services checked when requested" : "Offline · local emergency tools only";
  const emergencyStatus = document.querySelector("#emergency-connection");
  if (emergencyStatus) emergencyStatus.textContent = online ? "Online · emergency screen available" : "Offline · emergency screen available";
  const header = document.querySelector("#connection-label");
  if (header) header.textContent = online ? "Ready when you are" : "Offline mode";
}

function requestEmergencyLocation() {
  const output = document.querySelector("#emergency-location-output");
  state.emergencyLocation = null;
  if (!navigator.geolocation) {
    if (output) output.textContent = "Location is unavailable in this browser. Call your contact directly.";
    speech.speak("Location is not available. Please call your trusted contact.");
    return null;
  }
  if (output) output.textContent = "Requesting your location…";
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    state.emergencyLocation = `https://maps.google.com/?q=${latitude},${longitude}`;
    if (output) output.textContent = `Location ready: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}. Tap Prepare location text to open your messaging app.`;
    speech.speak("Location ready. It has not been sent. Choose Prepare location text to review a message.");
    resolve(state.emergencyLocation);
  }, error => {
    console.error("Emergency location request failed:", error);
    if (output) output.textContent = `Could not get location: ${error.message}. You can still call your contact.`;
    speech.speak("I could not get your location. You can still call your trusted contact.");
    resolve(null);
  }, { enableHighAccuracy: true, timeout: 12000 }));
}

function callEmergencyContact() {
  const phone = localStorage.getItem(emergencyContactKey()) || "";
  const normalized = phone.replace(/[^\d+*#,;]/g, "");
  if (!/^[+*#,;0-9]{3,40}$/.test(normalized)) {
    toast("Save a valid trusted contact phone number first.");
    return;
  }
  if (window.confirm(`Open your phone dialer to call ${normalized}? You must confirm the call on your device.`)) {
    window.location.href = `tel:${normalized}`;
  }
}

async function prepareEmergencyText() {
  const phone = localStorage.getItem(emergencyContactKey()) || "";
  const normalized = phone.replace(/[^\d+*#,;]/g, "");
  if (!/^[+*#,;0-9]{3,40}$/.test(normalized)) {
    toast("Save a valid trusted contact phone number first.");
    return;
  }
  if (!state.emergencyLocation) await requestEmergencyLocation();
  const message = state.emergencyLocation
    ? `I may need help. My last shared location is: ${state.emergencyLocation}`
    : "I may need help. Please contact me.";
  window.location.href = `sms:${normalized}?body=${encodeURIComponent(message)}`;
}

function captureCurrentFrame() {
  const video = document.querySelector("#camera-video");
  if (!state.visionActive || !video?.videoWidth) return null;
  const canvas = document.createElement("canvas");
  const maxEdge = 1280;
  const digitalZoom = state.camera?.isDigitalZoom ? state.camera.zoom : 1;
  const preview = document.querySelector("#vision-preview");
  const targetAspect = preview?.clientWidth && preview?.clientHeight
    ? preview.clientWidth / preview.clientHeight
    : video.videoWidth / video.videoHeight;
  let sourceWidth = video.videoWidth / digitalZoom;
  let sourceHeight = video.videoHeight / digitalZoom;
  if (sourceWidth / sourceHeight > targetAspect) sourceWidth = sourceHeight * targetAspect;
  else sourceHeight = sourceWidth / targetAspect;
  const sourceX = (video.videoWidth - sourceWidth) / 2;
  const sourceY = (video.videoHeight - sourceHeight) / 2;
  const scale = Math.min(1, maxEdge / sourceWidth, maxEdge / sourceHeight);
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not capture a camera frame.");
  context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const imageUrl = canvas.toDataURL("image/jpeg", 0.78);
  const image = document.querySelector("#menu-photo");
  if (image) {
    image.src = imageUrl;
    image.classList.remove("hidden");
  }
  return { imageBase64: imageUrl.split(",")[1], mimeType: "image/jpeg" };
}

function visionPrompt(mode, question = "") {
  const privacy = state.privacyMode
    ? "Do not describe or identify people; ignore faces and personal identity."
    : "Never identify people or infer personal identity.";
  const shared = `You are VisionMate, an accessible visual assistant. Be concise, kind, and explicit about uncertainty. ${privacy} Never identify people or infer their emotion, intent, dangerousness, or risk. Never state that a road, crossing, path, or obstacle is safe. Never give walking, crossing, steering, or obstacle-avoidance directions. This is a single still image and may be incomplete or wrong.`;
  const instructions = {
    describe: "Describe a few clearly visible objects and their approximate positions in the image. Do not make safety judgments.",
    reading: "Transcribe all legible text from the image. For menus, labels, and documents, organize the visible content into a clear list with headings, item names, prices, and table rows/columns when present. Preserve numbers and mark unclear text as uncertain; do not invent missing content.",
    shopping: "Help with shopping by reading visible product names, sizes, prices, or labels. State only legible information and flag uncertainty; do not infer ingredients or safety from an unclear label.",
    indoor: "Describe visible indoor signs, room labels, counters, and landmarks. Read sign text when legible. Do not give directions or claim to know the user's location.",
    directional: "Describe visible objects grouped as left side, center, or right side of this image only. Clearly say these are image positions, not directions for movement. Do not assess hazards, identify people, infer emotion or intent, or label anyone dangerous.",
    object: "Search this image for the requested object. Say whether it is clearly visible and describe its approximate position within the image (left, center, or right). If uncertain or absent, say so. Never tell the user how to move.",
    ask: "Answer the user's question using only clearly visible image details. If the question cannot be answered from the image, say what is uncertain."
  };
  return `${shared} Respond in ${APP_CONFIG.languages[state.language].name} when possible.\nTask: ${instructions[mode] || instructions.describe}${question ? `\nUser request: ${question.slice(0, 500)}` : ""}`;
}

async function openVisionLens({ mode, question = "", capture = false } = {}) {
  if (!auth.getSession()) state.profile = auth.startGuestSession();
  if (state.page !== "vision") setPage("vision", false);
  if (!state.visionActive) {
    speech.speak("Opening Vision Lens. The browser will ask for camera permission if needed. I only analyze a photo when you ask.");
    await toggleCamera(document.querySelector("#camera-toggle"));
  } else {
    speech.speak("Vision Lens is open. The camera preview is active.");
  }
  if (capture && state.visionActive) await captureAndDescribe(mode || state.assistanceMode, question);
}

async function captureAndDescribe(mode = state.assistanceMode, question = "") {
  let frame;
  try {
    frame = captureCurrentFrame();
  } catch (error) {
    toast(error.message);
    return;
  }
  if (!frame) {
    speech.speak("Start the camera preview first, while safely stationary.");
    toast("Start the camera preview before asking about an image.");
    return;
  }
  const caption = document.querySelector("#vision-caption");
  const detail = document.querySelector("#vision-detail");
  const modeLabels = {
    describe: "Scene description",
    reading: "Document reading",
    shopping: "Shopping details",
    indoor: "Indoor signs",
    directional: "Image position description",
    object: "Object search",
    ask: "Answer about this view"
  };
  if (caption) caption.textContent = `${modeLabels[mode] || "Vision assist"} · analyzing…`;
  if (detail) detail.textContent = "One still image is being sent to the configured AI provider. Results may be wrong.";
  if (!navigator.onLine) {
    if (detail) detail.textContent = "Visual AI requires an internet connection. Your camera preview remains local.";
    speech.speak("Visual AI is offline. Your camera preview remains on this device.");
    return;
  }
  speech.speak("Analyzing one image. Stay safely stationary; this is not walking guidance.");
  try {
    const result = await invokeAssistant({
      prompt: visionPrompt(mode, question),
      ...frame,
      model: selectedGeminiModel()
    });
    if (caption) caption.textContent = `${modeLabels[mode] || "Vision assist"} · ${result.model || "AI"}`;
    if (detail) detail.textContent = `${result.text} Confidence: unverified. Check important details with a trusted person.`;
    logActivity("vision_analysis", { mode });
    speech.speak(`${result.text} Confidence is unverified. This is not navigation or hazard detection.`);
  } catch (error) {
    console.error("Camera image analysis failed:", error);
    if (detail) detail.textContent = `Could not analyze the image: ${error.message}`;
    speech.speak(`I could not read this image. ${error.message}`);
    toast(error.message);
  }
}

function stopVisionMonitoring() {
  if (state.visionMonitorTimer) clearTimeout(state.visionMonitorTimer);
  state.visionMonitorTimer = null;
  state.visionMonitoring = false;
}

async function startVisionMonitoring() {
  if (!state.visionActive) {
    await toggleCamera(document.querySelector("#camera-toggle"));
    if (!state.visionActive) return;
  }
  state.visionMonitoring = true;
  const button = document.querySelector('[data-action="monitor-toggle"]');
  if (button) button.textContent = "Stop updates";
  speech.speak("Periodic scene updates started. A camera image will be sent every 30 seconds. This is not safety monitoring. Tap Stop updates at any time.");
  const update = async () => {
    if (!state.visionMonitoring || state.page !== "vision") return;
    await captureAndDescribe("describe");
    if (state.visionMonitoring) state.visionMonitorTimer = setTimeout(update, 30000);
  };
  await update();
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
  if (!auth.getUserId()) return;
  const syncTasks = [];
  if (auth.getSession()) {
    syncTasks.push(saveProfileRecord(profile).then(() => "").catch(error => {
      console.error("Supabase profile sync failed:", error);
      return `Supabase: ${error.message}`;
    }));
    if (APP_CONFIG.firebase.databaseURL) {
      syncTasks.push(saveFirebaseProfile(profile).then(saved => saved ? "" : "Firebase profile was not synced.")
        .catch(error => {
          console.error("Firebase profile sync failed:", error);
          return `Firebase: ${error.message}`;
        }));
    }
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
    stopVisionMonitoring();
    const monitorButton = document.querySelector('[data-action="monitor-toggle"]');
    if (monitorButton) monitorButton.textContent = "Start updates";
    state.camera?.stop();
    state.camera = null;
    state.visionActive = false;
    video.classList.add("hidden");
    document.querySelector(".camera-visual")?.classList.remove("hidden");
    document.querySelector("#vision-preview")?.classList.remove("active");
    document.querySelector("#vision-status").textContent = getCameraStatusLabel();
    document.querySelector("#vision-detail").textContent = "Start the camera preview when you’re safely stationary. I cannot identify hazards.";
    if (button) button.innerHTML = `${icon("eye")} Start camera preview`;
    updateCameraControlState(false);
    document.querySelector("#camera-zoom").value = String(state.cameraZoom);
    document.querySelector("#camera-zoom-value").textContent = `${state.cameraZoom.toFixed(1)}x`;
    speech.speak("Camera preview stopped. Remember, I cannot detect obstacles.");
    return;
  }
  try {
    state.camera = new CameraController(video, message => {
      if (message !== "Camera preview ended." || state.camera?.stream?.active) return;
      state.camera = null;
      state.visionActive = false;
      stopVisionMonitoring();
      video.classList.add("hidden");
      document.querySelector(".camera-visual")?.classList.remove("hidden");
      document.querySelector("#vision-preview")?.classList.remove("active");
      document.querySelector("#vision-status").textContent = getCameraStatusLabel();
      document.querySelector("#vision-detail").textContent = "The camera stream ended. Start the preview again if you want to use it.";
      const cameraButton = document.querySelector("#camera-toggle");
      if (cameraButton) cameraButton.innerHTML = `${icon("eye")} Start camera preview`;
      updateCameraControlState(false);
      setVisionActive(false);
      speech.speak("The camera preview has stopped.");
    });
    state.camera.zoom = state.cameraZoom;
    await state.camera.start();
    state.visionActive = true;
    video.classList.remove("hidden");
    document.querySelector(".camera-visual")?.classList.add("hidden");
    document.querySelector("#vision-preview")?.classList.add("active");
    document.querySelector("#vision-status").textContent = getCameraStatusLabel();
    document.querySelector("#vision-detail").textContent = "Live preview only. Request an image analysis when ready; it cannot detect hazards or guide walking.";
    if (button) button.innerHTML = `${icon("eye")} Stop camera preview`;
    updateCameraControlState(true);
    document.querySelector("#camera-zoom").value = String(state.camera.zoom);
    document.querySelector("#camera-zoom-value").textContent = `${state.camera.zoom.toFixed(1)}x${state.camera.isDigitalZoom ? " digital" : ""}`;
    setVisionActive(true);
    speech.speak("Camera preview is on. I can analyze a still image when you request it, but I cannot detect hazards or guide walking. Please stay stationary and use your trusted mobility aid.");
  } catch (error) {
    console.error("Camera preview could not start:", error);
    state.camera?.stop();
    state.camera = null;
    state.visionActive = false;
    document.querySelector("#vision-status").textContent = "CAMERA OFF";
    updateCameraControlState(false);
    speech.speak(error.message || "I could not start the camera. Check your browser permissions.");
    toast(error.message || "Camera could not start.");
  }
}

function updateCameraControlState(active) {
  document.querySelector("#camera-zoom").disabled = !active;
  document.querySelectorAll('[data-action="switch-camera"], [data-action="fullscreen-camera"]').forEach(button => {
    button.disabled = !active;
  });
}

async function setCameraZoom(value, announce = false) {
  if (!state.camera || !state.visionActive) return;
  try {
    const result = await state.camera.setZoom(value);
    state.cameraZoom = result.zoom;
    localStorage.setItem("visionmate.cameraZoom", String(result.zoom));
    const slider = document.querySelector("#camera-zoom");
    const output = document.querySelector("#camera-zoom-value");
    if (slider) slider.value = String(result.zoom);
    if (output) output.textContent = `${result.zoom.toFixed(1)}x${result.isDigitalZoom ? " digital" : ""}`;
    if (announce) speech.speak(`Camera zoom set to ${result.zoom.toFixed(1)} times${result.isDigitalZoom ? ", using a cropped preview" : ""}.`);
  } catch (error) {
    console.error("Could not change camera zoom:", error);
    toast(`Camera zoom could not be changed: ${error.message}`);
    speech.speak(`Camera zoom could not be changed. ${error.message}`);
  }
}

async function switchCamera() {
  if (!state.camera || !state.visionActive) {
    speech.speak("Start the camera preview before switching cameras.");
    return;
  }
  try {
    const facingMode = await state.camera.switchCamera();
    state.cameraZoom = state.camera.zoom;
    document.querySelector("#vision-status").textContent = getCameraStatusLabel();
    document.querySelector("#camera-zoom").value = String(state.camera.zoom);
    document.querySelector("#camera-zoom-value").textContent = `${state.camera.zoom.toFixed(1)}x${state.camera.isDigitalZoom ? " digital" : ""}`;
    speech.speak(`Switched to the ${facingMode === "user" ? "front" : "rear"} camera. The image may be cropped when digital zoom is active.`);
  } catch (error) {
    console.error("Could not switch camera:", error);
    toast(error.message);
    speech.speak(error.message);
  }
}

async function toggleCameraFullscreen() {
  const preview = document.querySelector("#vision-preview");
  const video = document.querySelector("#camera-video");
  try {
    if (document.fullscreenElement === preview) {
      await document.exitFullscreen();
      return;
    }
    if (preview?.requestFullscreen) {
      await preview.requestFullscreen();
      return;
    }
    if (typeof video?.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen();
      return;
    }
    throw new Error("Fullscreen preview is not supported by this browser.");
  } catch (error) {
    console.error("Could not change camera fullscreen:", error);
    toast(error.message);
    speech.speak(`Fullscreen is unavailable. ${error.message}`);
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
    if (result.supabaseRoleError) {
      toast(`Signed in to Firebase, but Supabase sync is unavailable: ${result.supabaseRoleError}`);
    }
    if (method === "reset") {
      speech.speak(result.firebase ? "Password reset email sent. Check your inbox." : "Password reset requires Firebase setup. No email was sent.");
      toast(result.firebase ? "Password reset email sent." : "Firebase is not configured. No email was sent.");
      return;
    }
    state.profile = auth.getProfile() || state.profile;
    speech.speak(result.firebase ? "You’re signed in. Welcome to VisionMate." : "You’re in the local demo. Your profile stays on this device.");
    state.permissionChecked = false;
    if (result.firebase) {
      try {
        const cloudProfile = await loadProfileRecord();
        if (cloudProfile) {
          state.profile = {
            ...state.profile,
            firstName: cloudProfile.first_name,
            lastName: cloudProfile.last_name,
            age: cloudProfile.age ?? "",
            gender: cloudProfile.gender,
            preferredLanguage: cloudProfile.preferred_language,
            email: cloudProfile.email || result.user.email || ""
          };
          auth.saveProfile(state.profile);
        }
      } catch (error) {
        console.error("Could not restore the Firebase account profile:", error);
        toast(`Could not load your cloud profile: ${error.message}`);
      }
      syncProfile(state.profile);
      speech.speak("You’re signed in. Welcome to VisionMate.");
    }
    setPage("home", false);
  } catch (error) {
    speech.speak(error.message);
    toast(error.message);
  }
}

function handleAction(action, element) {
  switch (action) {
    case "toggle-profile": {
      const button = document.querySelector('[data-action="toggle-profile"]');
      const content = document.querySelector("#profile-card-content");
      const expanded = button?.getAttribute("aria-expanded") !== "true";
      button?.setAttribute("aria-expanded", String(expanded));
      content?.classList.toggle("is-expanded", expanded);
      if (content) {
        content.inert = !expanded;
        content.setAttribute("aria-hidden", String(!expanded));
      }
      const label = button?.querySelector(".profile-expand-label");
      if (label) label.textContent = expanded ? "Hide details" : "Show details";
      if (!expanded) document.querySelector("#profile-form").hidden = true;
      speech.speak(expanded ? "Profile details expanded." : "Profile details closed.");
      break;
    }
    case "edit-profile": {
      const form = document.querySelector("#profile-form");
      if (!form) break;
      form.hidden = false;
      document.querySelector("#profile-first")?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => document.querySelector("#profile-first")?.focus({ preventScroll: true }), 250);
      speech.speak("Profile editor opened. Enter your details, then choose Save profile.");
      break;
    }
    case "close-profile": {
      document.querySelector("#profile-form").hidden = true;
      const content = document.querySelector("#profile-card-content");
      content.classList.remove("is-expanded");
      content.inert = true;
      content.setAttribute("aria-hidden", "true");
      document.querySelector('[data-action="toggle-profile"]')?.setAttribute("aria-expanded", "false");
      const label = document.querySelector(".profile-expand-label");
      if (label) label.textContent = "Show details";
      speech.speak("Profile details closed.");
      break;
    }
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
    case "start-guest":
      state.profile = auth.startGuestSession();
      state.navigationHistory.length = 0;
      setPage("home", false);
      speech.speak("Guest mode is ready. Your notes and chat history stay on this device only.");
      break;
    case "nav-back": {
      const previousPage = state.navigationHistory.pop() || (auth.getSession() ? "home" : "welcome");
      setPage(previousPage, true, false);
      break;
    }
    case "open-vision-lens":
      openVisionLens().catch(error => {
        console.error("Could not open Vision Lens:", error);
        speech.speak(`Vision Lens could not start. ${error.message}`);
        toast(error.message);
      });
      break;
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
    case "switch-camera": switchCamera(); break;
    case "fullscreen-camera": toggleCameraFullscreen(); break;
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
      captureAndDescribe("describe");
      break;
    case "capture-focus":
      logActivity("personalized_vision_requested", { focus: state.assistanceMode });
      captureAndDescribe(state.assistanceMode);
      break;
    case "capture-document":
      logActivity("document_reading_requested");
      captureAndDescribe("reading");
      break;
    case "object-search": {
      const request = document.querySelector("#vision-text")?.value.trim();
      if (!request) { speech.speak("Type the object you want me to look for, then tap Find an object."); break; }
      captureAndDescribe("object", request);
      break;
    }
    case "monitor-toggle":
      if (state.visionMonitoring) {
        stopVisionMonitoring();
        const button = document.querySelector('[data-action="monitor-toggle"]');
        if (button) button.textContent = "Start updates";
        speech.speak("Periodic updates stopped.");
      } else {
        startVisionMonitoring().catch(error => {
          stopVisionMonitoring();
          console.error("Could not start scene updates:", error);
          toast(`Could not start updates: ${error.message}`);
        });
      }
      break;
    case "listen-vision":
      if (!state.visionActive) { speech.speak("Start the camera preview while safely stationary, then ask your question."); break; }
      speech.speak("I’m listening. Ask one question about the camera image.");
      speech.listen({
        onResult: question => captureAndDescribe("ask", question),
        onError: message => { speech.speak(message); toast(message); }
      });
      break;
    case "emergency":
      setPage("emergency");
      speech.speak("Emergency support. Calls and messages are not sent until you choose and confirm them.");
      break;
    case "emergency-back":
      setPage(auth.getSession() ? "home" : "welcome");
      break;
    case "emergency-call":
      callEmergencyContact();
      break;
    case "emergency-location":
      requestEmergencyLocation();
      break;
    case "emergency-sms":
      prepareEmergencyText();
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
      localStorage.setItem(localItemsKey(kind), JSON.stringify(items));
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
      {
      const wasGuest = auth.isGuest();
      logActivity("sign_out");
      auth.signOut().then(() => {
        state.permissionChecked = false;
        state.profile = auth.getProfile() || {};
        state.navigationHistory.length = 0;
        setPage(wasGuest ? "auth" : "welcome", false, false);
        speech.speak(wasGuest
          ? "Guest session ended. Would you like to sign in with Google or email, or continue as a guest?"
          : "You have signed out.");
      }).catch(error => {
        console.error("Could not sign out of Firebase:", error);
        toast(`Sign-out failed: ${error.message}`);
      });
      break;
      }
  }
}

document.addEventListener("dragstart", event => event.preventDefault());

document.addEventListener("click", event => {
  const navButton = event.target.closest("[data-nav]");
  if (navButton) {
    const page = navButton.dataset.nav;
    if (!auth.getSession()) state.profile = auth.startGuestSession();
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

document.addEventListener("input", event => {
  if (event.target.id === "camera-zoom") {
    setCameraZoom(event.target.value).catch(error => {
      console.error("Camera zoom update failed:", error);
      toast(error.message);
    });
  }
});

document.addEventListener("submit", async event => {
  if (event.target.id === "auth-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const mode = state.authMode;
    await completeAuth(mode, { email: form.get("email"), password: form.get("password") });
  } else if (event.target.id === "route-form") {
    event.preventDefault();
    await estimateWalkingRoute(event.target);
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
      let frame;
      try {
        frame = captureCurrentFrame();
      } catch (error) {
        console.error("Could not capture a camera frame:", error);
        toast(error.message);
        return;
      }
      const result = await invokeAssistant({
        prompt: frame ? visionPrompt("ask", command) : `Answer this question in ${APP_CONFIG.languages[state.language].name}. Be concise and state uncertainty: ${command}`,
        ...(frame || {}),
        model: selectedGeminiModel()
      }).catch(error => {
        console.error("Vision question failed:", error);
        speech.speak(error.message); toast(error.message); return null;
      });
      if (result) {
        document.querySelector("#vision-caption").textContent = frame ? "Answer about one camera image" : "Answer";
        document.querySelector("#vision-detail").textContent = result.text;
        speech.speak(`${result.text} Confidence is unverified. Please verify important information.`);
      }
    }
  } else if (event.target.id === "emergency-contact-form") {
    event.preventDefault();
    const phone = String(new FormData(event.target).get("phone") || "").trim();
    if (!/^[+*#,;0-9()\s.-]{3,40}$/.test(phone)) {
      toast("Enter a valid phone number.");
      return;
    }
    localStorage.setItem(emergencyContactKey(), phone);
    document.querySelector('[data-action="emergency-call"]').disabled = false;
    document.querySelector('[data-action="emergency-sms"]').disabled = false;
    toast("Trusted contact saved on this device.");
    speech.speak("Trusted contact saved on this device.");
  } else if (event.target.id === "tts-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const text = String(form.get("text") || "").trim();
    const gender = String(form.get("gender") || "female");
    const language = String(form.get("language") || state.language);
    try {
      speech.speak(`Generating ${APP_CONFIG.languages[language]?.name || "selected-language"} speech with Anuvaadhub.`);
      const spokenText = await speakWithProvider(text, gender, language);
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
    const profileSummary = document.querySelector("#profile-summary");
    if (profileSummary) {
      profileSummary.textContent = [state.profile.firstName, state.profile.lastName].filter(Boolean).join(" ") || "Add your name";
      if (state.profile.email) profileSummary.textContent += ` · ${state.profile.email}`;
    }
    event.target.hidden = true;
    logActivity("profile_updated");
    syncProfile(state.profile);
    speech.speak("Profile saved on this device.");
    toast("Profile saved.");
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "assistance-mode") {
    state.assistanceMode = event.target.value;
    localStorage.setItem("visionmate.assistanceMode", state.assistanceMode);
    persistSettings({ assistanceMode: state.assistanceMode });
    speech.speak(`Assistance focus set to ${event.target.options[event.target.selectedIndex].text}.`);
  } else if (event.target.id === "privacy-mode") {
    state.privacyMode = event.target.checked;
    localStorage.setItem("visionmate.privacyMode", state.privacyMode ? "on" : "off");
    persistSettings({ privacyMode: state.privacyMode });
    speech.speak(state.privacyMode
      ? "People privacy mode is on. AI is asked not to describe or identify people. This does not blur images."
      : "People privacy mode is off. AI still will not identify people.");
  } else if (event.target.id === "offline-emergency-mode") {
    localStorage.setItem("visionmate.emergencyMode", event.target.checked ? "on" : "off");
    if (event.target.checked) {
      navigator.serviceWorker?.ready.then(registration => {
        registration.active?.postMessage({ type: "cache-emergency-screen" });
      }).catch(error => console.error("Could not prepare offline emergency screen:", error));
    }
    speech.speak(event.target.checked
      ? "Preparing the emergency screen for offline use. AI vision and message delivery are not guaranteed offline."
      : "Offline emergency tools are disabled.");
  } else if (event.target.id === "settings-language") {
    state.language = event.target.value;
    speech.setLanguage(state.language);
    speech.setEngine(state.language === "en" ? "device" : "gemini");
    localStorage.setItem("visionmate.speechEngine", speech.engine);
    localStorage.setItem("visionmate.language", state.language);
    persistSettings({ language: state.language, speechEngine: speech.engine });
    const engineSelect = document.querySelector("#speech-engine");
    if (engineSelect) engineSelect.value = speech.engine;
    loadSpeechVoices();
    speech.speak(languageConfirmation(state.language));
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
  } else if (event.target.id === "speech-engine") {
    speech.setEngine(event.target.value);
    localStorage.setItem("visionmate.speechEngine", speech.engine);
    persistSettings({ speechEngine: speech.engine });
    speech.speak(speech.engine === "gemini"
      ? "Gemini voice is on. Spoken responses are translated into your selected language and require an internet connection."
      : "Device voice is on. Speech is faster and may work offline if a matching voice is installed.");
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
  else { speech.cancel(); document.querySelector("#live-feedback").textContent = "Spoken feedback is off."; }
});

window.addEventListener("beforeunload", () => state.camera?.stop());
window.addEventListener("beforeunload", () => {
  stopVisionMonitoring();
  if (state.locationWatchId !== null) navigator.geolocation?.clearWatch(state.locationWatchId);
});
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
window.addEventListener("visionmate:speech-error", event => toast(event.detail?.message || "Spoken feedback could not be generated."));
window.speechSynthesis?.addEventListener("voiceschanged", loadSpeechVoices);
updateAppearance(localStorage.getItem("visionmate.theme") || "light");
const initialPage = new URLSearchParams(location.search).get("emergency") === "1"
  ? "emergency"
  : auth.getSession() ? "home" : auth.getProfile() ? "auth" : "welcome";
setPage(initialPage, false, false);
updateConnectionStatus();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(error => {
    console.error("Offline app shell could not be registered:", error);
  });
}
{
  let greetingStarted = false;
  let greetingAttempted = false;
  const greeting = initialPage === "emergency"
    ? "VisionMate emergency screen is open. Choose a trusted contact or get your location. Nothing is sent automatically."
    : `${APP_CONFIG.languages[state.language].greeting} Camera and microphone start only when you ask. What would you like help with?`;
  const removeGreetingFallback = () => {
    document.removeEventListener("pointerdown", retryAfterGesture);
    document.removeEventListener("keydown", retryAfterGesture);
  };
  const speakGreeting = () => {
    if (greetingStarted || greetingAttempted || !speech.enabled) return;
    greetingAttempted = true;
    speech.speak(greeting, {
      onStart: () => {
        greetingStarted = true;
        removeGreetingFallback();
      },
      onError: () => { greetingAttempted = false; }
    });
  };
  const retryAfterGesture = () => {
    if (greetingStarted || !speech.enabled) return;
    removeGreetingFallback();
    speech.cancel();
    greetingAttempted = false;
    speakGreeting();
  };
  document.addEventListener("pointerdown", retryAfterGesture, { once: true });
  document.addEventListener("keydown", retryAfterGesture, { once: true });
  setTimeout(() => {
    speakGreeting();
  }, 350);
}
