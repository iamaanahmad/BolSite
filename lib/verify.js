// Pre-publish verification. Any failed check blocks publishing.
// Server-side checks run against the stored HTML; the 360px layout check is measured by the
// browser rendering the real draft in a 360px-wide frame and reported here.

import { createHash } from 'node:crypto';
import { readBlob, readJsonBlob, blobExists } from './store.js';
import { SLUG_RE } from './generate.js';
import { numbersIn, groundTruthText } from './copy.js';
import { formatPhone } from './template.js';
import { HttpError } from './http.js';

const PLACEHOLDER_RE = /lorem|ipsum|\bTODO\b|\bTBD\b|placeholder|\bx{3,}\b|\{\{|\}\}|\bundefined\b|\bnull\b|\bNaN\b|\[object|example\.(com|org)|your (business|shop|company) name|coming soon/i;
const PHONE_RE = /^\+91[1-9]\d{9}$/;

const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));

export function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

const attrs = (html, name) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => decodeEntities(m[1]));

async function urlResolves(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'BolSite-LinkCheck/1.0' } });
      res.body?.cancel();
      if (res.status < 400) return { ok: true, status: res.status };
      if (i === 1) return { ok: false, status: res.status };
    } catch (err) {
      if (i === 1) return { ok: false, status: err.name };
    }
  }
  return { ok: false };
}

export async function runVerification(slug, layout) {
  if (!SLUG_RE.test(String(slug || ''))) throw new HttpError(400, 'Invalid site id');
  const [meta, htmlBlob] = await Promise.all([readJsonBlob(`sites/${slug}/meta.json`), readBlob(`sites/${slug}/index.html`)]);
  if (!meta || !htmlBlob) throw new HttpError(404, 'Draft not found');
  const html = htmlBlob.buffer.toString('utf8');
  const { final, site } = meta;
  const text = visibleText(html);
  const checks = [];
  const add = (id, label, passed, detail) => checks.push({ id, label, passed, detail });

  // 0. The page we verify is the page we generated.
  add('integrity', 'Page unchanged since generation', createHash('sha256').update(html).digest('hex') === meta.html_sha256, null);

  // 1. Phone format + links
  const phoneOk = PHONE_RE.test(site.phone) && html.includes(`href="tel:${site.phone}"`);
  const waOk = !site.whatsapp || (PHONE_RE.test(site.whatsapp) && html.includes(`https://wa.me/${site.whatsapp.replace(/\D/g, '')}`));
  add('phone', 'Phone number is a valid Indian number', phoneOk && waOk, `${formatPhone(site.phone)}${site.whatsapp ? ' · WhatsApp linked' : ''}`);

  // 2. Price sanity: numeric, in range, shown exactly as spoken
  const priced = final.services.filter((s) => s.price);
  const badPrices = priced.filter((s) => !(s.price_value > 0 && s.price_value <= 1_000_000) || !text.includes(s.price));
  add('prices', 'Prices are numbers and look sane', badPrices.length === 0, badPrices.length ? `Problem: ${badPrices.map((s) => s.name).join(', ')}` : `${priced.length} price${priced.length === 1 ? '' : 's'} checked`);

  // 3. Every link and image resolves
  // Only links a visitor can tap (<a href>); <link rel="canonical"> is metadata, not a link.
  const body = html.slice(html.indexOf('<body'));
  const hrefs = [...body.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
  const srcs = attrs(html, 'src');
  const internal = [...new Set(srcs.filter((s) => s.startsWith(`/${slug}/`)))];
  const external = [...new Set(hrefs.filter((h) => h.startsWith('https://') && !h.startsWith(site.canonicalUrl)))];
  const broken = [];
  await Promise.all([
    ...internal.map(async (s) => { if (!(await blobExists(`sites${s}`))) broken.push(s); }),
    ...external.map(async (u) => { const r = await urlResolves(u); if (!r.ok) broken.push(`${new URL(u).host} (${r.status})`); }),
  ]);
  const badSchemes = hrefs.filter((h) => !/^(https:\/\/|tel:\+91\d{10}$)/.test(h));
  add('links', 'All links and images work', broken.length === 0 && badSchemes.length === 0, broken.length || badSchemes.length ? `Broken: ${[...broken, ...badSchemes].join(', ')}` : `${internal.length + external.length + hrefs.filter((h) => h.startsWith('tel:')).length} checked`);

  // 4. No placeholder text anywhere (visible text and alt text)
  const altText = attrs(html, 'alt').join(' ');
  const ph = (text + ' ' + altText).match(PLACEHOLDER_RE);
  add('placeholders', 'No placeholder text', !ph, ph ? `Found "${ph[0]}"` : null);

  // 5. Grounding: every number on the page comes from the owner
  const allowed = new Set(numbersIn(groundTruthText(final)));
  const scrubbed = [site.phone, site.whatsapp].filter(Boolean).reduce((t, p) => t.split(formatPhone(p)).join(' '), text);
  const stray = [...new Set(numbersIn(scrubbed).filter((n) => !allowed.has(n)))];
  add('grounding', 'Every number on the page was said by the owner', stray.length === 0, stray.length ? `Not from the owner: ${stray.join(', ')}` : null);

  // 6. Required facts visible; AI image labelled
  const required = text.includes(site.name.latin) && text.includes(formatPhone(site.phone));
  const aiOk = !site.hero?.ai || text.includes('AI-generated');
  add('required', 'Name and phone shown; AI image labelled', required && aiOk, site.hero?.ai ? 'Hero is AI-generated and labelled' : null);

  // 7. Real render at 360px (measured in the browser)
  const l = layout || {};
  const layoutOk = l.viewport_width === 360 && Number.isFinite(l.scroll_width) && l.scroll_width <= 360 && Array.isArray(l.overflowing) && l.overflowing.length === 0;
  add('mobile', 'Fits a 360px phone screen', layoutOk, layout ? `Page width ${l.scroll_width}px at ${l.viewport_width}px${l.overflowing?.length ? `; overflowing: ${l.overflowing.slice(0, 3).join(', ')}` : ''}` : 'Not measured');

  return { slug, passed: checks.every((c) => c.passed), checks, meta };
}
