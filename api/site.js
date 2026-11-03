// GET /<slug>            -> published site (or draft with ?preview=1)
// GET /<slug>/<file>     -> site asset (hero / card image)
// Mapped by rewrites in vercel.json (and the same rules in dev-server.js).

import { SLUG_RE, FILE_RE } from '../lib/generate.js';
import { readBlob, blobExists } from '../lib/store.js';

// Generated sites carry no scripts at all; framing allowed only by BolSite itself (the 360px preview).
const SITE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('This BolSite page does not exist.');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end();
  }
  const url = new URL(req.url, 'http://local');
  const slug = url.searchParams.get('slug') || '';
  const file = url.searchParams.get('file');
  if (!SLUG_RE.test(slug) || (file !== null && !FILE_RE.test(file))) return notFound(res);

  try {
    if (file) {
      const blob = await readBlob(`sites/${slug}/${file}`);
      if (!blob) return notFound(res);
      res.setHeader('Content-Type', blob.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // assets are write-once
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(req.method === 'HEAD' ? undefined : blob.buffer);
    }

    const preview = url.searchParams.get('preview') === '1';
    const published = await blobExists(`sites/${slug}/published.json`);
    if (!published && !preview) return notFound(res);
    const blob = await readBlob(`sites/${slug}/index.html`);
    if (!blob) return notFound(res);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', SITE_CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (published && !preview) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
    } else {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
    }
    return res.end(req.method === 'HEAD' ? undefined : blob.buffer);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('Cache-Control', 'no-store');
    return res.end('Something went wrong loading this page.');
  }
}
