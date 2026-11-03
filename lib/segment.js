// Photos -> roles, hero choice and product crops.
// Muse Spark (vision) looks at the photos and decides WHAT to segment, phrased as SAM-friendly
// noun phrases tied to the services the owner spoke about. SAM 3.1 then finds WHERE.
// Fallback per photo: no SAM match -> the full photo is used as the card.

import { sparkJson, samSegment, MODELS } from './meta.js';
import { HttpError } from './http.js';

export const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 1_500_000;
const SAM_MIN_CONFIDENCE = 0.5;
const PAD = 0.08;

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          role: { type: 'string', enum: ['shopfront', 'products', 'interior', 'owner', 'other'] },
          usable: { type: 'boolean', description: 'false if very blurry, very dark, or not related to the business' },
          alt: { type: 'string', description: 'Plain factual description of what is visible, max 12 words, English.' },
          sign_text: { type: ['string', 'null'], description: 'The business name exactly as written on a visible signboard, in its original script. null if no signboard is readable.' },
          objects: {
            type: 'array',
            maxItems: 2,
            items: {
              type: 'object',
              properties: {
                concept: { type: 'string', description: '1-3 word noun phrase naming one concrete visible object type, e.g. "folded fabric", "sewing machine", "mobile phone".' },
                label: { type: 'string', description: 'Short display label for the object, English, max 4 words.' },
                service: { type: ['string', 'null'], description: 'Exact name from the provided services list ONLY if this object is clearly that exact product or the direct result of that service. Raw material, tools, or related items do not count. Otherwise null.' },
              },
              required: ['concept', 'label', 'service'],
              additionalProperties: false,
            },
          },
        },
        required: ['index', 'role', 'usable', 'alt', 'sign_text', 'objects'],
        additionalProperties: false,
      },
    },
  },
  required: ['photos'],
  additionalProperties: false,
};

const VISION_PROMPT = `You look at photos a small-business owner uploaded for their website.
For each photo (index starts at 0): classify its role, judge if it is usable, write a factual alt text,
read the business name off a signboard only if it is clearly legible, and pick up to 2 sellable objects worth a product card.
Prefer objects that match the owner's spoken services. A wrong service link would put a price on the wrong photo, so when unsure set service to null. "concept" must be a short concrete noun phrase for an object detector,
not a sentence and not a list. Describe only what is visible. Do not guess brands, prices, or anything not visible.`;

function checkDataUrl(d, i) {
  const m = typeof d === 'string' && d.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, `Photo ${i + 1} must be a JPEG, PNG or WebP data URL`);
  if ((m[2].length * 3) / 4 > MAX_PHOTO_BYTES) throw new HttpError(400, `Photo ${i + 1} is too large`);
}

function padBox(b) {
  const pw = (b.x2 - b.x1) * PAD;
  const ph = (b.y2 - b.y1) * PAD;
  return {
    x1: Math.max(0, Math.round(b.x1 - pw)), y1: Math.max(0, Math.round(b.y1 - ph)),
    x2: Math.min(b.w, Math.round(b.x2 + pw)), y2: Math.min(b.h, Math.round(b.y2 + ph)),
    w: b.w, h: b.h,
  };
}

/** Picks the best SAM box that is a sensible card: confident, not a sliver, not the whole frame. */
export function pickBox(boxes) {
  for (const b of boxes) {
    if ((b.confidence ?? 0) < SAM_MIN_CONFIDENCE) continue;
    const area = ((b.x2 - b.x1) * (b.y2 - b.y1)) / (b.w * b.h);
    const aspect = (b.x2 - b.x1) / Math.max(1, b.y2 - b.y1);
    if (area < 0.04 || area > 0.9 || aspect < 0.25 || aspect > 4) continue;
    return { ...padBox(b), confidence: Math.round(b.confidence * 100) / 100 };
  }
  return null;
}

export async function segmentPhotos(photos, services = []) {
  if (!Array.isArray(photos) || photos.length === 0) return { photos: [], crops: [], hero_photo_index: null, sign_text: null, models: [] };
  if (photos.length > MAX_PHOTOS) throw new HttpError(400, `At most ${MAX_PHOTOS} photos`);
  photos.forEach(checkDataUrl);

  const serviceNames = services.map((s) => s.name).filter(Boolean);
  const { data } = await sparkJson({
    system: VISION_PROMPT,
    user: [
      { type: 'text', text: `Services the owner mentioned: ${serviceNames.length ? serviceNames.join('; ') : 'none'}.\nThere are ${photos.length} photos, in order.` },
      ...photos.map((url) => ({ type: 'image_url', image_url: { url } })),
    ],
    schemaName: 'PhotoAnalysis',
    schema: VISION_SCHEMA,
    reasoningEffort: 'low',
    maxTokens: 4000,
  });

  const analysed = photos.map((_, i) => {
    const p = data.photos.find((x) => x.index === i) || { role: 'other', usable: true, alt: '', sign_text: null, objects: [] };
    return { index: i, role: p.role, usable: p.usable, alt: p.alt, sign_text: p.sign_text, objects: p.objects || [] };
  });

  // One SAM call per (photo, concept), in parallel.
  const jobs = analysed
    .filter((p) => p.usable && p.role !== 'shopfront' && p.role !== 'owner')
    .flatMap((p) => p.objects.map((o) => ({ p, o })));
  const results = await Promise.all(jobs.map(async ({ p, o }) => {
    try {
      const boxes = await samSegment(photos[p.index], o.concept);
      return { p, o, box: pickBox(boxes), matches: boxes.length };
    } catch (err) {
      return { p, o, box: null, matches: 0, error: err.message };
    }
  }));

  const validServices = new Set(serviceNames);
  const crops = [];
  const seenPhotos = new Set();
  for (const r of results) {
    if (!r.box) continue;
    seenPhotos.add(r.p.index);
    crops.push({
      photo_index: r.p.index,
      source: 'sam',
      concept: r.o.concept,
      label: r.o.label,
      service: validServices.has(r.o.service) ? r.o.service : null,
      box: r.box,
      sam_matches: r.matches,
    });
  }
  // Fallback: a usable product/interior photo with no SAM crop is shown whole.
  for (const p of analysed) {
    if (!p.usable || seenPhotos.has(p.index) || p.role === 'shopfront' || p.role === 'owner') continue;
    const o = p.objects[0];
    crops.push({ photo_index: p.index, source: 'full_photo', concept: o?.concept || null, label: o?.label || null, service: o && validServices.has(o.service) ? o.service : null, box: null });
  }

  const usable = analysed.filter((p) => p.usable);
  const hero = usable.find((p) => p.role === 'shopfront') || usable.find((p) => p.role === 'interior') || usable[0] || null;
  const sign = analysed.find((p) => p.usable && p.sign_text)?.sign_text || null;

  return {
    photos: analysed,
    crops,
    hero_photo_index: hero ? hero.index : null,
    sign_text: sign,
    sam_calls: results.map((r) => ({ photo_index: r.p.index, concept: r.o.concept, matches: r.matches, picked: Boolean(r.box), error: r.error })),
    models: [MODELS.spark, ...(jobs.length ? [MODELS.sam] : [])],
  };
}
