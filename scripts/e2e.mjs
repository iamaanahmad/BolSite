// Drives the real app in headless Edge/Chrome at a 360px phone viewport through the golden path.
// Usage: npm run dev   (in another terminal), then
//        node scripts/e2e.mjs <voice-note> [photo1 photo2 photo3]
// Screenshots go to samples/e2e/ (gitignored). Answers clarification questions by tapping the first option.

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [audio, ...photos] = process.argv.slice(2);
if (!audio) {
  console.error('Usage: node scripts/e2e.mjs <voice-note> [photos...]');
  process.exit(1);
}
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const browserPath = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const out = path.join('samples', 'e2e');
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, protocolTimeout: 600_000 });
const page = await browser.newPage();
await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('console', (m) => m.type() === 'error' && console.log('  [browser]', m.text()));
const t0 = Date.now();
const log = (msg) => console.log(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s  ${msg}`);
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });

await page.goto(BASE, { waitUntil: 'networkidle0' });
const appWidth = await page.evaluate(() => document.documentElement.scrollWidth);
log(`app loaded, page width ${appWidth}px at 360px viewport`);
await shot('01-start');

await (await page.$('#audio-file')).uploadFile(path.resolve(audio));
if (photos.length) await (await page.$('#photo-file')).uploadFile(...photos.map((p) => path.resolve(p)));
await page.waitForFunction((n) => document.querySelectorAll('#thumbs li').length === n, {}, photos.length);
await shot('02-inputs');
await page.click('#go-btn');
log('pipeline started');

const visible = (sel) => `!document.querySelector('${sel}').hidden`;
async function waitAny() {
  const h = await page.waitForFunction(
    `(${visible('#clarify-card')} && 'clarify') || (${visible('#blocked-card')} && 'blocked') || (!document.querySelector('#publish-btn').disabled && 'ready') || (${visible('#error')} && 'error')`,
    { timeout: 300_000, polling: 500 },
  );
  return h.jsonValue();
}

let s = await waitAny();
if (s === 'clarify') {
  const qs = await page.$$eval('#questions .q legend', (n) => n.map((x) => x.textContent));
  log(`clarification asked: ${qs.join(' | ')}`);
  await shot('03-clarify');
  for (const fs of await page.$$('#questions .q')) {
    const opt = await fs.$('.opt');
    if (opt) await opt.click();
  }
  await page.click('#clarify-form button[type=submit]');
  s = await waitAny();
}
await shot('04-result');
if (s !== 'ready') {
  const msg = await page.$eval(s === 'blocked' ? '#blocked-text' : '#error', (n) => n.textContent);
  log(`stopped: ${s}: ${msg}`);
  const checks = await page.$$eval('#checks li', (n) => n.map((x) => `${x.className}: ${x.textContent}`));
  checks.forEach((c) => log(`  ${c}`));
  await browser.close();
  process.exit(1);
}
const checks = await page.$$eval('#checks li', (n) => n.map((x) => `${x.className.toUpperCase()} ${x.textContent}`));
log('verification:');
checks.forEach((c) => console.log(`         ${c}`));

await page.click('#publish-btn');
await page.waitForFunction(visible('#done-card'), { timeout: 60_000 });
const url = await page.$eval('#live-link', (a) => a.href);
log(`published: ${url}`);
await shot('05-done');

const site = await browser.newPage();
await site.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const res = await site.goto(url, { waitUntil: 'networkidle0' });
const siteWidth = await site.evaluate(() => document.documentElement.scrollWidth);
log(`live site HTTP ${res.status()}, width ${siteWidth}px`);
await site.screenshot({ path: path.join(out, '06-live-site.png'), fullPage: true });
await browser.close();
