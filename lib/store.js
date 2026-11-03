// Vercel Blob (private store) as the only persistence. Every site lives under sites/<slug>/.
// Files are written once and never overwritten, which also means no stale-cache surprises.

import { put, get, head } from '@vercel/blob';

const ACCESS = 'private';

export async function writeOnce(pathname, body, contentType) {
  return put(pathname, body, { access: ACCESS, contentType, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
}

/** Returns { buffer, contentType } or null if the blob does not exist. */
export async function readBlob(pathname) {
  let res;
  try {
    res = await get(pathname, { access: ACCESS });
  } catch (err) {
    if (err?.constructor?.name === 'BlobNotFoundError') return null;
    throw err;
  }
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const buffer = Buffer.from(await new Response(res.stream).arrayBuffer());
  return { buffer, contentType: res.blob?.contentType || res.headers?.get?.('content-type') || 'application/octet-stream' };
}

export async function readJsonBlob(pathname) {
  const b = await readBlob(pathname);
  return b ? JSON.parse(b.buffer.toString('utf8')) : null;
}

export async function blobExists(pathname) {
  try {
    await head(pathname);
    return true;
  } catch (err) {
    if (err?.constructor?.name === 'BlobNotFoundError') return false;
    throw err;
  }
}
