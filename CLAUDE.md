# Yomu project notes

See README.md for the current architecture, setup, deployment, and tests.

Yomu is a phone-first Japanese manga reader. There are two clients:

- `ios/` — the SwiftUI app, and the one being developed. Camera-first, with an
  on-device dictionary; page scanning goes to Google Vision. Build the project with `xcodegen generate` after changing
  `ios/project.yml`; never hand-edit `Yomu.xcodeproj`.
- `frontend/` — the original PWA, kept working but no longer the focus.

The iOS app has no lock screen: it sends `Authorization: Bearer <APP_PASSWORD>` from
`Secrets.xcconfig` (gitignored). Do not remove that auth — the Vercel URL is public
and an open `/api/explain` spends the owner's OpenAI key. The PWA keeps the password
and cookie.

Credentials and provider requests belong only in `backend/` and `api/`. Use OpenAI
`gpt-5.6-luna` for explanations. Anki and WaniKani integrations have been removed.

OCR goes through Google Vision (`/api/vision`), not on-device. Two Apple APIs were
measured against real manga and both fell short: `VNRecognizeTextRequest` returns
nothing at all for vertical Japanese, and VisionKit's `ImageAnalyzer` reads it well
but exposes no geometry, so there is nothing to draw a tap target on — and tapping a
bubble is the whole interaction. Vision returns per-symbol boxes, which is what the
overlay needs.

Do not group Vision's output by hand. Its paragraph boxes are unreliable — on one
cover they came back as horizontal strips across four vertical columns, and on a
novel page six columns were merged into one block with the text out of order — but
every symbol carries a `detectedBreak`, and that line segmentation is correct in
both cases. Read the markers. An earlier attempt to cluster the boxes instead
needed hand-tuned constants and fit the sample it was written against.

The app archives the exact JPEG it uploads and the exact response to its Documents
directory; debug segmentation against those, never against a screenshot.

Dictionary lookup follows Yomitan exactly: Jitendex as the dictionary, Yomitan's
de-inflection rules (`vendor/yomitan`), and Yomitan's check that a de-inflected form
matches the entry's grammatical codes. Do not add filters or ranking heuristics to
patch individual lookups — every one tried so far fixed one word and broke others.
When a result looks wrong, first check what real Yomitan returns;
`~/Developer/japanese-term-select` runs the unmodified upstream engine. Several
"wrong" results (うえ → 飢え, 前 → ぜん) are Yomitan's own behaviour without a
frequency dictionary.

`NLTagger` is useless for Japanese: every token comes back as `OtherWord` with an
empty lemma. `NLTokenizer`'s word boundaries are good, and are used so matches do
not begin or end mid-word.

Publish the frontend only in the owner's personal Vercel workspace,
`sukhmkangs-projects`. The Exa workspace must not receive deployments for this app.
