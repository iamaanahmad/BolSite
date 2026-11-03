// Regression suite for the honesty gate. Runs the pure applyGate() with no network.
// These encode the four holes two reviewers found, plus positive cases that must keep passing
// so we don't over-tighten and break the golden path.
//   node scripts/gate-regression.mjs      (exit 0 = all pass, 1 = failure)

import { applyGate } from '../lib/extract.js';

const TRANSCRIPT =
  'Namaste, meri dukaan ka naam Asha Tailors hai, Lajpat Nagar market mein. ' +
  'Blouse silai dhai sau rupaye, suit char sau. Subah das baje se raat aath baje tak khula hai. ' +
  'Mera number hai nine eight seven six five four three two one zero.';

// Helper to build one fact object the model could return.
const fact = (value, evidence, confidence = 0.95, extra = {}) => ({ value, evidence, confidence, clarify_question: '', clarify_options: [], ...extra });

// A fully valid baseline the model could return for this transcript.
function validRaw() {
  return {
    language_detected: 'hinglish',
    business_name: fact('Asha Tailors', 'meri dukaan ka naam Asha Tailors hai'),
    category: fact('tailor', 'Asha Tailors'),
    phone: fact('9876543210', 'Mera number hai nine eight seven six five four three two one zero', 0.9),
    whatsapp: fact(null, ''),
    address: fact('Lajpat Nagar market', 'Lajpat Nagar market mein', 0.9),
    hours: fact('10 AM - 8 PM', 'Subah das baje se raat aath baje tak khula hai', 0.85),
    services: [
      { name: 'Blouse silai', price_amount: 250, price_unit: null, price_spoken: 'dhai sau rupaye', name_confidence: 0.9, price_confidence: 0.9, evidence: 'Blouse silai dhai sau rupaye' },
    ],
    highlights: [],
  };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- The four reviewer exploits: each MUST now be rejected ---

test('R1: value not bound to evidence is rejected (name "Invented Palace" citing "Asha Tailors")', () => {
  const raw = validRaw();
  raw.business_name = fact('Invented Palace', 'meri dukaan ka naam Asha Tailors hai');
  const r = applyGate(raw, TRANSCRIPT);
  assert(r.facts.business_name.status !== 'accepted', 'name with mismatched evidence was accepted');
  assert(r.facts.business_name.flags.includes('value_not_in_evidence'), 'missing value_not_in_evidence flag');
});

test('R2: phone not matching cited digits is rejected (proposed 9123456789 citing a different number)', () => {
  const raw = validRaw();
  raw.phone = fact('9123456789', 'Mera number hai nine eight seven six five four three two one zero', 0.95);
  const r = applyGate(raw, TRANSCRIPT);
  assert(r.facts.phone.status !== 'accepted', 'mismatched phone was accepted');
  assert(!r.publishable, 'site publishable with an unbound phone');
});

test('R3: price with no spoken evidence is dropped (amount 500, price_spoken=null)', () => {
  const raw = validRaw();
  raw.services = [{ name: 'Blouse silai', price_amount: 500, price_unit: null, price_spoken: null, name_confidence: 0.9, price_confidence: 0.9, evidence: 'Blouse silai dhai sau rupaye' }];
  const r = applyGate(raw, TRANSCRIPT);
  const svc = r.services.find((s) => s.name === 'Blouse silai');
  assert(svc, 'valid service name should still be kept');
  assert(svc.price === null, `ungrounded price was kept: ${svc.price}`);
});

test('R4: evidence that only shares words (no verbatim quote) is rejected', () => {
  const raw = validRaw();
  // Evidence is a word-salad of transcript words but not a real contiguous quote of the value.
  raw.business_name = fact('Royal Tailors', 'dukaan naam market mein hai tailors');
  const r = applyGate(raw, TRANSCRIPT);
  assert(r.facts.business_name.status !== 'accepted', 'word-overlap evidence was accepted');
});

// --- Additional binding cases ---

test('R5: empty evidence drops the value (never guessed, never published)', () => {
  const raw = validRaw();
  raw.address = fact('Some Place', '', 0.95); // optional field, value with no evidence
  const r = applyGate(raw, TRANSCRIPT);
  assert(r.facts.address.value === null, 'ungrounded value was not dropped');
  assert(r.facts.address.status === 'omitted', 'ungrounded optional fact not omitted');
  assert(r.facts.address.confidence === 0, 'ungrounded value kept confidence');
});

test('R5b: empty evidence on a REQUIRED field becomes a clarification, never accepted', () => {
  const raw = validRaw();
  raw.business_name = fact('Some Shop', '', 0.95);
  const r = applyGate(raw, TRANSCRIPT);
  assert(r.facts.business_name.value === null, 'ungrounded required value was not dropped');
  assert(r.facts.business_name.status === 'clarify', 'required field not sent to clarification');
  assert(!r.publishable, 'publishable despite ungrounded required field');
});

test('R6: price that mis-parses vs spoken words is dropped (spoken "dhai sau"=250, amount claims 900)', () => {
  const raw = validRaw();
  raw.services = [{ name: 'Blouse silai', price_amount: 900, price_unit: null, price_spoken: 'dhai sau rupaye', name_confidence: 0.9, price_confidence: 0.9, evidence: 'Blouse silai dhai sau rupaye' }];
  const r = applyGate(raw, TRANSCRIPT);
  const svc = r.services.find((s) => s.name === 'Blouse silai');
  assert(svc && svc.price === null, 'price mismatching its spoken words was kept');
});

// --- Positive cases: legitimate data MUST still publish (guard against over-tightening) ---

test('P1: a fully grounded voice note still publishes with all facts', () => {
  const r = applyGate(validRaw(), TRANSCRIPT);
  assert(r.facts.business_name.status === 'accepted', 'valid name rejected');
  assert(r.facts.category.status === 'accepted', 'valid category rejected');
  assert(r.facts.phone.status === 'accepted', `valid phone rejected: ${JSON.stringify(r.facts.phone)}`);
  assert(r.publishable, 'a fully grounded note is not publishable');
});

test('P2: grounded price is kept and formatted', () => {
  const r = applyGate(validRaw(), TRANSCRIPT);
  const svc = r.services.find((s) => s.name === 'Blouse silai');
  assert(svc && svc.price === '₹250', `grounded price not kept: ${svc && svc.price}`);
});

test('P4: interpreted fields (category, hours) are allowed when evidence is a real quote', () => {
  // "tailor" is derived from "Asha Tailors"; "10 AM - 8 PM" from "das baje ... aath baje".
  // These are not verbatim but their evidence is a genuine transcript quote, so they stand.
  const r = applyGate(validRaw(), TRANSCRIPT);
  assert(r.facts.category.status === 'accepted', `grounded interpreted category rejected: ${JSON.stringify(r.facts.category)}`);
  assert(r.facts.hours.status === 'accepted', `grounded interpreted hours rejected: ${JSON.stringify(r.facts.hours)}`);
});

test('P5: category with a FABRICATED evidence quote is still rejected', () => {
  const raw = validRaw();
  raw.category = fact('restaurant', 'we run a fine dining restaurant', 0.95); // evidence not in transcript
  const r = applyGate(raw, TRANSCRIPT);
  assert(r.facts.category.status !== 'accepted', 'category with fabricated evidence was accepted');
  assert(r.facts.category.flags.includes('evidence_not_in_transcript'), 'missing evidence_not_in_transcript flag');
});

test('P6: phone spoken as digit words (English, in evidence) binds correctly', () => {
  const r = applyGate(validRaw(), TRANSCRIPT);
  assert(r.facts.phone.status === 'accepted', `spoken-digit phone rejected: ${JSON.stringify(r.facts.phone)}`);
  assert(r.facts.phone.value === '+919876543210', `wrong phone value: ${r.facts.phone.value}`);
});

test('P3: a clarification answer that supplies a value (source=clarification) is allowed', () => {
  // After clarification, a value can come from the owner's answer, not the transcript.
  // applyGate only sees transcript-sourced facts; this guards that an omitted-but-mentioned
  // required fact becomes a clarify prompt rather than being silently accepted.
  const raw = validRaw();
  raw.phone = fact('98765', 'Mera number hai', 0.4); // partial, low confidence
  const r = applyGate(raw, TRANSCRIPT);
  assert(r.facts.phone.status === 'clarify', 'weak phone did not become a clarification');
});

// --- Spoken-number recall: true prices must not be dropped just because ASR spelled them differently ---

// "अढ़ाई" in both Unicode encodings: precomposed ढ़ (U+095D) and ढ + nukta (U+0922 U+093C).
const ADHAI_PRECOMPOSED = '\u0905\u095D\u093E\u0908';
const ADHAI_DECOMPOSED = '\u0905\u0922\u093C\u093E\u0908';

for (const [label, word] of [['precomposed', ADHAI_PRECOMPOSED], ['nukta-decomposed', ADHAI_DECOMPOSED]]) {
  test(`P7: "${label} अढ़ाई सौ रुपये" is recognised as 250 and the price is kept`, () => {
    const transcript = `मेरी दुकान का नाम शर्मा टेलर्स है। ब्लाउज सिलाई ${word} सौ रुपये। नंबर नाइन आठ सात छह पांच चार तीन दो एक ज़ीरो।`;
    const raw = {
      language_detected: 'hi',
      business_name: fact('शर्मा टेलर्स', 'मेरी दुकान का नाम शर्मा टेलर्स है'),
      category: fact('tailor', 'शर्मा टेलर्स'),
      phone: fact('9876543210', 'नंबर नाइन आठ सात छह पांच चार तीन दो एक ज़ीरो', 0.9),
      whatsapp: fact(null, ''), address: fact(null, ''), hours: fact(null, ''),
      services: [{ name: 'ब्लाउज सिलाई', price_amount: 250, price_unit: null, price_spoken: `${word} सौ रुपये`, name_confidence: 0.9, price_confidence: 0.9, evidence: `ब्लाउज सिलाई ${word} सौ रुपये` }],
      highlights: [],
    };
    const r = applyGate(raw, transcript);
    const svc = r.services.find((s) => s.name === 'ब्लाउज सिलाई');
    assert(svc && svc.price === '₹250', `true price dropped: ${JSON.stringify(svc && { price: svc.price, flags: svc.flags })}`);
  });
}

test('P8: spokenNumbersIn finds numbers by exact word, not by substring', async () => {
  const { spokenNumbersIn, parseSpokenNumber } = await import('../lib/numwords.js');
  assert(parseSpokenNumber(`${ADHAI_PRECOMPOSED} सौ`) === 250, 'precomposed adhai not 250');
  assert(parseSpokenNumber(`${ADHAI_DECOMPOSED} सौ`) === 250, 'decomposed adhai not 250');
  assert(parseSpokenNumber('adhai sau') === 250 && parseSpokenNumber('dhaai sau') === 250, 'roman adhai/dhaai not 250');
  // "dosa" and "document" merely start with number-word letters; they must not form numbers.
  assert(spokenNumbersIn('dosa document').length === 0, `substring false-positive: ${JSON.stringify(spokenNumbersIn('dosa document'))}`);
  const hours = spokenNumbersIn('सुबह दस बजे से रात आठ बजे तक');
  assert(JSON.stringify(hours) === '[10,8]', `hours not grounded: ${JSON.stringify(hours)}`);
});

test('P9: an ASR-stuttered multiplier ("डेढ़ सौ सौ रुपये") still verifies as 150 and the price is kept', async () => {
  const { parseSpokenNumber } = await import('../lib/numwords.js');
  assert(parseSpokenNumber('डेढ़ सौ सौ रुपये') === 150, `stuttered sau parsed as ${parseSpokenNumber('डेढ़ सौ सौ रुपये')}`);
  assert(parseSpokenNumber('एक हज़ार हज़ार') === 1000, 'stuttered hazaar not collapsed');
  assert(parseSpokenNumber('चार सौ') === 400 && parseSpokenNumber('एक सौ बीस') === 120, 'normal numbers changed');
  const transcript = 'आटा पाँच किलो का डेढ़ सौ सौ रुपये बासमती चावल एक किलो का एक सौ बीस रुपये';
  const raw = validRaw();
  raw.services = [{ name: 'आटा', price_amount: 150, price_unit: 'per 5 kg', price_spoken: 'डेढ़ सौ सौ रुपये', name_confidence: 0.9, price_confidence: 0.85, evidence: 'आटा पाँच किलो का डेढ़ सौ सौ रुपये' }];
  const r = applyGate(raw, TRANSCRIPT + ' ' + transcript);
  const svc = r.services.find((s) => s.name === 'आटा');
  // The unit "per 5 kg" holds a digit, which the gate's strict unit pattern ignores: price shown, unit omitted.
  assert(svc && svc.price === '₹150', `true price dropped or altered: ${JSON.stringify(svc && { p: svc.price, f: svc.flags })}`);
});

test('R8: the stutter collapse cannot be abused to smuggle a wrong price (डेढ़ सौ सौ != 250)', () => {
  const transcript = 'आटा पाँच किलो का डेढ़ सौ सौ रुपये';
  const raw = validRaw();
  raw.services = [{ name: 'आटा', price_amount: 250, price_unit: null, price_spoken: 'डेढ़ सौ सौ रुपये', name_confidence: 0.9, price_confidence: 0.9, evidence: 'आटा पाँच किलो का डेढ़ सौ सौ रुपये' }];
  const r = applyGate(raw, TRANSCRIPT + ' ' + transcript);
  const svc = r.services.find((s) => s.name === 'आटा');
  assert(svc && svc.price === null, `wrong price kept: ${svc && svc.price}`);
});

test('R7: a WRONG price is still rejected even with the adhai spelling (adhai sau != 900)', () => {
  const transcript = `ब्लाउज सिलाई ${ADHAI_PRECOMPOSED} सौ रुपये`;
  const raw = validRaw();
  raw.services = [{ name: 'ब्लाउज सिलाई', price_amount: 900, price_unit: null, price_spoken: `${ADHAI_PRECOMPOSED} सौ रुपये`, name_confidence: 0.9, price_confidence: 0.9, evidence: transcript }];
  const r = applyGate(raw, TRANSCRIPT + ' ' + transcript);
  const svc = r.services.find((s) => s.name === 'ब्लाउज सिलाई');
  assert(svc && svc.price === null, `wrong price kept: ${svc && svc.price}`);
});

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  PASS  ${t.name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${t.name}\n        ${err.message}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} FAILED` : `\nAll ${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
