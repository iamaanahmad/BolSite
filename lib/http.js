// Helpers that work identically on Vercel Node functions and the local dev server.

import { enforceRateLimit } from './ratelimit.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel's request body cap is 4.5 MB

export async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) throw new HttpError(400, 'Request body is empty');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Security headers applied to every API response. The app shell (public/) gets its
// headers from vercel.json; these cover the function responses.
export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
}

export function sendJson(res, status, obj, extraHeaders) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

/**
 * Wraps a handler(body, req) => result with method check, JSON parsing, rate limiting,
 * security headers and error mapping.
 * options: { rateLimit?: boolean, maxBytes?: number }
 */
export function postRoute(fn, options = {}) {
  return async function handler(req, res) {
    setSecurityHeaders(res);

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST' });
    }
    // Require a JSON content type: blocks trivial cross-site form posts and most dumb bots.
    const ctype = (req.headers['content-type'] || '').toLowerCase();
    if (!ctype.includes('application/json')) {
      return sendJson(res, 415, { error: 'Content-Type must be application/json' });
    }

    try {
      let rlHeaders;
      if (options.rateLimit) rlHeaders = await enforceRateLimit(req);
      const body = await readJson(req, options.maxBytes);
      const result = await fn(body, req);
      return sendJson(res, 200, result, rlHeaders);
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error(err);
      const headers = err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : undefined;
      return sendJson(res, status, { error: err.message || 'Internal error', type: err.type, details: err.details }, headers);
    }
  };
}

/** Public origin of the current request, e.g. https://bolsite.vercel.app or http://localhost:3000 */
export function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host?.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
