# VisionMate

Accessible, voice-first web prototype using HTML, CSS, and browser JavaScript. Firebase Authentication handles Google/email sign-in; Supabase provides user-scoped storage and server-side provider proxies for Gemini vision/assistant requests, Bhashini translation, and Anuvaadhub MT/ASR/TTS/OCR. Supabase Edge Functions use Deno (TypeScript) because provider secrets must not be shipped to a browser.

## Run / deploy

Serve the folder over HTTPS (or `localhost`) so camera, microphone, notifications, and location permissions can work. Static hosting can be Firebase Hosting. There is no frontend build step. The project uses CDN assets for GSAP, Leaflet, and Supabase JS.

## Firebase setup

1. Create a Firebase project and register a Web App.
2. In **Authentication → Sign-in method**, enable **Google** and **Email/Password**.
3. In **Authentication → Settings → Authorized domains**, add the domain where you host VisionMate (localhost for local development).
4. Copy the web app's `apiKey`, `authDomain`, `projectId`, and `appId` into the public Firebase config in `js/config.js`. Firebase Web App config is intended to be public; protect data with Firebase Security Rules if you add Firebase databases.
5. If Google OAuth asks for a web client ID, add it in Firebase Console → Authentication → Google provider; `GOOGLE_OAUTH_CLIENT_ID` in the env template is a reminder only. Firebase's Web SDK uses the configured Google provider and does not read the static `.env` file.
6. Deploy this folder with Firebase Hosting after reviewing `firebase.json`. Google popup login may need a redirect-based flow in embedded/in-app browsers.

Until Firebase is configured, account creation/login deliberately reports an error; it does not fake an authenticated session. The profile form stores its local copy in this browser.

## Supabase setup (database + Edge Functions)

1. Create a Supabase project. In **Authentication → Providers**, enable **Anonymous sign-ins** for the device-local database session. The SQL migration enforces row-level ownership using `auth.uid()`.
2. In `js/config.js`, set `supabase.url` and `supabase.anonKey` to the project URL and publishable/anon key. These two values are meant for browser use; database security must come from the included RLS policies, not secrecy of the anon key.
3. To create the schema without a CLI, open **Supabase Dashboard → SQL Editor → New query**, paste the full contents of [`supabase/migrations/202610110001_visionmate.sql`](./supabase/migrations/202610110001_visionmate.sql), and click **Run**. It is safe to re-run: table/index/policy/trigger creation is idempotent.
4. Or install and authenticate the Supabase CLI, then from this project directory run:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

5. Add the provider secrets **to Supabase**, not to `.env`, `js/config.js`, Git, or browser code:

   ```sh
   supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY
   supabase secrets set GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
   supabase secrets set ANUVAADHUB_ACCESS_TOKEN=YOUR_ROTATED_ANUVAADHUB_TOKEN
   supabase secrets set BHASHINI_USER_ID=YOUR_BHASHINI_USER_ID
   supabase secrets set BHASHINI_API_KEY=YOUR_BHASHINI_API_KEY
   supabase secrets set BHASHINI_PIPELINE_ID=YOUR_BHASHINI_PIPELINE_ID
   ```

   Use the actual Gemini model IDs available to your Google AI project and the pipeline ID/language pairs enabled for your Bhashini account. Do not use made-up model labels such as “3.5 Flash” or “3.8”; fallback order is configured by `GEMINI_MODELS`. The edge function tries the next configured model after provider 404, 429, or 503 responses.

6. Deploy the server functions:

   ```sh
   supabase functions deploy gemini-assist
   supabase functions deploy bhashini-translate
   supabase functions deploy anuvaadhub-inference
   ```

7. Confirm the project URL, anon key, schema, anonymous auth setting, function secrets, and function deployment. The schema includes profiles, settings, conversations/messages, performed-action events, notes, contacts, and reminders. The app syncs these records to the active Supabase Auth identity and keeps selected local copies. In the current setup, anonymous Supabase identities are browser/device sessions and are **not automatically linked to Firebase users**, so data does not follow a person across devices unless you configure an identity bridge.

**Credential safety:** passwords, OAuth tokens, provider API keys, and client secrets must never be stored in the app's tables. Firebase Authentication (or Supabase Auth) manages sign-in credentials; `profiles` stores only account/profile metadata such as name and email. RLS limits profile/settings/chat/action records to the current Supabase Auth user. The app currently starts an anonymous Supabase session, so these records are device/browser scoped until Firebase-to-Supabase identity linking is configured.

### `.env.example` and key safety

`.env` and `.env.example` document variable names only; static HTML/JS does not load `.env` files. `.env` is ignored by Git. The Supabase URL and publishable/anon key may be set in `js/config.js`. Gemini API keys, Bhashini credentials, Supabase service-role keys, and any client secret must only be added with `supabase secrets set` (or another server-side secret manager). Never paste them into frontend config or commit them. If a private key has already been exposed, revoke/rotate it immediately.

## Features and platform boundaries

- Camera preview; deliberate menu/sign captures use Anuvaadhub OCR. Scene descriptions use a single Gemini still frame and may cautiously describe visible details. Neither is continuous video analysis, validated pothole detection, or navigation; both can miss hazards.
- Anuvaadhub offers opt-in recorded WAV speech recognition (up to 20 seconds/5 MB), text-to-speech (up to 30 words), and OCR. Recording captions show status; recognized words arrive after upload/processing, not as live subtitles. The provider routes and active access token are required, and expired catalog access must be renewed.
- Voice commands can save notes/reminders locally and in Supabase, offer a confirmation button for a saved contact call, and open a small allowlist of web sites. The phone dialer asks the user to confirm the call.
- Leaflet map shows user location only after they start location tracking. SOS uses haptics where supported and can report a location link; it does not call emergency services.
- Translator offers Anuvaadhub machine translation (up to 50 words) or Bhashini through a Supabase function; configure approved models, pipelines, and language pairs. Provider route availability varies. Browser TTS voices/languages depend on the device.
- Browser alarms/reminders are best-effort while VisionMate remains open. A website cannot guarantee background alarms or charging alerts.
- Websites cannot close other apps, change the phone's system light/dark mode, set native alarms reliably, or provide general Android app control. A native Android integration with OS permissions is required. The app appearance selector changes VisionMate only.
- Gemini descriptions can hallucinate and must not be used to decide whether a path, road, or crossing is safe. Do not rely on VisionMate to guide walking or detect potholes/vehicles. Use an established mobility aid and trusted assistance; the prototype cannot guarantee safety.
