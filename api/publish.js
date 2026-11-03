// POST /api/publish
// Body: same as /api/verify. Re-runs every check server-side; only a full pass makes the site public.
// Returns: { url, checks } or 422 with the failed checks.

import { postRoute } from '../lib/http.js';
import { runVerification } from '../lib/verify.js';
import { writeOnce, readJsonBlob } from '../lib/store.js';

export default postRoute(async (body) => {
  const { slug, passed, checks, meta } = await runVerification(body.slug, body.layout);
  if (!passed) {
    const err = new Error(`Verification failed: ${checks.filter((c) => !c.passed).map((c) => c.label).join('; ')}`);
    err.status = 422;
    err.type = 'verification_failed';
    err.details = { checks };
    throw err;
  }
  const marker = `sites/${slug}/published.json`;
  const existing = await readJsonBlob(marker);
  if (!existing) await writeOnce(marker, JSON.stringify({ published_at: new Date().toISOString(), checks }), 'application/json');
  return { url: meta.site.canonicalUrl, slug, checks, already_published: Boolean(existing) };
}, { rateLimit: true });
