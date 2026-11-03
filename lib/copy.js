// Bilingual site copy from the final facts (Muse Spark), then a deterministic grounding check:
//   - every number in free-form copy must already exist in the owner's facts
//   - marketing claims ("best", "since 1990", "सबसे") are rejected unless the owner said them
// One retry with the violations fed back; if it still fails, we drop the free-form copy entirely.

import { sparkJson } from './meta.js';

const bi = (desc) => ({
  type: 'object',
  description: desc,
  properties: { en: { type: 'string' }, hi: { type: 'string' } },
  required: ['en', 'hi'],
  additionalProperties: false,
});

const COPY_SCHEMA = {
  type: 'object',
  properties: {
    name_latin: { type: 'string', description: 'Business name in Latin script (transliterate if needed, do not translate).' },
    name_devanagari: { type: 'string', description: 'Business name in Devanagari (transliterate if needed).' },
    category: bi('Category, 1-3 words.'),
    tagline: bi('One short line, max 8 words, describing ONLY what the business does, using only given facts.'),
    about: bi('2 short sentences using only the given facts. No new claims.'),
    address: { anyOf: [bi('Address as given, translated/transliterated only.'), { type: 'null' }] },
    hours: { anyOf: [bi('Hours as given. In "en", write clock times as digits with AM/PM, e.g. "10 AM to 8 PM, Sunday closed", using ONLY what the owner\'s words state (सुबह/morning = AM, शाम/रात/evening/night = PM). Never add minutes like ":00", days, or times the owner did not say. In "hi", keep the owner\'s own wording.'), { type: 'null' }] },
    services: { type: 'array', items: bi('Service/product name, translated/transliterated only, same order as input.') },
    highlights: { type: 'array', items: bi('Highlight, translated only, same order as input.') },
  },
  required: ['name_latin', 'name_devanagari', 'category', 'tagline', 'about', 'address', 'hours', 'services', 'highlights'],
  additionalProperties: false,
};

const COPY_PROMPT = `You write the text for a one-page website of an Indian small business, in English (en) and Hindi in Devanagari (hi).
Use ONLY the facts provided. You may translate and transliterate. You must not add anything: no claims about quality,
experience, years, popularity, pricing level, guarantees, awards, or customers. No superlatives. No numbers that are not in the facts.
Keep it warm and simple, like the owner talking. Return services and highlights in the same order and count as given.`;

const CLAIM_TERMS = [
  'best', 'top', 'no.1', 'no. 1', '#1', 'number one', 'cheapest', 'lowest', 'affordable', 'guarantee', 'famous', 'trusted',
  'award', 'certified', 'since', 'years', 'quality', 'premium', 'expert', 'experienced', 'finest', 'leading', 'perfect', 'professional',
  'सबसे', 'बेहतरीन', 'गारंटी', 'मशहूर', 'प्रसिद्ध', 'भरोसेमंद', 'साल', 'सस्ता', 'सस्ते', 'अनुभवी', 'विशेषज्ञ', 'उत्तम',
];

import { spokenNumbersIn } from './numwords.js';

const DEV = '०१२३४५६७८९';
export const asciiDigits = (s) => String(s ?? '').replace(/[०-९]/g, (d) => String(DEV.indexOf(d)));
export const numbersIn = (s) => (asciiDigits(s).replace(/:00\b/g, '').match(/\d+/g) || []).map((n) => String(Number(n)));

/**
 * Numbers the owner is allowed to have on the page: digits they said, plus digits that come
 * from spoken number words ("दस बजे" -> 10). Returned as a Set of canonical strings.
 */
export function allowedNumbers(truthText) {
  const set = new Set(numbersIn(truthText));
  for (const n of spokenNumbersIn(truthText)) {
    set.add(String(n));
    // A spoken hour like "दस" (10) legitimately renders as "10"; also allow its components.
    for (const part of numbersIn(String(n))) set.add(part);
  }
  return set;
}

/** Strings that hold what the owner actually said (and confirmed). */
export function groundTruthText(final) {
  const parts = [];
  for (const f of Object.values(final.facts)) if (f.status === 'accepted' && f.value) parts.push(f.value);
  for (const s of final.services) parts.push(s.name, s.price || '');
  for (const h of final.highlights) parts.push(h.text, h.evidence || '');
  return parts.join(' \n ');
}

export function findCopyViolations(copy, final) {
  const truth = groundTruthText(final);
  const truthNums = allowedNumbers(truth);
  const truthLower = truth.toLowerCase();
  const free = [copy.tagline.en, copy.tagline.hi, copy.about.en, copy.about.hi].join(' \n ');
  const v = [];
  for (const n of numbersIn(free)) if (!truthNums.has(n)) v.push(`number "${n}" is not in the facts`);
  const lower = free.toLowerCase();
  for (const term of CLAIM_TERMS) {
    const re = /^[a-z#. 0-9]+$/.test(term) ? new RegExp(`(^|[^a-z])${term.replace(/[.#]/g, '\\$&')}([^a-z]|$)`) : null;
    const hit = re ? re.test(lower) : lower.includes(term);
    if (hit && !truthLower.includes(term)) v.push(`claim word "${term}" was not said by the owner`);
  }
  if (copy.services.length !== final.services.length) v.push('services count changed');
  if (copy.highlights.length !== final.highlights.length) v.push('highlights count changed');
  return [...new Set(v)];
}

function factsForPrompt(final) {
  const f = final.facts;
  const pick = (k) => (f[k]?.status === 'accepted' ? f[k].value : null);
  return {
    language_spoken: final.language_detected,
    business_name: pick('business_name'),
    category: pick('category'),
    address: pick('address'),
    hours: pick('hours'),
    services: final.services.map((s) => ({ name: s.name, price: s.price })),
    highlights: final.highlights.map((h) => h.text),
  };
}

export async function writeCopy(final) {
  const facts = factsForPrompt(final);
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data } = await sparkJson({
      system: COPY_PROMPT,
      user: `Facts:\n${JSON.stringify(facts, null, 1)}${feedback}`,
      schemaName: 'SiteCopy',
      schema: COPY_SCHEMA,
      reasoningEffort: 'low',
      maxTokens: 4000,
    });
    if (!facts.address) data.address = null;
    if (!facts.hours) data.hours = null;
    const violations = findCopyViolations(data, final);
    if (!violations.length) return { copy: data, attempts: attempt, grounded: true, violations: [] };
    feedback = `\n\nYour previous draft broke the rules: ${violations.join('; ')}. Rewrite without these.`;
    if (attempt === 2) {
      // Keep the translations, drop the free-form text that could not be grounded.
      return { copy: { ...data, tagline: null, about: null }, attempts: attempt, grounded: false, violations };
    }
  }
  throw new Error('unreachable');
}
