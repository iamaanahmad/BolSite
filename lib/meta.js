// Thin client for Meta Model API.
// Verified against official docs (dev.meta.ai/docs), 2026-11-02:
//   base URL       https://api.meta.ai/v1
//   chat           POST /chat/completions   model muse-spark-1.3  (OpenAI-compatible, max_completion_tokens)
//   transcription  POST /asr/transcribe     model muse-voice-transcribe-1.0  (multipart: request JSON + WAV audio)

export const META_BASE_URL = 'https://api.meta.ai/v1';
//   segmentation   POST /responses          model sam-3.1  (concept prompt + image, special-token box/mask output)
//   image gen      POST /images/generations model muse-image-1.0  (returns b64 webp)
export const MODELS = {
  spark: 'muse-spark-1.3',
  transcribe: 'muse-voice-transcribe-1.0',
  sam: 'sam-3.1',
  image: 'muse-image-1.0',
};

export class MetaApiError extends Error {
  constructor(message, { status, type, sessionId } = {}) {
    super(message);
    this.name = 'MetaApiError';
    this.status = status;
    this.type = type;
    this.sessionId = sessionId;
  }
}

function apiKey() {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new MetaApiError('MODEL_API_KEY is not set on the server', { status: 500, type: 'config' });
  return key;
}

async function parseError(res) {
  let message = `Meta API HTTP ${res.status}`;
  let type;
  try {
    const body = await res.json();
    const err = body.error || body;
    if (err.message) message = `${message}: ${err.message}`;
    type = err.type || err.errorType;
  } catch {
    // body was not JSON; keep the status-only message
  }
  return new MetaApiError(message, { status: res.status, type });
}

/**
 * Muse Spark chat completion with a JSON-schema-constrained response.
 * `user` may be a string or an array of OpenAI-style content parts (text + image_url) for vision.
 * Returns { data, usage, model }.
 */
export async function sparkJson({ system, user, schemaName, schema, reasoningEffort = 'medium', maxTokens = 8000, timeoutMs = 90_000 }) {
  const res = await fetch(`${META_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELS.spark,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      reasoning_effort: reasoningEffort,
      max_completion_tokens: maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, schema },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await parseError(res);

  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new MetaApiError('Muse Spark returned an empty response', { status: 502, type: 'empty_response' });
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new MetaApiError('Muse Spark returned invalid JSON', { status: 502, type: 'invalid_json' });
  }
  return { data, usage: body.usage, model: body.model || MODELS.spark };
}

/**
 * Muse Voice Transcribe, one-shot file endpoint.
 * wav: Buffer holding a RIFF/WAVE mono 16-bit PCM file at 16 kHz or 24 kHz.
 */
export async function transcribeWav(wav, { languageBias = ['Hindi', 'English'], keywords = [], timeoutMs = 120_000 } = {}) {
  const request = {
    model: MODELS.transcribe,
    audioEncoding: 'WAV',
    mode: 'PUSH_TO_TALK',
    languageBias,
  };
  if (keywords.length) request.keywords = keywords;

  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'note.wav');

  const res = await fetch(`${META_BASE_URL}/asr/transcribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
    },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await parseError(res);

  const body = await res.json();
  return {
    transcript: (body.transcript || '').trim(),
    durationMs: body.audioDurationMs,
    sessionId: body.sessionId,
    model: MODELS.transcribe,
  };
}

/**
 * SAM 3.1 concept segmentation on one image.
 * Returns boxes sorted by confidence: [{ x1, y1, x2, y2, w, h, confidence }]. Zero matches is a valid empty result.
 */
export async function samSegment(imageDataUrl, concept, { timeoutMs = 60_000 } = {}) {
  const res = await fetch(`${META_BASE_URL}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.sam,
      metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: concept },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await parseError(res);
  const body = await res.json();
  const text = (body.output || [])
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('\n');
  return parseSamBoxes(text);
}

const BOX_RE = /<\|box;([^|]*)\|>/g;

export function parseSamBoxes(text) {
  const boxes = [];
  for (const m of text.matchAll(BOX_RE)) {
    const kv = Object.fromEntries(m[1].split(';').map((p) => p.split('=')));
    const box = {
      x1: Number(kv.x1), y1: Number(kv.y1), x2: Number(kv.x2), y2: Number(kv.y2),
      w: Number(kv.w), h: Number(kv.h),
      confidence: kv.c !== undefined ? Number(kv.c) : null,
    };
    if ([box.x1, box.y1, box.x2, box.y2, box.w, box.h].every(Number.isFinite)) boxes.push(box);
  }
  return boxes.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

/** Muse Image text-to-image. Returns { buffer, format } (format is e.g. "webp"). */
export async function museImage(prompt, { size = '1024x768', timeoutMs = 90_000 } = {}) {
  const res = await fetch(`${META_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.image, prompt, n: 1, size }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await parseError(res);
  const body = await res.json();
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new MetaApiError('Muse Image returned no image', { status: 502, type: 'empty_response' });
  return { buffer: Buffer.from(b64, 'base64'), format: body.output_format || 'webp' };
}
