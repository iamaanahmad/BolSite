// One clarification round. The owner taps an option, types an answer, or skips.
// Typed answers are interpreted by Muse Spark (handles "haan wahi", "nahi, 98…"), then re-validated
// by the same deterministic rules as extraction. Whatever is still weak afterwards is omitted.

import { sparkJson } from './meta.js';
import { THRESHOLD, REQUIRED_FIELDS, normalizeIndianPhone, evidenceFound } from './extract.js';
import { HttpError } from './http.js';

const OPTION_CONFIDENCE = 0.95; // owner tapped a value we heard (or read off their photo)
const PHONE_FIELDS = new Set(['phone', 'whatsapp']);

const INTERPRET_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          value: { type: ['string', 'null'], description: 'The value the owner gave or confirmed. null if unclear, refused, or "don\'t know".' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string', description: 'Exact verbatim words from the owner\'s answer that support the value.' },
        },
        required: ['field', 'value', 'confidence', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
};

const INTERPRET_PROMPT = `A small-business owner answered short clarification questions about their business.
For each answer, decide the value they gave.
- If they confirm the heard value ("haan", "yes", "sahi hai", "wahi"), value = the heard value, evidence = their confirming words.
- If they give a new value, value = that value exactly (phone numbers as digits only; convert spoken digits).
- If the answer is unclear, a refusal, or "don't know" ("pata nahi"), value = null, confidence = 0.
Never add anything they did not say. Never improve or complete a partial phone number.`;

/** Resolves leftover states so every fact ends as accepted or omitted. */
export function finalizeFacts(result) {
  const facts = structuredClone(result.facts);
  if (facts.whatsapp?.linked_to === 'phone') {
    if (facts.phone.status === 'accepted') {
      facts.whatsapp = { ...facts.whatsapp, value: facts.phone.value, confidence: facts.phone.confidence, source: facts.phone.source, status: 'accepted', flags: ['same_as_phone'] };
    } else {
      facts.whatsapp = { ...facts.whatsapp, status: 'omitted' };
    }
  }
  for (const f of Object.values(facts)) {
    if (f.status === 'clarify') f.status = 'omitted';
    if (f.status === 'omitted') f.value = null;
    f.clarification = null;
  }
  return {
    ...result,
    facts,
    clarifications: [],
    publishable: REQUIRED_FIELDS.every((k) => facts[k].status === 'accepted'),
    blocked_by: REQUIRED_FIELDS.filter((k) => facts[k].status !== 'accepted'),
  };
}

function validateAnswerValue(field, value) {
  if (!value) return { value: null, ok: false, flag: 'no_answer' };
  if (PHONE_FIELDS.has(field)) {
    const e164 = normalizeIndianPhone(value);
    return e164 ? { value: e164, ok: true } : { value, ok: false, flag: 'phone_format_invalid' };
  }
  return { value: value.trim(), ok: true };
}

/**
 * result:  the /api/extract response (as returned to the client)
 * answers: [{ field, via: 'option' | 'text' | 'skip', answer }]
 */
export async function applyClarifications(result, answers) {
  const pending = new Map((result.clarifications || []).map((c) => [c.field, c]));
  const facts = structuredClone(result.facts);
  const typed = [];

  for (const a of answers || []) {
    const c = pending.get(a.field);
    if (!c) throw new HttpError(400, `No clarification was asked for "${a.field}"`);
    pending.delete(a.field);
    const fact = facts[a.field];

    if (a.via === 'option') {
      if (!c.options.includes(a.answer)) throw new HttpError(400, `"${a.answer}" is not one of the offered options for ${a.field}`);
      const v = validateAnswerValue(a.field, a.answer);
      Object.assign(fact, {
        value: v.value,
        confidence: v.ok ? OPTION_CONFIDENCE : 0.5,
        source: 'clarification',
        evidence: a.answer,
        status: v.ok ? 'accepted' : 'omitted',
        flags: v.ok ? [] : [v.flag],
      });
    } else if (a.via === 'text' && typeof a.answer === 'string' && a.answer.trim()) {
      typed.push({ field: a.field, question: c.question, heard: c.heard, answer: a.answer.trim().slice(0, 300) });
    } else {
      Object.assign(fact, { status: 'omitted', flags: ['owner_skipped'] });
    }
  }
  // Questions the owner did not answer at all count as skipped.
  for (const field of pending.keys()) Object.assign(facts[field], { status: 'omitted', flags: ['owner_skipped'] });

  let usage = null;
  if (typed.length) {
    const { data, usage: u } = await sparkJson({
      system: INTERPRET_PROMPT,
      user: JSON.stringify(typed, null, 1),
      schemaName: 'ClarificationAnswers',
      schema: INTERPRET_SCHEMA,
      reasoningEffort: 'low',
      maxTokens: 3000,
    });
    usage = u;
    const byField = new Map(data.answers.map((x) => [x.field, x]));
    for (const t of typed) {
      const fact = facts[t.field];
      const x = byField.get(t.field);
      const flags = [];
      let confidence = x ? Math.min(1, Math.max(0, x.confidence)) : 0;
      if (x?.value && !evidenceFound(x.evidence, t.answer) && !t.answer.toLowerCase().includes((x.evidence || '').toLowerCase())) {
        flags.push('evidence_not_in_answer');
        confidence = Math.min(confidence, 0.5);
      }
      const v = validateAnswerValue(t.field, x?.value);
      if (!v.ok) {
        flags.push(v.flag);
        confidence = Math.min(confidence, 0.5);
      }
      const accepted = v.ok && confidence >= THRESHOLD;
      Object.assign(fact, {
        value: accepted ? v.value : null,
        confidence: Math.round(confidence * 100) / 100,
        source: 'clarification',
        evidence: t.answer,
        status: accepted ? 'accepted' : 'omitted',
        flags,
      });
    }
  }

  return { ...finalizeFacts({ ...result, facts }), clarify_usage: usage };
}
