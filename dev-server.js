// Local dev server: serves public/ and runs api/*.js with the same handlers Vercel uses.
// Run: npm run dev   (reads MODEL_API_KEY from .env.local)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// Same rewrites as vercel.json
const SITE_FILE = /^\/([a-z0-9-]+-[a-z0-9]{6})\/(hero\.(?:jpg|png|webp)|c[1-6]\.jpg)$/;
const SITE_PAGE = /^\/([a-z0-9-]+-[a-z0-9]{6})$/;

const server = http.createServer(async (req, res) => {
  let url = new URL(req.url, `http://${req.headers.host}`);
  const fileMatch = url.pathname.match(SITE_FILE);
  const pageMatch = url.pathname.match(SITE_PAGE);
  if (fileMatch || pageMatch) {
    const q = new URLSearchParams(url.search);
    q.set('slug', (fileMatch || pageMatch)[1]);
    if (fileMatch) q.set('file', fileMatch[2]);
    req.url = `/api/site?${q}`;
    url = new URL(req.url, `http://${req.headers.host}`);
  }

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
    const file = path.join(root, 'api', `${name}.js`);
    if (!name || !existsSync(file)) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    const started = Date.now();
    const mod = await import(pathToFileURL(file).href);
    await mod.default(req, res);
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - started} ms)`);
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir) || !existsSync(file)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(await readFile(file));
});

server.listen(PORT, () => {
  console.log(`BolSite dev server on http://localhost:${PORT}`);
  if (!process.env.MODEL_API_KEY) console.warn('WARNING: MODEL_API_KEY is not set. Create .env.local from .env.example.');
});
