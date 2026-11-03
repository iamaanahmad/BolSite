# BolSite — Product Requirements Document

**One-liner:** A small-business owner records a 60-second voice note (Hindi / English / Hinglish) and uploads up to 3 phone photos → gets a live, mobile-ready website.

**Deadline:** Tue Nov 4, 9:00 PM ET = **Wed Nov 5, 7:30 AM IST**. Submit by Nov 4 evening IST for safety.
**Track:** Indie. **Theme:** Build for Your World.
**Rubric:** Impact 30% · Creative use of Meta's AI tools 25% · Demo incl. video 25% · Technical depth 20%.
**Status labels in this doc:** ✅ verified · ⚠️ verify in console before building · ❌ out of scope.

---

## 1. Problem & user

Millions of small businesses (kirana stores, tailors, repair shops, clinics) have no website. Owners are non-technical, often more comfortable speaking than typing. Existing site builders assume English typing + design skill. BolSite removes both barriers: speak, snap photos, get a site.

## 2. Golden path (the only flow that must work perfectly)

1. Owner opens the public demo page on their phone.
2. Taps "record", speaks for up to 60 seconds (Hindi / English / Hinglish).
3. Uploads 1–3 photos (shop front, products, owner — messy is fine).
4. App transcribes → extracts structured business facts, each with a confidence score.
5. Any fact below threshold → one short clarification question (tap-to-answer), never invented.
6. App generates a mobile-first one-page site: name, category, hours, phone/WhatsApp, address, services/products with prices, photo cards.
7. Verification pass runs (phone format, price sanity, link checks, mobile viewport).
8. Site deploys to a public URL. Owner gets the link. Done.

## 3. Scope — IN vs OUT (2-day guards)

**IN:** one business at a time · one mobile-first template · max 3 photos · voice notes up to 60s · Hindi/English/Hinglish · confidence-gated extraction · verification pass · Vercel deploy · public demo link · 2-min demo video.

**OUT:** ❌ Urdu (unless Day 1 testing proves it — keep out of scope) · ❌ payments · ❌ login/accounts · ❌ multi-template/theme picker · ❌ editing after publish · ❌ partner integrations (optional per brief — do not depend on them).

## 4. Functional requirements

- **FR-1** Record voice note in-browser (MediaRecorder), max 60s, with visible timer and re-record.
- **FR-2** Upload 1–3 photos (JPEG/PNG, phone camera). Photos are optional but recommended.
- **FR-3** Transcribe audio to text, preserving Hindi/Hinglish code-switching.
- **FR-4** Extract the business-fact schema (§5) from the transcript via structured output. Every fact carries `confidence` 0–1 and `source` ("transcript" or "clarification").
- **FR-5** Confidence gate: any required fact < 0.75 triggers at most one clarification question per fact, phrased simply, tap-to-answer where possible. Facts still < 0.75 after clarification are **omitted from the site** (never guessed).
- **FR-6** Segment product/object regions from photos (SAM) for catalog cards; fall back to full photo if segmentation fails.
- **FR-7** Generate hero image with Muse Image **only if no usable photo exists**; the hero must carry a visible "AI-generated" label.
- **FR-8** Render a mobile-first one-page site (single template): header, about, services/products + prices, hours, contact (tel:/WhatsApp links), map link if address verified, photo cards, footer.
- **FR-9** Verification pass before deploy: phone number format valid; prices numeric and sane; all links resolve; page renders at 360px width with no overlap; no placeholder text anywhere.
- **FR-10** Deploy to a public URL (Vercel). Each run gets a unique URL.
- **FR-11** Hard honesty rule: **zero invented facts.** If it's not in the transcript, a photo, or a clarification answer, it doesn't go on the site.

## 5. Extraction schema (the JSON contract)

```json
{
  "business_name": {"value": "string", "confidence": 0.0-1.0, "source": "transcript|clarification"},
  "category": {"value": "string", "confidence": 0.0-1.0, "source": "transcript|clarification"},
  "phone": {"value": "string", "confidence": 0.0-1.0, "source": "transcript|clarification"},
  "address": {"value": "string|null", "confidence": 0.0-1.0, "source": "transcript|clarification"},
  "hours": {"value": "string|null", "confidence": 0.0-1.0, "source": "transcript|clarification"},
  "services": [{"name": "string", "price": "string|null", "confidence": 0.0-1.0}],
  "language_detected": "hi|en|hinglish"
}
```

Required to publish: `business_name`, `category`, `phone` (all ≥ 0.75). Everything else is optional and omitted if weak.

## 6. APIs & integrations

Do the **pre-build checks** (§9) first. Anything marked ⚠️ must be confirmed in your dev console / invite email before you depend on it. Never enter card details on the basis of an unverified claim.

