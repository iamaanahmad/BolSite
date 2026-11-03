// Final facts + photos -> stored draft site under sites/<slug>/ (not public until /api/publish).

import { randomBytes, createHash } from 'node:crypto';
import { writeCopy } from './copy.js';
import { museImage, sparkJson, MODELS } from './meta.js';
import { renderSite } from './template.js';
import { writeOnce, blobExists } from './store.js';
import { finalizeFacts } from './clarify.js';
import { HttpError } from './http.js';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{6}$/;
export const FILE_RE = /^(hero\.(jpg|png|webp)|c[1-6]\.jpg)$/;
const MAX_CARDS = 6;
const MAX_IMAGE_BYTES = 1_500_000;

function decodeImage(dataUrl, what) {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, `${what} must be a JPEG, PNG or WebP data URL`);
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(400, `${what} is too large`);
  return { buffer, ext: m[1] === 'jpeg' ? 'jpg' : m[1], type: `image/${m[1]}` };
}

function slugBase(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

async function reserveSlug(base) {
  for (let i = 0; i < 5; i++) {
    const slug = `${base || 'shop'}-${randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(6, '0').slice(0, 6)}`;
    if (SLUG_RE.test(slug) && !(await blobExists(`sites/${slug}/meta.json`))) return slug;
  }
  throw new HttpError(500, 'Could not allocate a site address');
}

const HERO_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    has_text: { type: 'boolean', description: 'true if ANY letters, words, numbers, signs, logos or writing are visible anywhere' },
    has_people: { type: 'boolean' },
  },
  required: ['has_text', 'has_people'],
  additionalProperties: false,
};

/** Muse Image hero for owners with no usable photo. Rejected if Spark sees any text in it (text = invented facts). */
async function generateHero(categoryEn) {
  const prompt = `Realistic phone-camera photograph of the inside of a small, tidy ${categoryEn} shop in India, warm natural light, products neatly arranged. ` +
    'Absolutely no text anywhere: no letters, no numbers, no signboards, no logos, no posters, no calendars, no labels, no packaging with writing. No people.';
  const log = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const img = await museImage(prompt);
    const url = `data:image/${img.format};base64,${img.buffer.toString('base64')}`;
    const { data } = await sparkJson({
      system: 'You inspect an image for a website. Be strict: tiny or blurry writing still counts as text.',
      user: [{ type: 'text', text: 'Does this image contain any text or people?' }, { type: 'image_url', image_url: { url } }],
      schemaName: 'HeroCheck',
      schema: HERO_CHECK_SCHEMA,
      reasoningEffort: 'low',
      maxTokens: 1500,
    });
    log.push({ attempt, ...data });
    if (!data.has_text && !data.has_people) return { image: img, log };
  }
  return { image: null, log };
}

/**
 * body: { result: /api/clarify (or /api/extract) response, hero: {image, alt}|null, cards: [{ image, alt, label, service }] }
 */
export async function generateSite(body, origin) {
  const final = finalizeFacts(body.result);
  if (!final.publishable) throw new HttpError(409, `Cannot build the site yet: ${final.blocked_by.join(', ')} not confirmed`);
  const f = final.facts;

  const heroIn = body.hero?.image ? { ...decodeImage(body.hero.image, 'Hero photo'), alt: String(body.hero.alt || '').slice(0, 140) } : null;
  const cardsIn = (Array.isArray(body.cards) ? body.cards : []).slice(0, MAX_CARDS).map((c, i) => ({
    ...decodeImage(c.image, `Photo card ${i + 1}`),
    alt: String(c.alt || '').slice(0, 140),
    label: c.label ? String(c.label).slice(0, 40) : null,
    service: c.service || null,
  }));

  const [copyOut, heroGen] = await Promise.all([
    writeCopy(final),
    heroIn ? Promise.resolve(null) : generateHero(f.category.value),
  ]);
  const { copy } = copyOut;

  const slug = await reserveSlug(slugBase(copy.name_latin) || slugBase(copy.category.en));
  const base = `sites/${slug}`;
  const canonicalUrl = `${origin}/${slug}`;

  // Hero: owner photo first; Muse Image only when there is none, and only if it passed the no-text check.
  let hero = null;
  const writes = [];
  if (heroIn) {
    hero = { src: `/${slug}/hero.${heroIn.ext}`, ai: false, alt: heroIn.alt || `${copy.name_latin}` };
    writes.push(writeOnce(`${base}/hero.${heroIn.ext}`, heroIn.buffer, heroIn.type));
  } else if (heroGen?.image) {
    const ext = heroGen.image.format === 'png' ? 'png' : 'webp';
    hero = { src: `/${slug}/hero.${ext}`, ai: true, alt: `AI-generated illustration of a ${copy.category.en} shop` };
    writes.push(writeOnce(`${base}/hero.${ext}`, heroGen.image.buffer, `image/${ext}`));
  }

  const serviceIndex = new Map(final.services.map((s, i) => [s.name, i]));
  const svcName = (i) => ({ en: copy.services[i]?.en || final.services[i].name, hi: copy.services[i]?.hi || final.services[i].name });

  const cards = cardsIn.map((c, i) => {
    const name = `c${i + 1}.jpg`;
    writes.push(writeOnce(`${base}/${name}`, c.buffer, c.type));
    const si = c.service !== null && serviceIndex.has(c.service) ? serviceIndex.get(c.service) : null;
    return {
      src: `/${slug}/${name}`,
      alt: c.alt || c.label || copy.category.en,
      label: si !== null ? svcName(si) : c.label ? { en: c.label, hi: '' } : null,
      price: si !== null ? final.services[si].price : null,
    };
  });

  const address = f.address.status === 'accepted' ? copy.address || { en: f.address.value, hi: f.address.value } : null;
  const site = {
    slug,
    name: { latin: copy.name_latin || f.business_name.value, native: copy.name_devanagari },
    category: copy.category,
    tagline: copy.tagline,
    about: copy.about,
    phone: f.phone.value,
    whatsapp: f.whatsapp.status === 'accepted' ? f.whatsapp.value : null,
    address,
    mapsUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${f.business_name.value}, ${f.address.value}`)}` : null,
    hours: f.hours.status === 'accepted' ? copy.hours || { en: f.hours.value, hi: f.hours.value } : null,
    services: final.services.map((s, i) => ({ name: svcName(i), price: s.price })),
    highlights: final.highlights.map((h, i) => copy.highlights[i] || { en: h.text, hi: '' }),
    hero,
    cards,
    canonicalUrl,
  };

  const html = renderSite(site);
  writes.push(writeOnce(`${base}/index.html`, html, 'text/html; charset=utf-8'));
  await Promise.all(writes);

  const meta = {
    slug,
    created_at: new Date().toISOString(),
    html_sha256: createHash('sha256').update(html).digest('hex'),
    final,
    site,
    copy_grounding: { grounded: copyOut.grounded, attempts: copyOut.attempts, violations: copyOut.violations },
    hero_source: hero ? (hero.ai ? 'muse_image' : 'owner_photo') : 'none',
    hero_checks: heroGen?.log || null,
    models: [MODELS.spark, ...(hero?.ai ? [MODELS.image] : [])],
  };
  // meta.json last: its existence marks a complete draft.
  await writeOnce(`${base}/meta.json`, JSON.stringify(meta), 'application/json');

  return {
    slug,
    preview_url: `/${slug}?preview=1`,
    url: canonicalUrl,
    hero_source: meta.hero_source,
    hero_checks: meta.hero_checks,
    copy_grounding: meta.copy_grounding,
  };
}
