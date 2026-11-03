// POST /api/extract
// Body: { "transcript": "..." }
// Returns gated facts: { language_detected, facts, services, highlights, clarifications, omitted, publishable, ... }

import { postRoute, HttpError } from '../lib/http.js';
import { extractFacts } from '../lib/extract.js';

export default postRoute(async (body) => {
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) throw new HttpError(400, 'transcript is required');
  if (transcript.length > 8000) throw new HttpError(400, 'transcript is too long for a 60-second note');
  return extractFacts(transcript);
}, { rateLimit: true });
