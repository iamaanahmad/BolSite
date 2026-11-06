// Transcript -> structured business facts with confidence, then a deterministic
// honesty gate. Muse Spark proposes; this code disposes. Rules enforced here:
//   1. Every fact must quote verbatim evidence from the transcript or it is capped below threshold.
//   2. Required facts (business_name, category, phone) must reach >= 0.75 to publish.
//   3. Anything below 0.75 gets at most one clarification question, or is omitted. Never guessed.

import { sparkJson } from './meta.js';
import { parseSpokenNumber } from './numwords.js';

export const THRESHOLD = 0.75;
export const REQUIRED_FIELDS = ['business_name', 'category', 'phone'];
export const OPTIONAL_FIELDS = ['address', 'hours', 'whatsapp'];
const UNVERIFIED_CAP = 0.5;

// ---------- schema sent to Muse Spark ----------

const factSchema = (description) => ({
  type: 'object',
  description,
  properties: {
    value: { type: ['string', 'null'], description: 'The fact exactly as stated, or null if not stated.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'string', description: 'Exact verbatim substring of the transcript that states this fact. Empty string if value is null.' },
    clarify_question: { type: 'string', description: "One short question (max 12 words) in the owner's language to confirm or supply this fact." },
    clarify_options: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string' },
      description: 'Up to 3 tap-to-answer candidates taken ONLY from what the transcript says. Empty if none.',
    },
  },
  required: ['value', 'confidence', 'evidence', 'clarify_question', 'clarify_options'],
  additionalProperties: false,
});

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    language_detected: { type: 'string', enum: ['hi', 'en', 'hinglish'] },
    business_name: factSchema('Name of the business.'),
    category: factSchema('What kind of business it is, in a few words (e.g. "tailor", "kirana store", "mobile repair").'),
    phone: factSchema('Contact phone number as digits only, e.g. "9876543210". Convert spoken number words to digits.'),
    whatsapp: factSchema('WhatsApp number as digits, only if the owner explicitly mentions WhatsApp. If they say WhatsApp is on the same number, repeat that number.'),
    address: factSchema('Location / address as stated.'),
    hours: factSchema('Opening hours / days as stated.'),
    services: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price_amount: { type: ['number', 'null'], description: 'Price in rupees as a plain number for THIS item. Convert number words: "ढाई सौ" = 250, "डेढ़ सौ" = 150, "chaar sau" = 400. null if no price stated for this item.' },
          price_unit: { type: ['string', 'null'], description: 'Unit in English if stated, e.g. "per kg", "per piece". null otherwise.' },
          price_spoken: { type: ['string', 'null'], description: 'The price words exactly as in the transcript, e.g. "ढाई सौ रुपये". null if no price.' },
          name_confidence: { type: 'number', minimum: 0, maximum: 1 },
          price_confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string', description: 'Exact verbatim transcript substring mentioning this item (and its price if any).' },
        },
        required: ['name', 'price_amount', 'price_unit', 'price_spoken', 'name_confidence', 'price_confidence', 'evidence'],
        additionalProperties: false,
      },
    },
    highlights: {
      type: 'array',
      maxItems: 5,
      description: 'Other concrete claims the owner made about the business (years running, home delivery, specialties).',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Short claim, faithful to what was said.' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string' },
        },
        required: ['text', 'confidence', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['language_detected', 'business_name', 'category', 'phone', 'whatsapp', 'address', 'hours', 'services', 'highlights'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You extract facts for a small-business website from a voice-note transcript.
The speaker is an Indian small-business owner speaking Hindi, English, or Hinglish (mixed). The transcript may be in Devanagari, Roman script, or both, and may contain speech-recognition errors.

ABSOLUTE RULE: never invent. Use ONLY what the transcript explicitly says. Do not use world knowledge to fill gaps, do not guess a city from a name, do not assume hours, prices, or a phone number. If something is not said, value = null, confidence = 0, evidence = "".

Evidence: copy the exact words from the transcript that state the fact, character for character, in the same script. Do not translate, transliterate, or paraphrase evidence.

Confidence rubric:
- 0.90–1.00: stated clearly and unambiguously.
- 0.75–0.89: clearly stated but with a small ambiguity.
- 0.40–0.74: partially heard, garbled by transcription, contradicted, or ambiguous.
- below 0.40: barely supported. Prefer null.

Field rules:
- business_name: the name as spoken. A name that contains a trade word (e.g. "Sharma Tailors") can also support category.
- category: what the business does, short, in English (e.g. "tailor", "kirana store"). Must be supported by the transcript.
- phone: digits only. Convert spoken digits in Hindi or English ("nau aath", "double five") to digits. An Indian number has 10 digits (optionally preceded by 91 or 0). If you hear a different count of digits, still give what you heard but confidence <= 0.5.
- whatsapp: only if WhatsApp is mentioned.
- hours: as stated, normalized lightly, e.g. "Mon–Sat, 10 AM – 8 PM".
- services: each product/service mentioned. Attach a price only if it was said for that specific item. Never move a price from one item to another. price_amount is always digits (convert Hindi/English number words); price_spoken is the exact words.
- highlights: only concrete claims actually made; max 5.

Clarification questions: for every fact, write one short, friendly question (max 12 words) in the speaker's language style (Hinglish in Roman script if they spoke Hinglish, Hindi in Devanagari if they spoke Hindi, English if English). Ask to confirm the heard value if there is one, or to supply it if missing. clarify_options: up to 3 candidate values heard in the transcript (for example two possible phone numbers), never invented ones.`;

// ---------- deterministic validation ----------

const DEVANAGARI_DIGITS = '०१२३४५६७८९';
function asciiDigits(s) {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

function normalizeText(s) {
  return asciiDigits(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True only if the evidence quote is an exact, contiguous substring of the transcript
 * after normalization. (Previously allowed 85% word overlap, which let a cited span that
 * merely shared words pass. Honesty requires a real quote, so overlap is no longer accepted.)
 */
export function evidenceFound(evidence, transcript) {
  const ev = normalizeText(evidence);
  if (!ev) return false;
  return normalizeText(transcript).includes(ev);
}

/**
 * The core honesty binding: the proposed VALUE must actually appear in its own cited EVIDENCE
 * span (not just somewhere in the transcript). This stops a fact citing real transcript text
 * while proposing an unrelated value. Returns true if value is grounded in evidence.
 */
export function valueInEvidence(value, evidence) {
  const v = normalizeText(value);
  const ev = normalizeText(evidence);
  if (!v || !ev) return false;
  return ev.includes(v);
}

// Single spoken digit words (0-9) in English, Hinglish-Roman, and Hindi. Phone numbers are
// dictated digit-by-digit, so this converts a spoken evidence span to a digit string for binding.
const DIGIT_WORDS = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  零: '0', shunya: '0', 'शून्य': '0', ek: '1', 'एक': '1', do: '2', 'दो': '2', teen: '3', 'तीन': '3', char: '4', chaar: '4', 'चार': '4',
  paanch: '5', panch: '5', 'पांच': '5', 'पाँच': '5', chhe: '6', che: '6', 'छह': '6', 'छे': '6', saat: '7', 'सात': '7',
  aath: '8', 'आठ': '8', nau: '9', 'नौ': '9', 'double': 'DBL', 'triple': 'TRP',
  // English digit words transliterated into Devanagari (ASR often writes a Hinglish speaker this way)
  'ज़ीरो': '0', 'जीरो': '0', 'वन': '1', 'टू': '2', 'थ्री': '3', 'फोर': '4', 'फ़ोर': '4', 'फाइव': '5', 'फ़ाइव': '5',
  'सिक्स': '6', 'सेवन': '7', 'एट': '8', 'नाइन': '9', 'डबल': 'DBL', 'ट्रिपल': 'TRP',
};

export function spokenDigitsIn(text) {
  const tokens = asciiDigits(text || '').toLowerCase().split(/[^a-z0-9\u0900-\u097f]+/).filter(Boolean);
  let out = '';
  let repeat = 1;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) { out += t.repeat(repeat); repeat = 1; continue; }
    const d = DIGIT_WORDS[t];
    if (d === 'DBL') repeat = 2;
    else if (d === 'TRP') repeat = 3;
    else if (d !== undefined) { out += d.repeat(repeat); repeat = 1; }
    else repeat = 1; // a non-digit word resets any pending "double/triple"
  }
  return out;
}

/** Normalizes an Indian phone number to +91XXXXXXXXXX, or returns null if the format is invalid. */
export function normalizeIndianPhone(raw) {
  let d = asciiDigits(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10 || d.startsWith('0')) return null;
  return `+91${d}`;
}

/** Returns the numeric amount in a price string if it is sane, else null. */
export function parsePrice(raw) {
  if (!raw) return null;
  const m = asciiDigits(raw).replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return n > 0 && n <= 1_000_000 ? n : null;
}

function clamp01(n) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

const DEFAULT_QUESTIONS = {
  business_name: { en: 'What is the name of your business?', hi: 'आपकी दुकान का नाम क्या है?', hinglish: 'Aapki dukaan ka naam kya hai?' },
  category: { en: 'What kind of business is it?', hi: 'आपका काम किस चीज़ का है?', hinglish: 'Aapka kaam kis cheez ka hai?' },
  phone: { en: 'Which phone number should customers call?', hi: 'ग्राहक किस नंबर पर फ़ोन करें?', hinglish: 'Customer kis number pe call karein?' },
  whatsapp: { en: 'Which number do you use for WhatsApp?', hi: 'WhatsApp किस नंबर पर है?', hinglish: 'WhatsApp kis number pe hai?' },
  address: { en: 'Where is your shop located?', hi: 'आपकी दुकान कहाँ है?', hinglish: 'Aapki dukaan kahan hai?' },
  hours: { en: 'What are your opening hours?', hi: 'दुकान कितने बजे से कितने बजे तक खुलती है?', hinglish: 'Dukaan kitne baje se kitne baje tak khulti hai?' },
};

function validateFact(field, raw, transcript, language) {
  const flags = [];
  let value = typeof raw.value === 'string' && raw.value.trim() ? raw.value.trim() : null;
  let confidence = clamp01(raw.confidence);
  const evidence = (raw.evidence || '').trim();

  if (!value) {
    confidence = 0;
  } else if (!evidence) {
    // Missing evidence => the value is not bound to anything the owner said. Drop the value
    // entirely (never guessed) and let the required-field logic ask a clarification if needed.
    flags.push('no_evidence');
    value = null;
    confidence = 0;
  } else if (!evidenceFound(evidence, transcript)) {
    flags.push('evidence_not_in_transcript');
    confidence = Math.min(confidence, UNVERIFIED_CAP);
  } else if (field === 'phone' || field === 'whatsapp') {
    // Phone is a LITERAL fact: the proposed digits must appear in the cited evidence, either as
    // literal digits OR as spoken digit words ("nine eight.." / "नाइन फाइव..") converted to digits.
    const valDigits = asciiDigits(value).replace(/\D/g, '');
    const evDigits = asciiDigits(evidence).replace(/\D/g, '');
    const spokenDigits = spokenDigitsIn(evidence);
    const bound = valDigits && (evDigits.includes(valDigits) || spokenDigits.includes(valDigits));
    if (!bound) {
      flags.push('value_not_in_evidence');
      confidence = Math.min(confidence, UNVERIFIED_CAP);
    }
  } else if (field === 'business_name') {
    // Business name is a LITERAL fact: it must appear verbatim in its cited evidence.
    if (!valueInEvidence(value, evidence)) {
      flags.push('value_not_in_evidence');
      confidence = Math.min(confidence, UNVERIFIED_CAP);
    }
  }
  // category / address / hours are INTERPRETED facts: "tailor" from "...Tailors", "10 AM - 8 PM"
  // from "दस बजे... आठ बजे". Fabrication is already blocked above by requiring the evidence to be
  // a real transcript quote; a weak interpretation is caught by the model's own confidence.

  if (value && (field === 'phone' || field === 'whatsapp')) {
    const e164 = normalizeIndianPhone(value);
    if (e164) value = e164;
    else {
      flags.push('phone_format_invalid');
      confidence = Math.min(confidence, UNVERIFIED_CAP);
    }
  }

  const required = REQUIRED_FIELDS.includes(field);
  // "mentioned" means the owner said something we can ask about: a surviving value, or a
  // genuine transcript quote in the evidence. A dropped-for-no-evidence fact is not mentioned.
  const mentioned = Boolean(value) || (evidence && evidenceFound(evidence, transcript));
  let status;
  if (value && confidence >= THRESHOLD) status = 'accepted';
  else if (required || mentioned) status = 'clarify';
  else status = 'omitted';

  let options = [...new Set((raw.clarify_options || []).map((o) => String(o).trim()).filter(Boolean))];
  if (field === 'phone' || field === 'whatsapp') {
    options = [...new Set(options.map(normalizeIndianPhone).filter(Boolean))];
  }
  options = options.slice(0, 3);

  const question = (raw.clarify_question || '').trim() || DEFAULT_QUESTIONS[field][language] || DEFAULT_QUESTIONS[field].en;

  return {
    value,
    confidence: Math.round(confidence * 100) / 100,
    source: 'transcript',
    evidence,
    status,
    flags,
    clarification: status === 'clarify' ? { question, options } : null,
  };
}

function validateServices(services, transcript) {
  const kept = [];
  const omitted = [];
  for (const s of services || []) {
    const name = (s.name || '').trim();
    if (!name) continue;
    const flags = [];
    let nameConf = clamp01(s.name_confidence);
    let priceConf = clamp01(s.price_confidence);
    const sEvidence = (s.evidence || '').trim();
    if (!sEvidence || !evidenceFound(sEvidence, transcript)) {
      flags.push('evidence_not_in_transcript');
      nameConf = Math.min(nameConf, UNVERIFIED_CAP);
      priceConf = Math.min(priceConf, UNVERIFIED_CAP);
    } else if (!valueInEvidence(name, sEvidence)) {
      // The service name must appear in its own cited evidence span.
      flags.push('name_not_in_evidence');
      nameConf = Math.min(nameConf, UNVERIFIED_CAP);
    }
    if (nameConf < THRESHOLD) {
      omitted.push({ name, reason: flags[0] || 'low_confidence', confidence: nameConf });
      continue;
    }
    let price = null;
    let priceValue = null;
    const amount = typeof s.price_amount === 'number' ? s.price_amount : null;
    if (amount !== null) {
      const spoken = (s.price_spoken || '').trim();
      const parsed = parseSpokenNumber(spoken);
      if (!(amount > 0 && amount <= 1_000_000) || !Number.isFinite(amount)) {
        flags.push('price_not_numeric_or_insane');
      } else if (!spoken) {
        // A price with no spoken evidence is not bound to anything the owner said. Drop it.
        flags.push('price_no_evidence');
      } else if (!evidenceFound(spoken, transcript)) {
        flags.push('price_not_in_transcript');
      } else if (parsed === null) {
        // We cannot deterministically confirm the spoken words equal the amount. Drop it.
        flags.push('price_unverifiable');
      } else if (parsed !== amount) {
        flags.push('price_mismatch');
      } else if (priceConf < THRESHOLD) {
        flags.push('price_low_confidence');
      }
      if (!flags.some((f) => f.startsWith('price_'))) {
        priceValue = amount;
        const unit = s.price_unit && /^[a-z /.-]{2,20}$/i.test(s.price_unit.trim()) ? ` ${s.price_unit.trim()}` : '';
        price = `₹${amount.toLocaleString('en-IN')}${unit}`;
      }
    }
    kept.push({
      name,
      price,
      price_value: priceValue,
      confidence: Math.round(nameConf * 100) / 100,
      price_confidence: price ? Math.round(priceConf * 100) / 100 : null,
      price_spoken: s.price_spoken || null,
      evidence: s.evidence,
      flags,
    });
  }
  return { kept, omitted };
}

function validateHighlights(highlights, transcript) {
  // Highlights are free-form claims, so we require the cited evidence to be a real transcript
  // quote. We do not require verbatim value-in-evidence (a highlight is a paraphrase), but an
  // ungrounded claim is capped below threshold and dropped.
  return (highlights || [])
    .map((h) => {
      let c = clamp01(h.confidence);
      const ev = (h.evidence || '').trim();
      if (!ev || !evidenceFound(ev, transcript)) c = Math.min(c, UNVERIFIED_CAP);
      return { text: (h.text || '').trim(), confidence: Math.round(c * 100) / 100, evidence: ev };
    })
    .filter((h) => h.text && h.confidence >= THRESHOLD);
}

/** Pure gate over the model output; exported for testing and for re-running after clarification. */
export function applyGate(raw, transcript) {
  const language = ['hi', 'en', 'hinglish'].includes(raw.language_detected) ? raw.language_detected : 'hinglish';
  const facts = {};
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    facts[field] = validateFact(field, raw[field] || {}, transcript, language);
  }
  const services = validateServices(raw.services, transcript);
  const highlights = validateHighlights(raw.highlights, transcript);

  // "WhatsApp bhi isi number pe" → WhatsApp follows the phone answer instead of getting its own question.
  const digits = (v) => asciiDigits(v || '').replace(/\D/g, '').slice(-10);
  if (facts.whatsapp.value && digits(facts.whatsapp.value) === digits(facts.phone.value)) {
    facts.whatsapp.linked_to = 'phone';
    if (facts.whatsapp.status === 'clarify') facts.whatsapp.clarification = null;
  }

  const clarifications = Object.entries(facts)
    .filter(([, f]) => f.status === 'clarify' && f.clarification)
    .map(([field, f]) => ({
      field,
      required: REQUIRED_FIELDS.includes(field),
      heard: f.value,
      // A one-tap "yes, that's right" is only offered when confirming can actually succeed.
      // An incomplete phone number (e.g. 11 digits from a repeated ASR digit) can never be
      // published, so the owner must type it instead of tapping a button that cannot work.
      confirmable: Boolean(f.value) && (field === 'phone' || field === 'whatsapp' ? Boolean(normalizeIndianPhone(f.value)) : true),
      ...f.clarification,
    }));

  return {
    language_detected: language,
    facts,
    services: services.kept,
    highlights,
    clarifications,
    omitted: {
      facts: Object.entries(facts).filter(([, f]) => f.status === 'omitted').map(([field]) => field),
      services: services.omitted,
    },
    publishable: REQUIRED_FIELDS.every((f) => facts[f].status === 'accepted'),
    threshold: THRESHOLD,
  };
}

export async function extractFacts(transcript) {
  const { data, usage, model } = await sparkJson({
    system: SYSTEM_PROMPT,
    user: `Transcript:\n"""\n${transcript}\n"""`,
    schemaName: 'BusinessFacts',
    schema: EXTRACTION_SCHEMA,
    maxTokens: 16000, // reasoning alone used 6.5k of an 8k cap on a Devanagari-digit phone number
    timeoutMs: 105_000,
  });
  return { ...applyGate(data, transcript), model, usage, raw: data };
}
