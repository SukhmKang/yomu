# Yomu · 読む

[Open Yomu](https://yomu-omega.vercel.app) · [Render backend](https://dashboard.render.com/web/srv-dae9ckuq1p3s738elfcg) · [Vercel project](https://vercel.com/sukhmkangs-projects/yomu)

A phone-first Japanese manga reader. Take a photo, tap dialogue, and understand the whole passage without leaving the page.

- Native camera capture and separate photo upload. No live camera stream or browser camera permission loop.
- Tap text regions, combine neighboring regions, or drag across columns with Select multiple.
- **やさしく説明**: a concise Japanese-only explanation (N2 by default), powered by OpenAI **gpt-5.6-luna**.
- Word definitions from the bundled JMdict dictionary; compounds are segmented from OCR symbol positions.
- Zoom the photographed page, resume the last page on your device, and combine selected columns.
- Safari home-screen installation, proper PNG icons, safe-area layout, and offline shell. Previously loaded dictionary portions work offline; scanning and explanations require a connection.
- No Anki or WaniKani integrations. No service credentials in the browser. A backend password protects scanning and explanations; a persistent HttpOnly cookie remembers unlocking for 90 days.

## Run locally

Requires Node 22.13 or newer.

```sh
npm ci
cp .env.example .env
# Edit .env to add GOOGLE_VISION_API_KEY, OPENAI_API_KEY, and APP_PASSWORD.
npm start
```

Open http://127.0.0.1:3000. `npm run dev` restarts the server when backend files change. The same server serves the frontend locally. Keys are read only from the server environment.

## Deploy: Render backend + personal Vercel frontend

Production is deployed to the personal Vercel workspace `sukhmkangs-projects` and the Render project `Yomu`. The configured backend is `https://yomu-api-q595.onrender.com`. Both hosts target this repository's `master` branch. Keep the repository root as the root directory on both hosts.

1. Create a Render Blueprint from `render.yaml`, or create a Node web service with `npm ci --omit=dev` as build command and `npm run start:backend` as start command. Set `HOST=0.0.0.0`, `NODE_ENV=production`, `APP_PASSWORD`, `GOOGLE_VISION_API_KEY`, `OPENAI_API_KEY`, and `OPENAI_MODEL=gpt-5.6-luna`. Health endpoint: `/api/status`.
2. Run `npm run configure:vercel -- https://YOUR-SERVICE.onrender.com` and commit the resulting `vercel.json`. This sets Vercel's same-origin `/api/*` proxy. No browser CORS configuration or frontend secrets are needed.
3. Import the repo into **your personal Vercel workspace**. Use framework “Other”, build command `npm run build`, output directory `frontend`. The checked-in config supplies these values.
4. Set Render's `ALLOWED_ORIGINS` to the actual Vercel production origin (for example `https://your-yomu.vercel.app`, without trailing slash). Additional preview origins can be comma-separated.
5. Enable Git auto-deploy on both hosts. Future pushes to `master` deploy both services.

The Blueprint uses Render's free plan. A sleeping free service can delay the first scan/explanation; the frontend wakes it by requesting status on launch. Choose an always-on paid instance in Render if that delay becomes disruptive.

### Install on iPhone

Open the **Vercel production URL in Safari**, tap **Share → Add to Home Screen**, then launch Yomu from its icon. “Take a photo” invokes the phone's native capture picker. OS permission decisions remain under Safari/iOS control. Use the HTTPS production URL rather than a local HTTP network address.

### Keys

For Google Vision: create/select a personal Google Cloud project, enable billing and **Cloud Vision API**, then create an API key under **APIs & Services → Credentials**. Restrict the key to **Cloud Vision API**. Requests originate from Render, not from a browser referrer.

For OpenAI: create a project API key with access to `gpt-5.6-luna`. Place it in `OPENAI_API_KEY` on Render (or local `.env`). The model is configurable via `OPENAI_MODEL`. The backend uses the Responses API with strict structured output and `store: false`.

## Structure

- `frontend/`: static PWA; only this directory is published by Vercel.
- `backend/server.js`: Node HTTP server, fixed provider endpoints, validation, timeouts and sanitized errors.
- `data/index.json`: original bundled dictionary source, not publicly served.
- `scripts/build-dict.js`: splits the dictionary into 256 small files so phones don't download 69 MB for one lookup.
- `scripts/configure-vercel.js`: configures the API proxy for your Render URL.
- `tests/`: API and browser regression tests.

## Verification

```sh
npm test
npx playwright install chromium webkit
npm run test:ui
```

Browser tests run in iPhone WebKit and desktop Chromium with mocked OCR and explanation responses. They cover upload/retry, bubble selection, dictionary lookup, learner level, caching, and stale response protection. Real camera hardware needs an actual device. The offline reload test passes in Chromium; Playwright WebKit returns an internal navigation error in offline emulation, so that test is skipped and offline launch still needs a physical iPhone check. Live Vision scanning and GPT-5.6 Luna explanations have also been verified using a synthetic Japanese dialogue image.

## Data and limitations

Only the latest page is saved locally in IndexedDB; remove it under Preferences → Forget saved page. Photos go to Google Vision only when scanned. The selected passage and up to 6,000 characters of page context go to OpenAI only when you request an explanation. API responses are not service-worker cached. Provider errors and keys are not logged.

OCR text regions use Google Vision paragraphs, which are not guaranteed to match manga speech-bubble boundaries. Tap multiple regions or use Select multiple and drag across columns to join dialogue. Ambiguous speakers and missing context are explicitly called out by the explanation prompt. Scanned furigana, unusual lettering and rotated pages can still need correction.

This is a personal reader with one shared backend password. The browser keeps a signed, expiring session cookie, never the password. Changing APP_PASSWORD invalidates existing sessions. Settings → Lock removes the cookie from this browser. The app shell and dictionary are public static files; photo scanning and explanations require authentication. Offline startup shows the lock screen because the backend cannot verify the session offline.
