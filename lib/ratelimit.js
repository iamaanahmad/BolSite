// Rate limiting with a credit backstop.
//
// Primary store: Upstash Redis (atomic INCR + EXPIRE), used when UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN are set. This is the only store that holds across Vercel's
// stateless function instances.
//
// Fallback: a best-effort in-memory counter per instance. It cannot stop a determined
// attacker across many cold starts, but it keeps local dev working and degrades safely
// instead of throwing. A warning is logged once so the gap is visible.
//
// Two limits per expensive request:
//   - per client (IP + rough UA): a sliding-ish fixed window
//   - global per day: a hard cap on total expensive calls, to protect Meta credits

import { Redis } from '@upstash/redis';

let redis = null;
let warned = false;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}

// In-memory fallback state (per instance).
const mem = new Map(); // key -> { count, resetAt }

function memIncr(key, windowSec, limit) {
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.resetAt <= now) {
    const resetAt = now + windowSec * 1000;
    mem.set(key, { count: 1, resetAt });
    if (mem.size > 5000) for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
    return { count: 1, resetAt, limited: 1 > limit };
  }
  e.count += 1;
  return { count: e.count, resetAt: e.resetAt, limited: e.count > limit };
}

async function incr(key, windowSec, limit) {
  if (!redis) {
    if (!warned) { console.warn('Rate limit: no Upstash Redis configured; using per-instance in-memory fallback (not durable).'); warned = true; }
    return memIncr(key, windowSec, limit);
  }
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    const ttl = await redis.ttl(key);
    return { count, resetAt: Date.now() + (ttl > 0 ? ttl : windowSec) * 1000, limited: count > limit };
  } catch (err) {
    // Never let a limiter outage take down the app; fall back and keep serving.
    console.error('Rate limit store error, falling back to memory:', err.message);
    return memIncr(key, windowSec, limit);
  }
}

/** Derive a stable-ish client id. Vercel sets x-forwarded-for; the first hop is the client. */
export function clientId(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  const ua = (req.headers['user-agent'] || '').slice(0, 40);
  // Hash to keep keys short and avoid storing raw IPs in the store.
  let h = 2166136261;
  for (const ch of `${ip}|${ua}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const DAY = 86_400;
const DEFAULTS = {
  perClient: { limit: Number(process.env.RL_CLIENT_LIMIT) || 8, windowSec: Number(process.env.RL_CLIENT_WINDOW) || 3600 },
  global: { limit: Number(process.env.RL_GLOBAL_DAILY) || 400, windowSec: DAY },
};

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Enforces per-client and global limits for one expensive request.
 * Throws HttpError(429) when exceeded. Returns headers to attach on success.
 */
export async function enforceRateLimit(req, { cost = 1 } = {}) {
  const id = clientId(req);
  const client = await incr(`rl:c:${id}`, DEFAULTS.perClient.windowSec, DEFAULTS.perClient.limit);
  if (client.limited) {
    throw rateLimited('You have made too many websites in a short time. Please try again later.', client.resetAt);
  }
  const global = await incr(`rl:g:${utcDay()}`, DEFAULTS.global.windowSec, DEFAULTS.global.limit);
  if (global.limited) {
    throw rateLimited('BolSite has hit its daily limit for the demo. Please try again tomorrow.', global.resetAt);
  }
  return {
    'X-RateLimit-Limit': String(DEFAULTS.perClient.limit),
    'X-RateLimit-Remaining': String(Math.max(0, DEFAULTS.perClient.limit - client.count)),
    'X-RateLimit-Reset': String(Math.ceil(client.resetAt / 1000)),
  };
}

function rateLimited(message, resetAt) {
  const err = new Error(message);
  err.status = 429;
  err.type = 'rate_limited';
  err.retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return err;
}
