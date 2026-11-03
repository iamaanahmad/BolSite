// POST /api/verify
// Body: { "slug": "...", "layout": { "viewport_width": 360, "scroll_width": n, "overflowing": [] } }
// Returns: { passed, checks: [{ id, label, passed, detail }] }

import { postRoute } from '../lib/http.js';
import { runVerification } from '../lib/verify.js';

export default postRoute(async (body) => {
  const { slug, passed, checks } = await runVerification(body.slug, body.layout);
  return { slug, passed, checks };
});
