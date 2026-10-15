# The Note Taker

Record audio in the browser, transcribe speech, convert transcripts into structured AI notes, and export Word or PDF documents.

## Setup
Requires Node.js 20+. Run `npm install`, copy `.env.example` to `.env`, set keys, then run `npm run server` and (in another terminal) `npm run dev`. Open http://localhost:5173.

## Deploy
Railway backend: start command `npm run server`, variables `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CORS_ORIGIN=https://your-frontend-domain`. Netlify frontend: build `npm run build`, publish `dist`, and set `VITE_API_BASE_URL=https://your-railway-domain`.

## Important
Microphone access requires HTTPS except localhost. Audio downloads on Stop; uploads are limited to 24 MB. Transcription requires an OpenAI API key if browser speech recognition is unavailable. Claude provides AI notes; basic outlining is available without Claude. Saved notes use browser localStorage only and do not sync devices.

**Security:** The API has no authentication or rate limiting. Secure it before public deployment to avoid unauthorized API use and costs. Keep API keys only in server environment variables, never in source or VITE variables. Get permission before recording other people.
