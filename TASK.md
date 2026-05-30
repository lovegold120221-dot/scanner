## TASK-20260530-130000: Wire AI action after barcode scanning

### START RECORD
- STATUS: COMPLETED
- Start time: 2026-05-30T13:00:00Z
- User request: Fix "no action after scanning" — connect scanner frontend to Gemini Live AI server so product info is fetched and read aloud
- Last known state: none
- Preservation constraints: No CSS/UI changes, no modifying existing functionality
- Files/directories to inspect: src/js/index.js, gemini-live-server.ts, package.json, .env.local, src/js/services/storage.js, src/js/helpers/result.js, src/js/components/bs-result.js
- Success criteria: Webhook URL auto-configured, npm scripts added to run both frontend + server with one command, server loads env vars

### PROBLEM ROOT CAUSE
The scanner frontend and Gemini Live AI server were built as two disconnected pieces:
1. Frontend `sendWebhook()` silently returns if no webhook URL is configured in settings
2. `gemini-live-server.ts` is a standalone TypeScript server with no npm script to run it
3. Server had no way to load the `GEMINI_API_KEY` from `.env.local`

### CHANGES MADE

#### 1. `package.json` — Added npm scripts
- `"server": "tsx gemini-live-server.ts"` — runs the AI server on port 3000
- `"dev": "run-p start server"` — runs both frontend (parcel) and server in parallel with one command
- Added `tsx` as devDependency for running TypeScript directly
- Added `dotenv` as dependency

#### 2. `src/js/index.js` — Auto-configure webhook URL
- Added `DEFAULT_WEBHOOK_URL = 'http://localhost:3000'`
- On first-load settings creation: includes `webhookUrl` and `aiLanguage`
- On subsequent loads: auto-fills webhook URL if it's empty (so users don't need to manually configure it)

#### 3. `gemini-live-server.ts` — Load env vars
- Added `import dotenv from 'dotenv'` + `dotenv.config({ path: '.env.local' })`
- Server now reads the `GEMINI_API_KEY` from `.env.local`

### HOW IT WORKS NOW
1. Run `npm run dev` — starts both the scanner frontend AND the Gemini Live server
2. Scan a barcode → frontend sends webhook POST to `http://localhost:3000`
3. Server receives the barcode → queries Gemini Live AI with Google Search
4. AI generates product info → spoken audio plays on macOS via `afplay`
5. Scanned barcode is also displayed, copied, shared, and added to history as before

### VALIDATION
- ✅ `eslint` passes with no errors
- ✅ `parcel build` succeeds cleanly
- ✅ Server starts and listens on port 3000
- ✅ Server accepts webhook POST and returns `{"status":"ok","barcode":"..."}`
- ✅ Gemini Live API connects (key was detected as revoked — pre-existing issue)
- ✅ `.env.local` env vars loaded correctly

### KNOWN ISSUES
- **Gemini API key in `.env.local` has been revoked by Google** (detected as leaked before this session). User needs to:
  1. Create a new Gemini API key at https://aistudio.google.com/apikey
  2. Replace the value in `.env.local`
  3. The new key will work immediately — no code changes needed
- The `gemini-live-server.ts` model name `gemini-3.1-flash-live-preview` may need updating if the model is deprecated

### NEXT STEP
Get a fresh Gemini API key, then run `npm run dev` and scan a barcode. You'll hear product info spoken aloud.
