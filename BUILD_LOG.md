# BolSite build log

## Verified API facts (official docs, dev.meta.ai/docs, 2026-11-02)
- Base URL `https://api.meta.ai/v1`, bearer auth with `MODEL_API_KEY`.
- Chat: `POST /chat/completions`, `muse-spark-1.3`, `response_format: json_schema`, vision via `image_url` parts. `reasoning_effort: none` is rejected.
- Transcription: `POST /asr/transcribe`, `muse-voice-transcribe-1.0`, multipart, **WAV only** (mono 16-bit 16/24 kHz).
- SAM 3.1: `POST /responses`, `sam-3.1`, concept prompt + `input_image` (data URL OK), non-streaming OK, `metadata.include_confidence: "true"`. Output is special-token text; we parse boxes only.
- Muse Image: `POST /images/generations`, `muse-image-1.0`, returns **WebP** b64 (~13 s).
- The quickstart URL in the PRD 404s; the working one is dev.meta.ai/docs/cookbook/quickstart-chat-completions.

## Status (all on real Meta models, no fallbacks in use)

| Piece | State | Timing |
|---|---|---|
| `POST /api/transcribe` | Working (Muse Voice Transcribe) | ~8 s |
| `POST /api/extract` | Working (Muse Spark, effort medium) | ~17–19 s |
| `POST /api/clarify` | Working (Spark interprets typed answers; taps need no model) | ~2.5 s |
| `POST /api/segment` | Working (Spark vision picks concepts → SAM 3.1 boxes, parallel) | ~10–13 s, runs while owner answers questions |
| `POST /api/generate` | Working (Spark bilingual copy + grounding check; Muse Image hero only without photos) | ~9 s with photo, ~40–80 s with Muse Image |
| `POST /api/verify` | Working: 8 checks, incl. real 360px render measured in-browser | ~2.5 s |
| `POST /api/publish` | Working: re-runs all checks server-side, write-once marker | ~2 s |
| `GET /<slug>` | Working: path-based URLs, private Blob store, strict CSP, no JS on sites | — |
| Headless e2e (`scripts/e2e.mjs`) | Passes golden path at 360px | ~47 s record → published |
| Vercel deploy | **Not yet** | — |

## Fallbacks
None in use. Built-in degradations: SAM no-match → full photo card; segment failure → site without cards; Muse Image text detected twice → no hero; copy fails grounding twice → tagline/about dropped.

## Honesty rules enforced in code (not just prompts)
- Evidence quote must exist in transcript, otherwise confidence is capped at 0.5 (lib/extract.js).
- Phone must normalize to a valid +91 10-digit number.
- Prices: Spark gives a number + the exact spoken words; `lib/numwords.js` parses the words (ढाई सौ = 250) and any mismatch drops the price.
- Clarification: one round, tap / type / skip; typed answers re-validated; still weak → omitted. Required fact omitted → no site.
- Signboard text read from a photo is offered as a tap option for the name (photo is a valid source), never auto-applied.
- Site copy: every number must appear in the owner's facts, claim words ("best", "since", "सबसे"…) rejected unless the owner said them. Retry once, then drop free-form copy.
- Muse Image hero: no-text prompt + Spark vision check; text found → regenerate once → else no hero. Labelled "AI-generated image" on page.
- Verify: every number on the page traces to the owner, links/images resolve, no placeholders, 360px render clean, page hash unchanged.

## Bugs found by real testing (fixed)
- Muse Image painted an invented signboard ("भोला टेलर्स… 2 दिन में") → no-text check added. It caught text again on a later run.
- Spark linked "fabric roll" to the service "suit" → service links only for the exact product.
- Spark returned prices as words → numeric contract + deterministic cross-check.
- Lazy images hung the 360px measurement; the card image height attribute broke the 1:1 crop.
- Headless Edge `--window-size=360` silently renders at ~500px on Windows; use the e2e script (device emulation) for screenshots.

## Notes
- The dev server caches modules: restart `npm run dev` after editing `lib/`.
- `samples/probe.webp` is a Muse Image test photo (synthetic); use real shop photos for demo quality.