| # | Capability | Model / endpoint (as reported) | Access | Status | Fallback |
|---|-----------|-------------------------------|--------|--------|----------|
| 1 | LLM: extraction, clarification Qs, site copy | Muse Spark (`muse-spark-1.3` reported; 1.1 in public docs) | dev.meta.ai console → API key (`LLM\|<app-id>\|<secret>`). Base URL reported as `https://api.ai.meta.com/v1` (GitHub/OSWorld) and `https://api.meta.ai/v1` (other secondary sources) — confirm in the official quickstart: dev.meta.ai/docs/getting-started/cookbook/quickstart-chat-completions. OpenAI-compatible dialect (uses `max_completion_tokens`, not `max_tokens`). | ⚠️ confirm base URL + model name in console | Any OpenAI-compatible LLM for the spike; swap to Spark before submission (25% of score is Meta-tool usage) |
| 2 | Speech-to-text | `muse-voice-transcribe-1.0` (name from secondary sources only) | Same console / key as above | ⚠️ confirm the model exists in your console | Local `faster-whisper` for Day 1 spike; swap before submission |
| 3 | Photo segmentation | SAM 3.1 (`sam-3.1`) | Same console / key; reported limit 3,000 req/min | ⚠️ confirm in console | Skip segmentation — use full photos in cards |
| 4 | Hero image (only when no photo) | Muse Image (`muse-image-1.0` reported; 150 req/min reported) | Same console / key | ⚠️ confirm in console; check availability in India | Omit hero, lead with uploaded photo |
| 5 | Credits | $150 Meta Model API credits per accepted applicant (reported) | Check balance in dev console | ⚠️ verify balance; valid for the build window only | Pay-as-you-go rates are low (Spark ~$1.25/$4.25 per M tokens); a full demo run costs cents |
| 6 | Deploy | Vercel | Your existing account | ✅ verified (your standard tooling) | — |

Notes:
- Rate limits are generous for a demo (Spark: 3,000 req + 4M tokens/min reported). You will not hit them.
- India is not on the Model API geo-block list. One secondary source notes Muse Image is blocked in one additional unnamed country — confirm it works from India during pre-checks.
- One guide also names "Muse Wonder" as a hackathon model. Optional — you don't need it.

## 7. Architecture (keep it boring)

```
browser (record + upload)
   → API route /api/transcribe   (audio → text)
   → API route /api/extract      (text → JSON schema + confidence, Muse Spark)
   → API route /api/clarify      (low-confidence Q&A loop, max 1 round per fact)
   → API route /api/segment      (photos → product crops, SAM 3.1; fallback: raw photos)
   → API route /api/generate     (JSON → static HTML, one template; hero via Muse Image only if needed)
   → API route /api/verify       (phone/price/link/mobile checks; fail = show what's wrong, don't publish)
   → Vercel deploy → public URL
```

Stateless pipeline, one business per run, no database. Repo layout: `app/` (frontend) · `pipeline/` (the six routes) · `templates/` (the one template) · `demo/` (sample voice note + photos + expected output for the video).

## 8. Demo video — 2-minute shot list

1. (0:00–0:15) The problem: a real shop with no website. Owner speaks.
2. (0:15–0:45) Record the 60s voice note + upload 3 messy photos, live.
3. (0:45–1:15) Extraction with confidence scores on screen; one clarification question asked and answered; weak fact honestly omitted.
4. (1:15–1:45) Site generates, verification pass ticks, deploys → public URL opens on a phone.
5. (1:45–2:00) The stack: transcription → Spark extraction → SAM 3.1 → Muse Image (labelled) → verified deploy. One honest line: what it can't do yet.

No mockups. Every pixel on screen must be the real app running.

## 9. Pre-build checks (30 min, do FIRST)

1. Log in at dev.meta.ai, confirm your API key and $150 credit balance.
2. Run one test call against Muse Spark; confirm the exact base URL and model name.
3. Confirm the voice-transcribe model, SAM 3.1, and Muse Image are listed/available for your key from India.
4. If anything in 2–3 is missing: start the spike on fallbacks (§6) immediately and re-check at end of Day 1. Do not burn hours waiting.

## 10. 2-day build plan

**Today, Nov 2 — make-or-break spike.** Pre-checks (§9) → working transcribe → extract with confidence gating on 2–3 real Hindi/Hinglish voice notes (record your own). Kill criterion: if extraction quality is poor by evening, pivot to the FarmPulse backup — decide tonight, not tomorrow.

**Nov 3 — full pipeline.** SAM segmentation → site template → verification pass → Vercel deploy → public link. End of day: a stranger can run the golden path on their phone.

**Nov 4 — polish + submit.** Morning: fix what broke. Afternoon: record the 2-min video (§8), write README, make repo public. Evening: submit (deadline is 7:30 AM IST Nov 5 — submit Nov 4 night IST, keep the buffer).

## 11. Submission checklist

- [ ] Public GitHub repo (open, reproducible — the house style of every Meta hackathon recap)
- [ ] README: problem, demo link, architecture, honest limitations
- [ ] Live public URL (try-it link doubles as judging evidence + viral surface for bonus prizes)
- [ ] 2-minute demo video (real run, §8)
- [ ] Project description per the submission form
- [ ] Licence awareness: entrants grant organisers a perpetual, royalty-free licence to submissions — nothing proprietary goes in

## 12. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Voice-transcribe model unavailable | faster-whisper fallback for the spike; re-check console end of Day 1 |
| Hinglish extraction is weak | Few-shot prompt with 2–3 real examples; clarification loop catches the rest; pivot to FarmPulse tonight if hopeless |
| SAM 3.1 slow/unavailable | Fallback to raw photos (FR-6) — segmentation is garnish, not the meal |
| Running out of time | Cut in this order: hero image → photo segmentation → clarification UI polish. Never cut: golden path, honesty gate, video |
| Invented facts on the site | FR-11 + verification pass; Cue's grounding-eval offer can review the prompt |


---

*PRD written 2026-11-02 for the Meta Global AI Developer Hackathon 2026 Indie track. Stack details marked ⚠️ come from secondary sources — the dev console is the authority.*