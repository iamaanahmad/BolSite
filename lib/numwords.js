// Deterministic parser for spoken prices in Hindi (Devanagari), Hinglish (Roman) and English.
// Used only as a cross-check on Muse Spark's number: "ढाई सौ" must equal 250.
// Returns null when the phrase uses words outside this vocabulary (then Spark's value stands on its own confidence).

const DEV = '०१२३४५६७८९';

// Devanagari letters like ढ़ exist as one precomposed code point and as ढ + nukta; speech-to-text
// emits either. Normalizing every vocabulary key and every input to NFC makes both match.
const nfc = (s) => String(s).normalize('NFC');
const nfcMap = (obj) => new Map(Object.entries(obj).map(([k, v]) => [nfc(k), v]));
const nfcSet = (arr) => new Set(arr.map(nfc));

const UNITS = nfcMap({
  // Devanagari
  'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'छे': 6, 'सात': 7, 'आठ': 8, 'नौ': 9,
  'दस': 10, 'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'पन्द्रह': 15, 'सोलह': 16, 'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19,
  'बीस': 20, 'पच्चीस': 25, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90,
  // Roman Hinglish
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9,
  das: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19,
  bees: 20, pachchees: 25, pachees: 25, tees: 30, chalis: 40, chaalis: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  // English
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
});

const MULTIPLIERS = nfcMap({
  'सौ': 100, sau: 100, hundred: 100,
  'हज़ार': 1000, 'हजार': 1000, hazaar: 1000, hazar: 1000, thousand: 1000,
  'लाख': 100000, lakh: 100000, lac: 100000,
});

// Fractional prefixes: ढाई सौ = 250, डेढ़ सौ = 150, सवा सौ = 125, साढ़े तीन सौ = 350.
// "अढ़ाई" is the same word as "ढाई" (the form Muse Voice Transcribe produced on a real note).
const FRACTION_ALONE = nfcMap({
  'ढाई': 2.5, 'अढ़ाई': 2.5, 'अढाई': 2.5, 'अढ़ई': 2.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, adhaai: 2.5,
  'डेढ़': 1.5, 'डेढ': 1.5, dedh: 1.5, derh: 1.5,
});
const PLUS_QUARTER = nfcSet(['सवा', 'sava', 'savaa']);
const PLUS_HALF = nfcSet(['साढ़े', 'साढे', 'sadhe', 'saadhe']);
const FILLER = nfcSet(['रुपये', 'रुपए', 'रुपया', 'रु', 'rupaye', 'rupees', 'rupee', 'rs', 'ka', 'ki', 'ke', 'का', 'की', 'के', 'and', 'और', 'aur', 'only', 'sirf', 'सिर्फ', '₹']);

// Exact membership in the number vocabulary, for scanning free text for spoken numbers.
const isNumberWord = (t) => UNITS.has(t) || MULTIPLIERS.has(t) || FRACTION_ALONE.has(t) || PLUS_QUARTER.has(t) || PLUS_HALF.has(t);

/**
 * Finds every run of spoken-number words in free text and returns the numbers they evaluate to.
 * Used to ground digits that came from spoken words: "दस बजे ... आठ बजे" -> [10, 8].
 */
export function spokenNumbersIn(text) {
  if (!text) return [];
  const s = nfc(text).toLowerCase();
  const out = [];
  // Scan word-runs separated by non-number words; evaluate each contiguous run.
  const tokens = s.split(/[^a-z\u0900-\u097f.]+/).filter(Boolean);
  let run = [];
  const flush = () => {
    if (run.length) {
      const n = parseSpokenNumber(run.join(' '));
      if (n !== null) out.push(n);
      run = [];
    }
  };
  for (const t of tokens) {
    if (isNumberWord(t)) run.push(t);
    else flush();
  }
  flush();
  return out;
}

export function parseSpokenNumber(phrase) {
  if (!phrase) return null;
  const s = nfc(phrase).replace(/[०-९]/g, (d) => String(DEV.indexOf(d))).replace(/,/g, '').toLowerCase();
  const digits = s.match(/\d+(\.\d+)?/);
  if (digits && !/[a-z\u0900-\u097f]{3,}\s*(सौ|sau|hundred|हज़ार|हजार|hazaar|hazar|thousand|लाख|lakh)/.test(s)) {
    // Pure digits ("250", "₹250") — possibly followed by a multiplier word ("2 हज़ार")
    const after = s.slice(digits.index + digits[0].length).trim().split(/\s+/)[0];
    return Number(digits[0]) * (MULTIPLIERS.get(after) || 1);
  }

  const tokens = s.split(/[^a-z\u0900-\u097f.]+/).filter(Boolean).filter((t) => !FILLER.has(t))
    // Speech-to-text often stutters a multiplier ("डेढ़ सौ सौ रुपये"). The same multiplier twice in a
    // row is never a valid number, so it is one word said once, not "150 + 100".
    .filter((t, i, all) => !(MULTIPLIERS.has(t) && all[i - 1] === t));
  if (!tokens.length) return null;
  let total = 0;
  let current = 0;
  let pending = null; // 'quarter' | 'half'
  let sawNumber = false;
  for (const t of tokens) {
    if (UNITS.has(t)) {
      current += UNITS.get(t);
      sawNumber = true;
    } else if (FRACTION_ALONE.has(t)) {
      current += FRACTION_ALONE.get(t);
      sawNumber = true;
    } else if (PLUS_QUARTER.has(t)) {
      pending = 'quarter';
    } else if (PLUS_HALF.has(t)) {
      pending = 'half';
    } else if (MULTIPLIERS.has(t)) {
      let base = current || 1;
      if (pending === 'quarter') base += 0.25;
      if (pending === 'half') base += 0.5;
      pending = null;
      total += base * MULTIPLIERS.get(t);
      current = 0;
      sawNumber = true;
    } else {
      return null; // word outside the vocabulary: don't guess
    }
  }
  if (!sawNumber || pending) return null;
  const n = total + current;
  return Number.isInteger(n) ? n : null;
}
