# Yomu project notes

See README.md for the current architecture, setup, deployment, and tests.

The app is a phone-first Japanese manga reader. Frontend files live in `frontend/`; credentials and provider requests belong only in `backend/`. Use OpenAI `gpt-5.6-luna` for explanations and Google Vision for OCR. Anki and WaniKani integrations have been removed.

Publish the frontend only in the owner's personal Vercel workspace, `sukhmkangs-projects`. The Exa workspace must not receive deployments for this app.
