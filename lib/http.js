// Helpers that work identically on Vercel Node functions and the local dev server.

const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel's request body cap is 4.5 MB

export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
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

export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

/** Wraps a handler(body) => result with method check, JSON parsing and error mapping. */
export function postRoute(fn) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Use POST' });
    }
    try {
      const body = await readJson(req);
      const result = await fn(body, req);
      return sendJson(res, 200, result);
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) console.error(err);
      return sendJson(res, status, { error: err.message || 'Internal error', type: err.type, details: err.details });
    }
  };
}

/** Public origin of the current request, e.g. https://bolsite.vercel.app or http://localhost:3000 */
export function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host?.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
