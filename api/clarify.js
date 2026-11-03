// POST /api/clarify
// Body: { "result": <the /api/extract response>, "answers": [{ "field", "via": "option"|"text"|"skip", "answer" }] }
// Returns the final fact set: every fact accepted or omitted, plus publishable / blocked_by.

import { postRoute, HttpError } from '../lib/http.js';
import { applyClarifications } from '../lib/clarify.js';

export default postRoute(async (body) => {
  if (!body.result || typeof body.result.facts !== 'object') throw new HttpError(400, 'result (the /api/extract response) is required');
  if (!Array.isArray(body.answers)) throw new HttpError(400, 'answers must be an array');
  return applyClarifications(body.result, body.answers);
});
