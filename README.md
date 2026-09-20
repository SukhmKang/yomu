# Yomu · 読む

[Open Yomu](https://yomu-omega.vercel.app) · [Render backend](https://dashboard.render.com/web/srv-dae9ckuq1p3s738elfcg) · [Vercel project](https://vercel.com/sukhmkangs-projects/yomu)

A phone-first Japanese manga reader. Take a photo, tap dialogue, and understand the whole passage without leaving the page.

- Native camera capture and separate photo upload. No live camera stream or browser camera permission loop.
- Tap text regions, combine neighboring regions, or drag across columns with Select multiple.
- **やさしく説明**: a concise Japanese-only explanation (N2 by default), powered by OpenAI **gpt-5.6-luna**.
- Word definitions from the bundled JMdict dictionary; compounds are segmented from OCR symbol positions.
- Zoom the photographed page, resume the last page on your device, and combine selected columns.
- Safari home-screen installation, proper PNG icons, safe-area layout, and offline shell. Previously loaded dictionary portions work offline; scanning and explanations require a connection.
- No Anki or WaniKani integrations. No service credentials in the browser. The API is protected by a password (PWA, via a persistent HttpOnly cookie) or a bundled bearer token (iOS, with no lock screen).

## iOS app (`ios/`)

The native client, and the one to use for reading. It is camera-first: launching
lands on a live viewfinder, and the reader is an overlay above a capture session
that never stops, so the next page is one tap away.

Reading a page uses **VisionKit's `ImageAnalyzer`** — the Live Text engine — entirely
on device, in roughly 300ms. This matters and is not interchangeable with the more
obvious API: `VNRecognizeTextRequest` recognizes *nothing* in vertical Japanese, at
any text-height threshold, upscale or rotation, even though it lists `ja-JP` as
supported. Live Text also strips furigana and returns columns in reading order,
which Google Vision does not.

Selection is Apple's own Live Text text selection (`ImageAnalysisInteraction`), so
there is no word-versus-passage mode: granularity is however far you drag. Changing
the selection automatically fills in both the vocabulary and the explanation — there
is no button to press.

Word lookup is local. `scripts/build-ios-dict.mjs` turns `data/index.json` into a
bundled 40 MB SQLite file; `JapaneseSegmenter` does longest-match segmentation with a
de-inflection table so 会って resolves to 会う. `NLTagger` cannot help here — for
Japanese it reports every token as `OtherWord` with an empty lemma, giving neither
part of speech nor dictionary form.

The only network call is the explanation, which streams (first text in about a
second, against roughly four for a whole non-streamed answer).

There is no sign-in. The app sends the API token from its bundle as
`Authorization: Bearer`, so the endpoint stays closed to the internet — it is a
public URL, and an open `/api/explain` would spend the OpenAI key for whoever found
it — while the reader never sees a lock screen. The PWA still uses the password and
signed session cookie.

### Build

Requires Xcode. `xcodegen` generates the project from `ios/project.yml`:

```sh
brew install xcodegen
npm run build:ios-dict                         # writes ios/Yomu/Resources/jmdict.sqlite
cd ios
cp Secrets.xcconfig.example Secrets.xcconfig   # set YOMU_API_TOKEN to the API's APP_PASSWORD
xcodegen generate
open Yomu.xcodeproj
```

`Secrets.xcconfig` is not in git. Without it the app builds but explanations fail
with a message saying the token is missing.

Both `ios/Yomu.xcodeproj` and the generated dictionary are ignored by git; regenerate
them rather than committing them. Running on a physical iPhone needs a signing team
in Xcode; without a paid Apple Developer account a free-provisioned build expires
after seven days.

The server address is set in the app's Preferences, reachable from the lock screen
too, so a wrong address is never a dead end.

## Run locally

Requires Node 22.13 or newer.

```sh
npm ci
cp .env.example .env
# Edit .env to add GOOGLE_VISION_API_KEY, OPENAI_API_KEY, and APP_PASSWORD.
npm start
```

Open http://127.0.0.1:3000. `npm run dev` restarts the server when backend files change. The same server serves the frontend locally. Keys are read only from the server environment.

## Deploy: Vercel (frontend and API)

Production is the personal Vercel workspace `sukhmkangs-projects`, deploying this
repository's `master` branch from the repository root. Render is no longer used: its
free tier slept between reading sessions and cost about 30 seconds to wake, which
`api/[...path].js` replaces with a serverless cold start of roughly 200ms.

1. Import the repo into **your personal Vercel workspace**. Framework “Other”, build
   command `npm run build`, output directory `frontend`. The checked-in `vercel.json`
   supplies these.
2. Set the project's environment variables: `APP_PASSWORD`, `GOOGLE_VISION_API_KEY`,
   `OPENAI_API_KEY`, and `OPENAI_MODEL=gpt-5.6-luna`.
3. Enable Git auto-deploy. Pushes to `master` deploy the frontend and the API
   together, on one origin, so no CORS configuration is needed. `ALLOWED_ORIGINS` is
   only needed for a second origin such as the iOS app pointing at a preview URL.

`backend/api.js` holds the routing, auth, validation and provider calls.
`backend/server.js` (local development and tests) and `api/[...path].js` (Vercel) are
thin wrappers over it, so there is one implementation to reason about.

**One caveat from the move:** Vercel caps a serverless request body at 4.5 MB, while
`/api/vision` accepts up to 12 MB. The PWA downscales to 2048px before upload, which
lands well under the cap in practice, but a very large image will now fail at the
platform rather than in the handler. The iOS app is unaffected — it never calls
`/api/vision`, because OCR runs on the device.

### Install on iPhone

Prefer the iOS app in `ios/`. The PWA still works: open the **Vercel production URL
in Safari**, tap **Share → Add to Home Screen**. Use the HTTPS production URL rather
than a local HTTP network address.

### Keys

For Google Vision (PWA only): create/select a personal Google Cloud project, enable
billing and **Cloud Vision API**, then create an API key under **APIs & Services →
Credentials**. Restrict the key to **Cloud Vision API**.

For OpenAI: create a project API key with access to `gpt-5.6-luna`. The model is
configurable via `OPENAI_MODEL`. The API uses the Responses API with `store: false`,
structured output for `/api/explain` and streaming for `/api/explain-stream`.

## Structure

- `frontend/`: static PWA; only this directory is published by Vercel.
- `ios/`: the SwiftUI app. Generate the Xcode project with `xcodegen`.
- `backend/api.js`: all API logic — auth, validation, provider calls, sanitized errors.
- `backend/server.js`: Node HTTP wrapper for local development and tests; also serves the PWA.
- `api/[...path].js`: the same API as Vercel serverless functions.
- `data/index.json`: original bundled dictionary source, not publicly served.
- `scripts/build-dict.js`: splits the dictionary into 256 small files so phones don't download 69 MB for one lookup.
- `scripts/build-ios-dict.mjs`: builds the SQLite dictionary the iOS app bundles.
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
