# The Note Taker — personal and public editions

The app has **two independent Vercel frontends** using one Railway Node/Express backend.

## Editions

- **Personal / bring-your-own-key:** https://the-note-taker.vercel.app
  - Select Anthropic, OpenAI, or Gemini under Settings.
  - Supply the API key for each browser tab. Personal keys are never stored in browser localStorage.
  - The backend deliberately does **not** fall back to the owner's Railway `ANTHROPIC_API_KEY` for visitor requests.
  - Uploaded transcription requires the user's own OpenAI API key.
  - Saved notes are local to the user's browser; this is **not** yet a password-protected owner account.
  - Claude Pro subscription credentials cannot be used in this deployed public API; use supported local Claude tooling independently.
- **Public free:** https://the-note-taker-free.vercel.app
  - Two free AI note sessions per UTC day, up to five minutes of audio per session.
  - Recording automatically stops at 5:00 while the browser remains active; the server checks actual uploaded audio duration.
  - Pasted transcripts are capped at 1,000 words (an approximation, not a verified 5-minute duration).
  - Server-side SQLite tracks anonymous device IDs and applies an IP allowance as additional abuse friction.
  - No user accounts yet: deleting local storage or switching devices/networks can circumvent anonymous quotas. Require accounts/verification before paid public scale.
  - Uses only `PUBLIC_OPENAI_API_KEY` for transcription and summaries; **not** Anthropic's personal key.
  - If `FREE_NOTES_ENABLED` is not `true` or no funded public key exists, AI controls remain disabled and a clear message appears.
  - Paid subscription checkout and authorization are **not yet live**. Do not advertise paid access as available until backend webhook verification and account entitlements exist.

## Environment configuration — Railway

Set these on the `note-taker-api` service:

```ini
QUOTA_HASH_SECRET=<random stable secret 32+ characters>
QUOTA_DB_PATH=/data/note-taker-quota.sqlite
PUBLIC_OPENAI_API_KEY=<funded, dedicated OpenAI project key>
FREE_NOTES_ENABLED=false
PUBLIC_NOTES_MODEL=gpt-4o-mini
CORS_ORIGIN=https://the-note-taker.vercel.app,https://the-note-taker-free.vercel.app
```

Attach a persistent Railway volume at `/data`. The SQLite quota database is stored on this volume, surviving redeployments. The service is currently designed for one Railway instance. Set `FREE_NOTES_ENABLED=true` only after verifying public key billing, rate limits, quotas, and the public endpoint end to end. Never commit API keys or send them to the frontend bundle.

## Vercel setup

Personal project: `the-note-taker` with:

```ini
VITE_APP_MODE=personal
VITE_API_BASE_URL=https://note-taker-api-production.up.railway.app
```

Public project: `the-note-taker-free` with:

```ini
VITE_APP_MODE=public
VITE_API_BASE_URL=https://note-taker-api-production.up.railway.app
```

The deployments are currently created by uploading repository files through the Vercel integration; automatic Git-to-Vercel sync requires configuring the Git integration.

## Plans

Planned pricing:

| Tier | Price | Features |
|---|---:|---|
| Free | $0 | 2 free AI notes per UTC day, max 5 minutes each |
| BYOK | $0 to app owner | Users pay their own supported LLM API usage |
| Pro | $7.77/mo (planned) | Larger fixed monthly quota, subject to checkout/entitlement integration |

Stripe subscription billing is not connected to the backend. This is not yet a production-ready metered SaaS (no accounts, no webhook/entitlements, abuse-prone anonymous quota).

## iPhone

Use Safari and keep the tab open and the screen awake while recording. Browser microphone recording is not guaranteed to continue while the iPhone is locked or the tab is backgrounded. For critical recordings, use Voice Memos as a backup and upload an M4A file up to five minutes.

## Privacy and safety

- Browser-saved note text is stored locally in localStorage (do not use for regulated/confidential information without an appropriate security review).
- Audio and transcripts are sent to the chosen AI/transcription provider through Railway.
- Use domain and origin allowlists, server-side quotas, a stable secret, and a separate publicly budgeted billing key.
- The anonymous free allowance is an MVP safeguard, **not** a strong identity or billing control.
