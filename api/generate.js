// POST /api/generate
// Body: { "result": <final facts from /api/clarify or /api/extract>, "hero": { "image": dataUrl, "alt" } | null,
//         "cards": [{ "image": dataUrl, "alt", "label", "service" }] }
// Returns: { slug, preview_url, url, hero_source, copy_grounding }. The site is a draft until /api/publish.

import { postRoute, HttpError, originOf } from '../lib/http.js';
import { generateSite } from '../lib/generate.js';

export default postRoute(async (body, req) => {
  if (!body.result || typeof body.result.facts !== 'object') throw new HttpError(400, 'result is required');
  return generateSite(body, originOf(req));
}, { rateLimit: true, countsForClient: false });
