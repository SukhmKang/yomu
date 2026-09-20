# Yomu project notes

See README.md for the current architecture, setup, deployment, and tests.

Yomu is a phone-first Japanese manga reader. There are two clients:

- `ios/` — the SwiftUI app, and the one being developed. Camera-first, on-device OCR
  and dictionary. Build the project with `xcodegen generate` after changing
  `ios/project.yml`; never hand-edit `Yomu.xcodeproj`.
- `frontend/` — the original PWA, kept working but no longer the focus.

The iOS app has no lock screen: it sends `Authorization: Bearer <APP_PASSWORD>` from
`Secrets.xcconfig` (gitignored). Do not remove that auth — the Vercel URL is public
and an open `/api/explain` spends the owner's OpenAI key. The PWA keeps the password
and cookie.

Credentials and provider requests belong only in `backend/` and `api/`. Use OpenAI
`gpt-5.6-luna` for explanations. Anki and WaniKani integrations have been removed.

OCR on iOS must use VisionKit's `ImageAnalyzer` (the Live Text engine).
`VNRecognizeTextRequest` returns nothing at all for vertical Japanese — this was
measured against real manga pages, not assumed.

`NLTagger` is useless for Japanese: every token comes back as `OtherWord` with an
empty lemma. Word segmentation and de-inflection live in `JapaneseSegmenter`.

Publish the frontend only in the owner's personal Vercel workspace,
`sukhmkangs-projects`. The Exa workspace must not receive deployments for this app.
