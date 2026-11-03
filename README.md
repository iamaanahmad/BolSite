# BolSite

**Bolo, aur website ban jayegi.** Speak for 60 seconds, get a live website.

A small-business owner records a short voice note in Hindi, English, or Hinglish and uploads up to three phone photos. BolSite transcribes the note, extracts the business facts with a confidence score on each one, asks at most one question for anything it is unsure about, builds a mobile-first one-page website, verifies it, and publishes it to a public URL.

Built for the Meta Global AI Developer Hackathon 2026 (Indie track). Theme: *Build for Your World*.

## Live demo

- **App:** https://bolsite.vercel.app
- **Source:** https://github.com/iamaanahmad/BolSite
- Each run publishes its own site at `bolsite.vercel.app/<business-name>-<id>`. Generate one from the app to see a live example.

## Why it matters

Millions of Indian small businesses — tailors, kirana stores, repair shops — have no website. Their owners are more comfortable speaking than typing, often in a mix of Hindi and English, and existing site builders assume English typing and design skill. BolSite removes both barriers.

## The one rule: never invent a fact

Everything on a published site comes from the owner's own words, a photo, or an answer they gave. This is enforced in code, not just in prompts:

- Every extracted fact must cite the exact words from the transcript that support it, matched as a verbatim substring (not loose word overlap). If the quote is not in the transcript, the fact is capped below the publish threshold.
- The proposed value must be bound to its own cited evidence: a business name must appear verbatim in its quote, and a phone's digits (including digits spoken as words, in English, Hindi, or Devanagari) must match the cited span. Interpreted fields like category and hours still require a real transcript quote.
- A regression suite (`npm run test:gate`) encodes four exploits reviewers found — a value citing unrelated evidence, a mismatched phone, an unspoken price, and word-overlap-only evidence — as tests that must stay red-before / green-after.
- Business name, category, and phone must each reach 0.75 confidence or the site does not publish.
- Any weak fact gets at most one clarification question (tap, type, or skip). Still weak afterwards, it is left off the page. Never guessed.
- Prices are returned as a number plus the exact spoken words, and a deterministic parser cross-checks them (so "ढाई सौ" must equal 250).
- The generated copy is scanned: any number not in the owner's facts, or any marketing claim the owner did not make, is rejected.
- A pre-publish verification pass checks phone format, price sanity, that every link and image resolves, that every number on the page traces back to the owner, that there is no placeholder text, and that the page renders cleanly at 360px. Any failure blocks publishing.

## Meta models used

| Model | Where |
|---|---|
| Muse Voice Transcribe | `/api/transcribe` — Hindi/Hinglish speech to text with code-switching |
| Muse Spark | `/api/extract`, `/api/clarify`, `/api/segment` (vision), `/api/generate` (bilingual copy) |
| Segment Anything Model 3.1 | `/api/segment` — cuts product regions out of photos for catalog cards |
| Muse Image | `/api/generate` — a hero image only when the owner uploaded no usable photo, always labelled "AI-generated" on the page |

All calls go to the Meta Model API (`https://api.meta.ai/v1`), OpenAI-compatible dialect.

## Pipeline

```
browser (record + upload, WAV 16 kHz in-browser)
  → POST /api/transcribe   audio  → text              (Muse Voice Transcribe)
  → POST /api/extract      text   → facts + confidence (Muse Spark, deterministic honesty gate)
  → POST /api/clarify      one round of questions      (Muse Spark for typed answers)
  → POST /api/segment      photos → product crops      (Muse Spark vision → SAM 3.1)
  → POST /api/generate     facts  → stored draft site  (Muse Spark copy; Muse Image hero if needed)
  → POST /api/verify       draft  → pass/fail checks   (incl. real 360px render)
  → POST /api/publish      re-verify, then go public
  → GET  /<slug>           the live site
```

Stateless, one business per run, no database. Sites are stored in a private Vercel Blob store and served at path-based URLs.

## Run it locally

Requires Node 22+, ffmpeg (for the CLI tester), and a Meta Model API key.

```bash
npm install
cp .env.example .env.local   # fill in MODEL_API_KEY and the two BLOB_ values
npm run dev                  # http://localhost:3000
```

Batch-test real voice notes without the UI:

```bash
npm run try-note -- path/to/note.ogg          # transcript + extracted facts
node scripts/e2e.mjs path/to/note.ogg photo.jpg   # full golden path in headless Chrome at 360px
```

## Configuration

Environment variables (never commit real values):

- `MODEL_API_KEY` — Meta Model API key from [dev.meta.ai](https://dev.meta.ai)
- `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` — a Vercel Blob store connected to the project

## Limitations (honest)

- One business per run. No login, payments, editing after publish, or theme choice.
- Urdu is out of scope.
- Clarification is a single round by design, to keep the flow short.
- Photo segmentation is best-effort: if SAM finds nothing, the full photo is used.

## License

MIT — see [LICENSE](LICENSE). Hackathon entries also grant the organisers a perpetual, royalty-free license to the submission. Nothing proprietary is included. Fonts (Fraunces, Inter, Noto Sans Devanagari) are used under the SIL Open Font License.
