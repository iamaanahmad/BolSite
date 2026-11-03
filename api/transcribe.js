// POST /api/transcribe
// Body: { "audio_wav_base64": "<base64 of a mono 16-bit 16/24 kHz WAV>" }
// Returns: { transcript, duration_sec, session_id, model }

import { postRoute, HttpError } from '../lib/http.js';
import { inspectWav } from '../lib/wav.js';
import { transcribeWav } from '../lib/meta.js';

const MAX_SECONDS = 65; // 60 s product limit plus a little slack for stop-button latency

export default postRoute(async (body) => {
  if (typeof body.audio_wav_base64 !== 'string' || !body.audio_wav_base64) {
    throw new HttpError(400, 'audio_wav_base64 is required');
  }
  const wav = Buffer.from(body.audio_wav_base64, 'base64');
  const info = inspectWav(wav);
  if (!info.ok) throw new HttpError(400, info.reason);
  if (info.durationSec > MAX_SECONDS) throw new HttpError(400, `Voice note is ${Math.round(info.durationSec)}s; the limit is 60s`);
  if (info.durationSec < 1) throw new HttpError(400, 'Voice note is too short');

  const result = await transcribeWav(wav);
  if (!result.transcript) throw new HttpError(422, 'No speech was detected in the recording');

  return {
    transcript: result.transcript,
    duration_sec: Math.round(info.durationSec * 10) / 10,
    session_id: result.sessionId,
    model: result.model,
  };
});
