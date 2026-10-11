# VisionMate

VisionMate is a mobile-first, installable web app for blind and low-vision users. It combines voice interaction, optional camera descriptions, text/document reading, translation, personal notes and reminders, saved contacts, and an emergency contact screen.

**Open the deployed app:** [https://visionmate.vercel.app](https://visionmate.vercel.app)

Use the service over HTTPS. Browsers require a secure connection for camera, microphone, location, and service-worker features. VisionMate asks for camera/microphone access only after the user chooses a feature.

## What it does

- Speaks a welcome when a session starts and announces page changes, assistant results, errors, and confirmations using the device's speech synthesis. The user can turn spoken feedback off.
- Opens **Vision Lens** from the home screen, fixed bottom navigation, or voice commands such as “open Vision Lens,” “open camera,” and “read this menu.” The camera starts only after a browser permission prompt; menu, label, and document requests capture one still frame and ask Gemini to list legible text.
- Vision Lens offers camera zoom (hardware zoom where available, otherwise a matching digital crop), front/rear camera switching, and user-requested fullscreen preview. Captured frames use the same zoom and crop as the preview.
- Accepts voice commands through browser speech recognition (where supported), an on-screen press-and-hold Talk button, or recorded WAV speech-to-text through Anuvaadhub. Text entry remains available.
- Uses Gemini through a Supabase Edge Function to answer questions, describe a requested camera frame, read document structure, read shopping labels, interpret signs, search an image for an object, or classify a voice request into an allowlisted in-app action. The app validates the returned JSON before acting.
- Offers scene focus options for general description, reading, shopping, indoor signs, and left/center/right positions **within one image only**. Optional scene updates capture one frame every 30 seconds while the user keeps that feature active.
- Adds a **Go** screen for a user-requested, approximate pedestrian-route distance and time. The user must consent before the browser requests location or sends the destination and coordinates to Photon/Valhalla public services.
- Translates text with Anuvaadhub or Bhashini and can speak the result in supported browser voices.
- Saves profile/settings and notes, contacts, reminders, conversations, and activity to Supabase under the signed-in Firebase user when configured.
- Offers **Continue as guest** without Firebase. Guest profile, notes, settings, insights, and chat history remain in this browser’s local storage and are not account-synced. The home dashboard shows local counts; Profile shows recent chat history.
- Provides a locally stored emergency phone number and opens the phone dialer or SMS composer only after the user requests it. A user reviews and confirms any call or message.
- Caches the app shell as a PWA and can open the emergency screen when offline. Offline caching does not provide AI, hazard detection, or guaranteed SMS delivery.

### Accessibility and safety

VisionMate uses semantic headings, labeled buttons/forms, live announcements, high-contrast controls, a compact fixed bottom bar with Back/Home/Vision Lens/Voice/Profile, spoken page/action feedback, browser speech where available, and a responsive mobile layout. The default theme is orange on light surfaces. On first load, some browsers block automatic speech until the user interacts; the welcome retries on the first tap or key press. Native element dragging and horizontal page panning are suppressed; vertical scrolling and pinch-to-zoom remain available. Supported speech recognition and installed voices vary by browser/device.

Camera images are sent to the configured AI provider only when the user requests analysis (or enables periodic updates). AI output is unverified; the people-privacy option asks the model not to describe/identify people but does not blur captured pixels. Do not capture private material without consent.

Vision Lens sends a user-requested still image to the existing Gemini Supabase Edge Function. It is not an on-device Python/OpenCV pipeline and is not continuous real-time scene analysis. A static web page cannot run a local Python process; adding an unconnected Python file would not make the deployed camera use it. Camera analysis requires network access and configured Gemini credentials.

This web app **cannot scan installed apps, control other apps or device settings, read hardware volume-button holds, approve operating-system permission dialogs, add products to shopping carts, place orders, make calls/messages without confirmation, provide turn-by-turn or accessibility-verified navigation, detect hazards reliably, or declare crossings safe**. The Go screen reports only a public routing service's approximate pedestrian distance and time; its route may omit sidewalks, accessible crossings, closures, and hazards. Location and destination are sent to Photon and Valhalla only after the user checks the consent box and submits the form. Volume buttons and permission prompts are controlled by the phone OS. Use the on-screen press-and-hold Talk button instead. The AI cannot identify people or infer emotions, intent, dangerousness, or threat from an image. Left/right describes image position, never a direction to move. Keep using a cane, guide dog, and trusted assistance. Do not use VisionMate for guidance while walking or crossing roads.

## Connections and technology

| Connection / build | Used for | Where it connects |
|---|---|---|
| Browser HTML/CSS/JavaScript (ES modules) | Mobile UI and app behaviors; no frontend bundler/build step | `index.html`, `css/`, `js/` |
| Firebase Authentication Web SDK (optional) | Google and email/password account sign-in | `js/firebase.js`, `js/auth.js` |
| Firebase Cloud Functions v2 + Admin SDK | Sets the Firebase `role: authenticated` claim needed by Supabase third-party auth | `functions/index.js` |
| Supabase Auth anonymous session | Authenticates Edge Function requests for both guest and Firebase-signed-in sessions | `js/supabase.js` |
| Supabase third-party Firebase Auth + Postgres/RLS | Optional account sync; verifies Firebase ID tokens and scopes rows to the Firebase UID | Supabase Auth dashboard, `js/supabase.js`, `supabase/migrations/` |
| Supabase Edge Functions (Deno/TypeScript) | Server-side Gemini, Bhashini and Anuvaadhub provider calls | `supabase/functions/` |
| Gemini API | Vision Q&A, image descriptions/reading, and app-command interpretation | `supabase/functions/gemini-assist/index.ts` |
| Anuvaadhub APIs | MT, recorded WAV ASR, TTS, OCR | `supabase/functions/anuvaadhub-inference/index.ts`, `_shared/anuvaadhub-catalog.ts` |
| Bhashini APIs | Translation fallback/provider | `supabase/functions/bhashini-translate/index.ts` |
| Browser APIs | Serialized speech synthesis/playback and recognition, camera, location, vibration, SMS/call handoff, notifications | `js/speech.js`, `js/camera.js`, `js/app.js` |
| PWA service worker / manifest | Installable app shell and offline emergency-screen entry | `sw.js`, `manifest.json` |
| Leaflet + OpenStreetMap tiles | User-requested location map (requires network for map tiles) | `index.html`, `js/app.js` |
| Photon + Valhalla public services | Consent-gated place search and approximate pedestrian distance/ETA; no API key, no turn-by-turn guidance | `js/routes.js` |
| Vercel | Public deployment URL | [visionmate.vercel.app](https://visionmate.vercel.app) |

The Gemini command interpreter can choose only explicitly supported VisionMate actions (including opening Go within the app, vision modes, translation, settings, and confirmation-based contact/app handoffs). It does not get general device or OS control. External calls, messages, and opening websites remain user-initiated. Google sign-in is optional and requires a valid Firebase Web App configuration, Google provider enabled in Firebase Authentication, and the deployed domain added to Firebase Authorized domains; local guest mode remains available without those settings.

## API keys and secrets

Names below are variable names, not actual credentials. `.env.example` contains placeholders. Never paste real secrets into source files, chat, or Git.

### Public browser configuration

Set these in a local `.env` or deployment environment. `node scripts/build-config.mjs` writes them to ignored `js/runtime-config.js`; anything in that generated file is visible to every visitor, so put public client values only.

| Variable | Purpose | Secret? |
|---|---|---|
| `SUPABASE_URL` | Supabase project API URL used by the browser SDK | No |
| `SUPABASE_ANON_KEY` | Supabase publishable/anon key. Database access is protected by RLS; this is not a service-role key | No |
| `FIREBASE_API_KEY` | Firebase Web App identifier used by the Firebase SDK | No |
| `FIREBASE_AUTH_DOMAIN` | Firebase Authentication host for web sign-in | No |
| `FIREBASE_PROJECT_ID` | Firebase project identity; also register it in Supabase's Firebase third-party Auth integration | No |
| `FIREBASE_APP_ID` | Firebase Web App identifier | No |
| `FIREBASE_DATABASE_URL` | Optional Realtime Database endpoint for Firebase profile mirror; omit if unused | No |
| `GOOGLE_OAUTH_CLIENT_ID` | Setup reminder for the Google provider in Firebase Console; the current browser code does not read this variable | Not used by app |

Firebase Web App configuration and Supabase publishable keys are not credentials for authorization. Keep Firebase/Supabase security rules, third-party token verification, and row-level security enabled.

### Server-only provider secrets

Set these with `supabase secrets set NAME=value` (or Supabase Dashboard → Edge Functions → Secrets). Never add them to `.env`, `js/config.js`, or `js/runtime-config.js`.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Private Google Gemini API credential used by `gemini-assist` |
| `GEMINI_MODELS` | Comma-separated allowed model IDs and fallback order; e.g. `gemini-2.5-flash,gemini-2.5-flash-lite` |
| `BHASHINI_USER_ID` | Bhashini account identifier sent by the translation Edge Function |
| `BHASHINI_API_KEY` | Private Bhashini API credential |
| `BHASHINI_PIPELINE_ID` | Bhashini translation pipeline enabled for the account/language pair |
| `ANUVAADHUB_ACCESS_TOKEN_EN` | Private Anuvaadhub token for English model routes |
| `ANUVAADHUB_ACCESS_TOKEN_HI` | Private Anuvaadhub token for Hindi model routes |
| `ANUVAADHUB_ACCESS_TOKEN_TA` | Private Anuvaadhub token for Tamil model routes |
| `ANUVAADHUB_ACCESS_TOKEN_TE` | Private Anuvaadhub token for Telugu model routes |
| `ANUVAADHUB_ACCESS_TOKEN_KN` | Private Anuvaadhub token for Kannada model routes |
| `ANUVAADHUB_ACCESS_TOKEN_ML` | Private Anuvaadhub token for Malayalam model routes |
| `ANUVAADHUB_ACCESS_TOKEN_PA` | Private Anuvaadhub token for Punjabi model routes |
| `ANUVAADHUB_ACCESS_TOKEN` | Optional legacy shared Anuvaadhub token fallback when a language-specific value is empty |

Do not create or put a Supabase `service_role` key in the frontend. Firebase Cloud Functions uses its server-managed Admin SDK identity; do not download or ship a service-account JSON key.

### Speech API boundary

Tap-to-talk uses browser `SpeechRecognition`/`webkitSpeechRecognition` when available; recognition support and whether a browser sends audio to its own provider depend on the browser. The separate **Record WAV · Anuvaadhub ASR** control captures a bounded WAV and sends it to the configured Supabase function/provider. VisionMate serializes browser speech and Anuvaadhub audio so they do not play over one another. Gemini generates assistant answers in the selected language; browser speech synthesis speaks those answers using the selected language and an installed system voice where available. Use the **Anuvaadhub text to speech** control to generate provider audio and select any of English, Hindi, Tamil, Telugu, Kannada, Malayalam, or Punjabi. The seven separate Anuvaadhub tokens are resolved server-side from `ANUVAADHUB_ACCESS_TOKEN_EN`, `_HI`, `_TA`, `_TE`, `_KN`, `_ML`, or `_PA`; never put provider tokens in browser code or the model JSON catalog.

## Setup and deployment

### 1. Public runtime config

Copy `.env.example` to `.env` and set the public Supabase project URL/publishable key. Firebase Web App values are optional for Google/email account sign-in; guest mode and its local data do not need Firebase. Then:

```sh
node scripts/build-config.mjs
```

The generated `js/runtime-config.js` is ignored by Git. The Vercel build command should be `node scripts/build-config.mjs`; the output directory is the repository root (`.`). Set the public Supabase variables and, only if using account sign-in, Firebase variables in Vercel Project → Settings → Environment Variables, then redeploy. The generator omits unset/placeholder values and does not block a guest-only deployment. Firebase Hosting also runs the generator from its predeploy hook.

### 2. Firebase

1. Enable Google and Email/Password in Firebase Authentication and add `visionmate.vercel.app` to authorized domains.
2. Register the Firebase project as a third-party Firebase Auth provider in Supabase Auth settings.
3. Deploy the callable which grants Supabase's required `authenticated` claim:

   ```sh
   cd functions
   npm install
   cd ..
   firebase deploy --only functions:ensureSupabaseRole
   ```

   Firebase Functions may require a billing-enabled Firebase project. The Admin SDK runs server-side using managed credentials.

The app is a static site with no root npm package; its Firebase Web SDK imports are pinned to Firebase's CDN. If you later move those imports into an npm-based build, install the SDK with `npm install firebase`. To use the Firebase CLI for hosting, install it with `npm install -g firebase-tools`, then run `firebase login` and `firebase deploy --only hosting` from the project root. This repository already contains `firebase.json`; only run `firebase init hosting` for a new project/configuration, and avoid overwriting the existing settings.

### 3. Supabase database, auth, secrets, and functions

Enable **Anonymous Sign-Ins** in Supabase for all protected Edge Function calls. VisionMate uses a Supabase anonymous session for Gemini, translation, and Anuvaadhub whether or not the user signed in with Firebase; this keeps AI requests independent of Firebase third-party JWT integration. Edge Functions remain protected by `verify_jwt = true`; do not disable JWT verification to hide an Auth configuration error. In the Supabase Dashboard, open **Authentication → Sign In / Providers** and enable Anonymous Sign-Ins. The app's local guest profile still works without cloud configuration, but cloud AI requires this session, deployed functions, and configured server secrets. Firebase third-party Auth integration and the Firebase UID migration are only needed for signed-in account data. Apply migrations in order:

```sh
supabase login
supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
supabase db push
```

Or run `supabase/migrations/202610110001_visionmate.sql` followed by `202610110002_firebase_identity.sql` in the Supabase SQL editor. The second migration changes owner IDs to Firebase UID strings and adds Firebase UID-based RLS.

Copy the private Anuvaadhub token template and fill one key per language:

```sh
Copy-Item supabase/.env.example supabase/.env
# Edit supabase/.env and paste the seven provider keys into their matching rows.
supabase secrets set --env-file supabase/.env
```

The per-language key names are `ANUVAADHUB_ACCESS_TOKEN_EN`, `ANUVAADHUB_ACCESS_TOKEN_HI`, `ANUVAADHUB_ACCESS_TOKEN_TA`, `ANUVAADHUB_ACCESS_TOKEN_TE`, `ANUVAADHUB_ACCESS_TOKEN_KN`, `ANUVAADHUB_ACCESS_TOKEN_ML`, and `ANUVAADHUB_ACCESS_TOKEN_PA`. The Edge Function selects the key corresponding to the request language. For machine translation this is the source language; for TTS/ASR/OCR it is the selected/source language. A single `ANUVAADHUB_ACCESS_TOKEN` remains supported as a fallback. `supabase/.env` is ignored by Git; do not paste keys into `js/config.js`, browser runtime config, or committed files.

The model catalog also contains provider-supplied access-expiration dates (the current routes expire on **2026-10-13**). A valid token alone cannot reactivate an expired model. Refresh the authorized catalog data from the provider and redeploy the function when those grants expire:

```sh
node scripts/build-anuvaadhub-catalog.mjs
supabase functions deploy anuvaadhub-inference
```

Set other provider credentials only to Supabase:

```sh
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY
supabase secrets set GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
supabase secrets set BHASHINI_USER_ID=YOUR_BHASHINI_USER_ID
supabase secrets set BHASHINI_API_KEY=YOUR_BHASHINI_API_KEY
supabase secrets set BHASHINI_PIPELINE_ID=YOUR_BHASHINI_PIPELINE_ID

supabase functions deploy gemini-assist
supabase functions deploy bhashini-translate
supabase functions deploy anuvaadhub-inference
```

Use Gemini model IDs and Bhashini language pairs enabled for your accounts. Rotate any private key that has been exposed. Never add private keys to the root `.env`, `js/config.js`, `js/runtime-config.js`, or the committed JSON model catalog.

#### Supabase guest AI troubleshooting

If AI reports **“Supabase anonymous sign-in is disabled”** or an HTTP error, enable Anonymous Sign-Ins in Supabase, reload, and retry. Error responses now include the Edge Function's returned message/status. Confirm the deployed `gemini-assist`, `bhashini-translate`, and `anuvaadhub-inference` functions still have JWT verification enabled. A Gemini configuration error means the `GEMINI_API_KEY` secret is missing/invalid, the function is not deployed, or configured models/quota are unavailable; inspect the corresponding Supabase Edge Function logs and server secrets above. Firebase third-party Auth integration is needed only for Firebase account database sync.

#### Browser permissions and camera controls

Camera, microphone, location, and notifications are requested only when their feature is used and only through browser permission prompts. The user must choose Allow/Block in the browser/OS; a web page cannot press a permission button for them. Zoom uses a camera hardware constraint when supported and falls back to a centered digital crop; captured images match the visible preview crop. Front/rear switching and fullscreen depend on the browser/device camera APIs. Unsupported controls report an error rather than claiming success. A website/PWA cannot listen for held hardware volume keys, provide background wake-word detection, grant Android accessibility/overlay access, or use volume buttons to make OS permission choices. Use the visible press-and-hold Talk control. A trusted native Android app is required for OS-level accessibility services and hardware-key integration.

### 4. Visit and install

Deploy the repository root to Vercel with the settings above, then visit [https://visionmate.vercel.app](https://visionmate.vercel.app). On supported mobile browsers, use **Add to Home Screen** / **Install app**. Camera, microphone, location, Firebase OAuth, and PWA installation need HTTPS and browser permission.

## File map

| File / folder | Purpose |
|---|---|
| `index.html` | App document, logo, styles/CDN links, runtime config and JS entry points |
| `assets/logo.png` | VisionMate brand mark used in the header, browser tab and PWA icon |
| `assets/icon.svg` | Legacy vector icon asset; the app header and PWA use `assets/logo.png` |
| `manifest.json` | PWA name, theme, install behavior, icons and emergency shortcut |
| `sw.js` | App-shell cache, offline navigation fallback and emergency-screen cache |
| `css/styles.css` | Responsive visual design, mobile layout, touch controls and accessibility styles |
| `js/app.js` | Page rendering, voice command routing, camera workflows, emergency flow, settings and app event handlers |
| `js/config.js` | Public runtime configuration defaults and supported languages |
| `js/runtime-config.js` | Generated public Firebase/Supabase browser config; ignored and not committed |
| `js/auth.js`, `js/firebase.js` | Local profile/session handling and Firebase web sign-in/profile operations |
| `js/supabase.js` | Supabase Edge Function calls and Firebase-token-based account database operations |
| `js/speech.js` | Serialized browser speech/audio output and browser speech recognition input |
| `js/camera.js`, `js/cv.js` | User-started camera preview and image-analysis wrapper |
| `js/mt.js`, `js/anuvaadhub.js`, `js/stt.js`, `js/tts.js` | Translation, provider routing, WAV recording and speech output support |
| `js/intent.js` | Deterministic local response/fallback helper |
| `js/routes.js` | Consent-gated OpenStreetMap place search and pedestrian route estimates |
| `js/gsap-animations.js` | Optional interface transitions and button feedback |
| `supabase/config.toml` | Supabase local/function configuration |
| `supabase/migrations/202610110001_visionmate.sql` | Initial tables, indexes and RLS policies |
| `supabase/migrations/202610110002_firebase_identity.sql` | Firebase UID ownership and Firebase JWT RLS migration |
| `supabase/functions/gemini-assist/index.ts` | Gemini vision and assistant server proxy |
| `supabase/functions/bhashini-translate/index.ts` | Bhashini translation server proxy |
| `supabase/functions/anuvaadhub-inference/index.ts` | Anuvaadhub MT/ASR/TTS/OCR server proxy |
| `supabase/functions/_shared/` | Edge Function CORS helper and approved Anuvaadhub model catalog |
| `supabase/.env.example` | Private, per-language Anuvaadhub secret template; copy locally to ignored `supabase/.env` |
| `functions/index.js` | Firebase callable for Supabase role custom claim |
| `functions/package.json` | Firebase Functions runtime/dependencies |
| `scripts/build-config.mjs` | Generates ignored `js/runtime-config.js` from public environment variables |
| `.env.example` | Placeholder variable names; contains no real credentials |
| `.gitignore` | Excludes local secrets, generated config, access-token files, dependencies and CLI state |
| `firebase.json`, `database.rules.json` | Firebase Hosting deployment and optional Realtime Database rules |

## Important limitations

Browser/device support determines camera, speech recognition, speech voices, vibration, location, and offline capabilities. Scene updates run only while the app is open and the vision screen remains active. Browser alarms may not run after the app closes. Emergency contact and SMS actions hand off to native phone apps and are not automatic emergency-service dispatch.
