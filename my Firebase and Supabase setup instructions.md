# My Firebase and Supabase setup instructions

This is the quick-start companion for [VisionMate](https://visionmate.vercel.app). Keep private provider keys in Supabase secrets, never in frontend files or Git.

## Fast start

### A. Supabase (needed for cloud AI)

1. Use the existing Supabase project with ref `bwxvnkutnjagqsivuqbz`. Its project URL is `https://bwxvnkutnjagqsivuqbz.supabase.co`; copy its publishable/anon key from Project Settings → API Keys.
2. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**. VisionMate uses this protected session for guest AI and translation.
3. From the repository root, run:

   ```sh
   supabase login
   supabase link --project-ref bwxvnkutnjagqsivuqbz
   supabase db push
   ```

   This applies the migrations in `supabase/migrations/`. The Firebase identity migration supports signed-in account sync; guest cloud AI uses Supabase anonymous Auth.
4. Set provider secrets in the Supabase Dashboard under **Edge Functions → Secrets**. Add `GEMINI_API_KEY` with a newly generated Gemini key and `GEMINI_MODELS` with `gemini-2.5-flash,gemini-2.5-flash-lite`. Never paste provider keys into chat, frontend files, Git, or shell commands that may be saved in command history. If a key was shared or committed, revoke it at the provider and create a replacement before adding it here.

   Add each Anuvaadhub language token as its matching secret (`ANUVAADHUB_ACCESS_TOKEN_EN`, `_HI`, `_TA`, `_TE`, `_KN`, `_ML`, `_PA`). Optional Bhashini translation credentials are `BHASHINI_USER_ID`, `BHASHINI_API_KEY`, and `BHASHINI_PIPELINE_ID`; add them as secrets if using Bhashini. The `supabase/.env.example` file is a template only; do not commit filled-in secrets.
5. Deploy the functions:

   ```sh
   supabase functions deploy gemini-assist
   supabase functions deploy bhashini-translate
   supabase functions deploy anuvaadhub-inference
   ```

### B. Firebase (optional sign-in/account sync)

1. Create a Firebase project and Web App. Enable Google and/or Email/Password under **Authentication → Sign-in method**.
2. Add `visionmate.vercel.app` and your local host under **Authentication → Settings → Authorized domains**.
3. Copy the Firebase Web App API key, auth domain, project ID, and app ID into the root `.env.example` copy described below. These are browser configuration values, not Admin credentials.
4. For account sync, add Firebase as a third-party provider in Supabase Auth and deploy the Firebase role-claim callable:

   ```powershell
   Set-Location functions
   npm install
   Set-Location ..
   firebase deploy --only functions:ensureSupabaseRole
   ```

   Functions deployment can require a billing-enabled Firebase project. Firebase Admin uses managed server identity; do not put a service-account JSON key in the website.
5. To host the static app on Firebase Hosting, install the Firebase CLI if needed, then:

   ```sh
   npm install -g firebase-tools
   firebase login
   firebase deploy --only hosting
   ```

   The existing `firebase.json` already configures Hosting; do not run `firebase init` over it.

Firebase Realtime Database is optional and is used only for a profile mirror. If you want it, create the database, set `FIREBASE_DATABASE_URL` in the root public configuration, and deploy the supplied `database.rules.json`. It is not required for guest mode or Supabase account storage.

### C. Configure and publish the frontend

1. Copy root `.env.example` to `.env`.
2. Fill `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Add Firebase values only when enabling Firebase sign-in.
3. Generate the browser config:

   ```sh
   node scripts/build-config.mjs
   ```

   The output `js/runtime-config.js` is ignored by Git and contains public values only. Do not put Gemini, Bhashini, Anuvaadhub private tokens, or a Supabase service-role key there.
4. For Vercel, set the same public values in Project Settings → Environment Variables, use `node scripts/build-config.mjs` as the build command and `.` as the output directory, then deploy. No root `npm install` is needed for this static frontend. Firebase Web SDK imports currently use a CDN; `npm install firebase` is only relevant if you later convert the frontend to an npm-managed build.
5. Open the HTTPS site and test guest access, then test cloud AI and optional sign-in separately.

## Supabase Google OAuth callback

For Google configured as a **Supabase Auth provider**, register this exact **Authorized redirect URI** in the Google OAuth client:

```text
https://bwxvnkutnjagqsivuqbz.supabase.co/auth/v1/callback
```

Then place the Google OAuth client ID and secret in Supabase’s Google provider settings. This is the Supabase provider callback; it is **not** Firebase’s callback. The current app’s Google login uses Firebase popup authentication, so this callback is only needed if you separately enable Supabase Google OAuth.

## Where each value belongs

| Value | Put it here |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Root `.env` for local config generation; Vercel/Firebase Hosting environment for deployment |
| Firebase Web App values | Root `.env`/hosting environment; public configuration generated for the browser |
| `GEMINI_API_KEY`, `GEMINI_MODELS` | Supabase Edge Function secrets |
| `ANUVAADHUB_ACCESS_TOKEN_EN`, `_HI`, `_TA`, `_TE`, `_KN`, `_ML`, `_PA` | `supabase/.env` locally, then deployed to Supabase secrets |
| Bhashini credentials | Supabase Edge Function secrets |
| Supabase service-role key or Firebase Admin credentials | Never in the browser, root public config, or committed files |

## Common setup checks

- **“Supabase anonymous sign-in is disabled”**: enable Anonymous Sign-Ins in the Supabase Auth providers page, then reload.
- **AI function error**: confirm `GEMINI_API_KEY`, `gemini-assist` deployment, JWT verification, model access/quota, and Supabase function logs.
- **Account data/RLS error**: confirm Firebase login, Firebase third-party Auth setup in Supabase, role-claim callable, both migrations, and the signed-in user's Firebase UID.
- **Google redirect error**: distinguish Firebase popup authorized domains from Supabase’s callback URI above. Add the callback only to the Google OAuth client when using Supabase Google Auth.
- **No location/map**: use HTTPS, allow browser location after consent, and check access to Photon, Valhalla, and OpenStreetMap tile services.
- **No Gemini speech in a regional language**: check the Gemini secret/function/model access and internet connection. Device fallback requires an installed voice for that language.

Camera, location, speech, and notifications depend on browser support and user permission. A website cannot request Android “display over other apps,” read held volume buttons, control other installed apps, or approve OS permission prompts; those need a separately developed native app.
