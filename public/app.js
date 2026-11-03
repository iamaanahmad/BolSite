// BolSite client. Golden path:
// record/upload -> WAV 16 kHz -> /api/transcribe -> /api/extract -> (/api/segment in background)
// -> clarification questions -> /api/clarify -> /api/generate -> 360px preview + /api/verify -> /api/publish

import { EXAMPLES } from '/examples.js';

const MAX_SECONDS = 60;
const TARGET_RATE = 16000;
const MAX_PHOTOS = 3;
const PHOTO_MAX_SIDE = 1280;
const CARD_MAX_SIDE = 600;
const PREVIEW_WIDTH = 360;

const $ = (id) => document.getElementById(id);
const els = {
  input: $('step-input'), recordBtn: $('record-btn'), recordLabel: $('record-label'), timer: $('timer'),
  audioFile: $('audio-file'), audioUpload: $('audio-upload'), micNotice: $('mic-notice'),
  preview: $('preview'), previewAudio: $('preview-audio'), previewMeta: $('preview-meta'),
  photoFile: $('photo-file'), thumbs: $('thumbs'), go: $('go-btn'),
  progress: $('progress'), error: $('error'), retry: $('retry-btn'), imageModel: $('image-model'),
  results: $('results'), transcript: $('transcript'), langLine: $('lang-line'), facts: $('facts'),
  servicesWrap: $('services-wrap'), services: $('services'), highlightsWrap: $('highlights-wrap'), highlights: $('highlights'),
  omittedWrap: $('omitted-wrap'), omitted: $('omitted'), foundWrap: $('found-wrap'), found: $('found'),
  clarifyCard: $('clarify-card'), clarifyForm: $('clarify-form'), questions: $('questions'),
  blockedCard: $('blocked-card'), blockedText: $('blocked-text'),
  previewCard: $('preview-card'), phone: $('phone'), frame: $('site-frame'), checks: $('checks'), publish: $('publish-btn'),
  doneCard: $('done-card'), liveLink: $('live-link'), copyBtn: $('copy-btn'), shareBtn: $('share-btn'),
};

const state = { audioBlob: null, photos: [], recorder: null, timerHandle: null, slug: null, layout: null };

// ---------- small helpers ----------

const fmt = (sec) => { const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.details = data.details;
    throw err;
  }
  return data;
}

function setStep(name, stepState) {
  const li = els.progress.querySelector(`[data-step="${name}"]`);
  li.classList.remove('active', 'done', 'failed');
  if (stepState) li.classList.add(stepState);
}

function showError(msg) {
  els.progress.hidden = false;
  els.error.hidden = false;
  els.error.textContent = msg;
  els.retry.hidden = false;
}

function updateGo() {
  els.go.disabled = !state.audioBlob;
}

// ---------- recording ----------

async function startRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch {
    // Mic denied/unavailable: keep the user on the input screen and point them to upload.
    // Do NOT show the "Working on it" pipeline.
    els.micNotice.hidden = false;
    els.micNotice.textContent = 'We could not use the microphone. No problem — upload a voice note below instead.';
    els.audioUpload.classList.add('emphasis');
    els.audioUpload.querySelector('input').focus();
    return;
  }
  els.micNotice.hidden = true;
  const chunks = [];
  const rec = new MediaRecorder(stream);
  state.recorder = rec;
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(state.timerHandle);
    setAudio(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), 'Your recording');
    els.recordBtn.setAttribute('aria-pressed', 'false');
    els.recordLabel.textContent = 'Record again';
    state.recorder = null;
  };
  rec.start(250);
  const started = performance.now();
  els.recordBtn.setAttribute('aria-pressed', 'true');
  els.recordLabel.textContent = 'Stop';
  state.timerHandle = setInterval(() => {
    const elapsed = (performance.now() - started) / 1000;
    els.timer.textContent = `${fmt(elapsed)} / ${fmt(MAX_SECONDS)}`;
    if (elapsed >= MAX_SECONDS) state.recorder?.stop();
  }, 250);
}

els.recordBtn.addEventListener('click', () => (state.recorder ? state.recorder.stop() : startRecording()));
els.audioFile.addEventListener('change', () => { const f = els.audioFile.files?.[0]; if (f) setAudio(f, f.name); });

function setAudio(blob, label) {
  state.audioBlob = blob;
  els.previewAudio.src = URL.createObjectURL(blob);
  els.previewMeta.textContent = label;
  els.preview.hidden = false;
  els.micNotice.hidden = true;
  els.audioUpload.classList.remove('emphasis');
  updateGo();
}

// ---------- photos ----------

async function downscale(file, maxSide) {
  const bmp = await createImageBitmap(file); // applies EXIF orientation
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), width: canvas.width, height: canvas.height };
}

els.photoFile.addEventListener('change', async () => {
  const files = [...(els.photoFile.files || [])].filter((f) => f.type.startsWith('image/'));
  els.photoFile.value = '';
  for (const f of files) {
    if (state.photos.length >= MAX_PHOTOS) break;
    try {
      state.photos.push(await downscale(f, PHOTO_MAX_SIDE));
    } catch {
      showError(`Could not read the photo "${f.name}".`);
    }
  }
  renderThumbs();
});

function renderThumbs() {
  els.thumbs.replaceChildren(...state.photos.map((p, i) => {
    const li = el('li');
    const img = el('img');
    img.src = p.dataUrl;
    img.alt = `Photo ${i + 1}`;
    const rm = el('button', '', '×');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Remove photo ${i + 1}`);
    rm.addEventListener('click', () => { state.photos.splice(i, 1); renderThumbs(); });
    li.append(img, rm);
    return li;
  }));
  els.photoFile.closest('label').hidden = state.photos.length >= MAX_PHOTOS;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Cuts a SAM box out of a photo (box coordinates are in the uploaded image's pixels). */
async function cropToDataUrl(photo, box) {
  const img = await loadImage(photo.dataUrl);
  const sx = box ? (box.x1 / box.w) * img.width : 0;
  const sy = box ? (box.y1 / box.h) * img.height : 0;
  const sw = box ? ((box.x2 - box.x1) / box.w) * img.width : img.width;
  const sh = box ? ((box.y2 - box.y1) / box.h) * img.height : img.height;
  const scale = Math.min(1, CARD_MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---------- audio conversion ----------

async function toWav16k(blob) {
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close();
  }
  const seconds = Math.min(decoded.duration, MAX_SECONDS + 2);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * TARGET_RATE), TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return { wav: encodeWav(rendered.getChannelData(0), TARGET_RATE), seconds: decoded.duration };
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// ---------- rendering: facts ----------

const FIELD_LABELS = { business_name: 'Business name', category: 'Category', phone: 'Phone', whatsapp: 'WhatsApp', address: 'Address', hours: 'Hours' };
const STATUS_LABELS = { accepted: 'On site', clarify: 'Will ask', omitted: 'Left out' };
const SOURCE_LABELS = { transcript: 'from your voice note', clarification: 'you confirmed' };
const FLAG_LABELS = {
  evidence_not_in_transcript: 'Could not find this in what you said',
  evidence_not_in_answer: 'Could not find this in your answer',
  phone_format_invalid: 'Not a valid 10-digit number',
  owner_skipped: 'You skipped this',
  no_answer: 'No answer',
  same_as_phone: 'Same as phone number',
};
const LANG_LABELS = { hi: 'Hindi', en: 'English', hinglish: 'Hinglish' };

function renderFacts(r) {
  els.facts.replaceChildren(...Object.entries(r.facts).map(([field, f]) => {
    const li = el('li', 'fact');
    const head = el('div', 'fact-head');
    head.append(el('span', 'fact-label', FIELD_LABELS[field]), el('span', `badge ${f.status}`, `${STATUS_LABELS[f.status]} · ${Math.round(f.confidence * 100)}%`));
    li.append(head, el('div', f.value ? 'fact-value' : 'fact-value none', f.value || 'Not heard'));
    const meter = el('div', 'meter');
    const bar = el('span', f.status);
    bar.style.width = `${Math.round(f.confidence * 100)}%`;
    meter.append(bar);
    li.append(meter);
    if (f.evidence) li.append(el('div', 'evidence', `“${f.evidence}” · ${SOURCE_LABELS[f.source] || ''}`));
    if (f.flags?.length) li.append(el('div', 'flags', f.flags.map((x) => FLAG_LABELS[x] || x).join(' · ')));
    return li;
  }));

  els.servicesWrap.hidden = !r.services.length;
  els.services.replaceChildren(...r.services.map((s) => {
    const li = el('li');
    li.append(el('span', '', s.name), el('span', 'price', s.price || ''));
    return li;
  }));

  els.highlightsWrap.hidden = !r.highlights.length;
  els.highlights.replaceChildren(...r.highlights.map((h) => el('li', '', h.text)));

  const omitted = [
    ...r.omitted.services.map((s) => `${s.name} (not sure we heard it right)`),
    ...r.services.filter((s) => s.flags?.some((f) => f.startsWith('price_'))).map((s) => `Price for ${s.name} (not clear)`),
  ];
  els.omittedWrap.hidden = !omitted.length;
  els.omitted.replaceChildren(...omitted.map((t) => el('li', '', t)));
}

async function renderFound(seg) {
  els.found.replaceChildren();
  for (const p of seg.photos) {
    const crops = seg.crops.filter((c) => c.photo_index === p.index && c.box);
    const img = await loadImage(state.photos[p.index].dataUrl);
    const canvas = el('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    g.lineWidth = Math.max(3, img.width / 200);
    g.font = `600 ${Math.max(16, img.width / 40)}px system-ui, sans-serif`;
    for (const c of crops) {
      const sx = img.width / c.box.w;
      const sy = img.height / c.box.h;
      g.strokeStyle = '#e4572e';
      g.strokeRect(c.box.x1 * sx, c.box.y1 * sy, (c.box.x2 - c.box.x1) * sx, (c.box.y2 - c.box.y1) * sy);
      const label = `${c.concept} ${Math.round(c.box.confidence * 100)}%`;
      const tw = g.measureText(label).width + 12;
      g.fillStyle = '#e4572e';
      g.fillRect(c.box.x1 * sx, c.box.y1 * sy, tw, Math.max(24, img.width / 30));
      g.fillStyle = '#fff';
      g.fillText(label, c.box.x1 * sx + 6, c.box.y1 * sy + Math.max(18, img.width / 40));
    }
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${p.alt}. ${crops.length ? `Found: ${crops.map((c) => c.concept).join(', ')}` : 'No products cut out'}`);
    const wrap = el('figure');
    wrap.style.margin = '0';
    const role = { shopfront: 'Shop front', products: 'Products', interior: 'Inside the shop', owner: 'Owner', other: 'Other' }[p.role];
    wrap.append(canvas, el('figcaption', 'cap', `${role} · ${p.usable ? (crops.length ? `SAM 3.1 found ${crops.length}` : 'used as a full photo') : 'not used (unclear)'}`));
    els.found.append(wrap);
  }
  els.foundWrap.hidden = !seg.photos.length;
}

// ---------- clarification ----------

function askQuestions(result, signText) {
  return new Promise((resolve) => {
    els.questions.replaceChildren(...result.clarifications.map((c) => {
      const fs = el('fieldset', 'q');
      fs.dataset.field = c.field;
      fs.append(el('legend', '', c.question));
      if (c.heard) fs.append(el('p', 'heard', `We heard: ${c.heard}`));
      const opts = el('div', 'opts-row');
      for (const o of c.options) {
        const b = el('button', 'opt', o);
        b.type = 'button';
        b.dataset.value = o;
        b.setAttribute('aria-pressed', 'false');
        if (c.field === 'business_name' && o === signText) b.append(el('span', 'src', '(from your photo)'));
        b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          opts.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', String(on));
          if (on) fs.querySelector('input').value = '';
        });
        opts.append(b);
      }
      if (c.options.length) fs.append(opts);
      const id = `ans-${c.field}`;
      const label = el('label', 'small muted', c.options.length ? 'Or type your answer' : 'Your answer');
      label.htmlFor = id;
      const input = el('input');
      input.id = id;
      input.type = c.field === 'phone' || c.field === 'whatsapp' ? 'tel' : 'text';
      if (input.type === 'tel') input.inputMode = 'tel';
      input.autocomplete = 'off';
      input.addEventListener('input', () => opts.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-pressed', 'false')));
      fs.append(label, input);
      return fs;
    }));
    els.clarifyCard.hidden = false;
    els.clarifyCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    els.clarifyForm.onsubmit = (e) => {
      e.preventDefault();
      const answers = [...els.questions.querySelectorAll('.q')].map((fs) => {
        const picked = fs.querySelector('.opt[aria-pressed="true"]');
        const typed = fs.querySelector('input').value.trim();
        if (picked) return { field: fs.dataset.field, via: 'option', answer: picked.dataset.value };
        if (typed) return { field: fs.dataset.field, via: 'text', answer: typed };
        return { field: fs.dataset.field, via: 'skip', answer: null };
      });
      els.clarifyCard.hidden = true;
      resolve(answers);
    };
  });
}

// ---------- preview + verification ----------

function fitPhone() {
  const inner = els.phone.clientWidth - 20;
  const scale = Math.min(1, inner / PREVIEW_WIDTH);
  els.frame.style.transform = scale < 1 ? `scale(${scale})` : '';
  els.phone.style.height = `${640 * scale + 20}px`;
}
window.addEventListener('resize', fitPhone);

/** Renders the real draft in a 360px frame and measures it. */
function loadAndMeasure(src) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The preview took too long to load')), 30000);
    els.frame.onload = async () => {
      clearTimeout(timeout);
      const doc = els.frame.contentDocument;
      const win = els.frame.contentWindow;
      // Lazy images never load off-screen; they carry width/height so layout is already final. Wait for eager ones, capped.
      const eager = [...doc.images].filter((img) => img.loading !== 'lazy' && !img.complete);
      await Promise.race([
        Promise.all(eager.map((img) => new Promise((r) => { img.onload = img.onerror = r; }))),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      await new Promise((r) => win.requestAnimationFrame(() => r()));
      const width = win.innerWidth;
      const overflowing = [...doc.body.querySelectorAll('*')]
        .filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.right > width + 0.5 || b.left < -0.5); })
        .map((n) => `${n.tagName.toLowerCase()}${n.className ? `.${String(n.className).split(' ')[0]}` : ''}`);
      resolve({ viewport_width: width, scroll_width: doc.documentElement.scrollWidth, overflowing: [...new Set(overflowing)] });
    };
    els.frame.src = src;
  });
}

function renderChecks(checks) {
  els.checks.replaceChildren(...checks.map((c) => {
    const li = el('li', c.passed ? 'pass' : 'fail', c.label);
    if (c.detail) li.append(el('span', 'detail', c.detail));
    return li;
  }));
}

// ---------- main pipeline ----------

els.go.addEventListener('click', run);

async function run() {
  if (!state.audioBlob) return;
  els.input.hidden = true;
  els.progress.hidden = false;
  els.error.hidden = true;
  els.retry.hidden = true;
  ['convert', 'transcribe', 'extract', 'segment', 'generate', 'verify'].forEach((s) => setStep(s, null));
  let current = 'convert';

  try {
    setStep('convert', 'active');
    const { wav, seconds } = await toWav16k(state.audioBlob);
    if (seconds > MAX_SECONDS + 2) throw new Error(`This voice note is ${Math.round(seconds)} seconds. Please keep it under 60 seconds.`);
    setStep('convert', 'done');

    current = 'transcribe';
    setStep('transcribe', 'active');
    const asr = await post('/api/transcribe', { audio_wav_base64: await blobToBase64(wav) });
    setStep('transcribe', 'done');

    current = 'extract';
    setStep('extract', 'active');
    const extraction = await post('/api/extract', { transcript: asr.transcript });
    setStep('extract', 'done');

    els.transcript.textContent = asr.transcript;
    els.langLine.textContent = `${LANG_LABELS[extraction.language_detected]} · ${asr.duration_sec}s`;
    renderFacts(extraction);
    els.results.hidden = false;

    // Photos are analysed while the owner answers questions.
    current = 'segment';
    setStep('segment', 'active');
    const segPromise = state.photos.length
      ? post('/api/segment', { photos: state.photos.map((p) => p.dataUrl), services: extraction.services })
      : Promise.resolve(null);

    let final = extraction;
    if (extraction.clarifications.length) {
      // A legible signboard is a real source for the name: offer it as a tap option.
      // Only then do we wait for photo analysis before asking; otherwise questions show immediately.
      const needsName = extraction.clarifications.some((c) => c.field === 'business_name');
      const seg = needsName ? await segPromise.catch(() => null) : null;
      const ask = structuredClone(extraction);
      const sign = seg?.sign_text;
      const nameQ = ask.clarifications.find((c) => c.field === 'business_name');
      if (nameQ && sign && !nameQ.options.includes(sign)) nameQ.options = [sign, ...nameQ.options].slice(0, 3);
      const answers = await askQuestions(ask, sign);
      current = 'extract';
      setStep('extract', 'active');
      final = await post('/api/clarify', { result: ask, answers });
      setStep('extract', 'done');
      renderFacts(final);
      if (!final.publishable) {
        setStep('segment', null);
        els.progress.hidden = true;
        const missing = final.blocked_by.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ');
        els.blockedText.textContent = `Without a confirmed ${missing}, we won't put up a site, because we never guess. Please record again and say it clearly.`;
        els.blockedCard.hidden = false;
        els.blockedCard.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }

    current = 'segment';
    const seg = await segPromise.catch(() => null); // segmentation is garnish: on failure we just continue
    setStep('segment', 'done');
    let hero = null;
    let cards = [];
    if (seg) {
      await renderFound(seg);
      if (seg.hero_photo_index !== null) {
        const p = seg.photos[seg.hero_photo_index];
        hero = { image: state.photos[p.index].dataUrl, alt: p.alt };
      }
      cards = await Promise.all(seg.crops.map(async (c) => ({
        image: await cropToDataUrl(state.photos[c.photo_index], c.box),
        alt: seg.photos[c.photo_index].alt,
        label: c.label,
        service: c.service,
      })));
    }

    current = 'generate';
    els.imageModel.hidden = Boolean(hero);
    setStep('generate', 'active');
    const gen = await post('/api/generate', { result: final, hero, cards });
    setStep('generate', 'done');
    state.slug = gen.slug;

    current = 'verify';
    setStep('verify', 'active');
    els.previewCard.hidden = false;
    fitPhone();
    els.checks.replaceChildren(el('li', 'pending', 'Rendering at 360px…'));
    state.layout = await loadAndMeasure(gen.preview_url);
    const v = await post('/api/verify', { slug: gen.slug, layout: state.layout });
    renderChecks(v.checks);
    setStep('verify', v.passed ? 'done' : 'failed');
    els.publish.disabled = !v.passed;
    els.previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!v.passed) showError('Verification found a problem, so this site will not be published.');
    else els.progress.hidden = true;
  } catch (err) {
    setStep(current, 'failed');
    showError(err.message);
  }
}

els.publish.addEventListener('click', async () => {
  els.publish.disabled = true;
  els.publish.textContent = 'Publishing…';
  try {
    const r = await post('/api/publish', { slug: state.slug, layout: state.layout });
    renderChecks(r.checks);
    els.liveLink.href = r.url;
    els.liveLink.textContent = r.url.replace(/^https?:\/\//, '');
    els.shareBtn.hidden = false;
    els.doneCard.hidden = false;
    els.doneCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.publish.textContent = 'Published';
  } catch (err) {
    if (err.details?.checks) renderChecks(err.details.checks);
    els.publish.textContent = 'Publish';
    showError(err.message);
  }
});

els.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.liveLink.href);
    els.copyBtn.textContent = 'Copied';
  } catch {
    els.copyBtn.textContent = 'Press and hold the link to copy';
  }
});

els.shareBtn.addEventListener('click', () => {
  window.open(`https://wa.me/?text=${encodeURIComponent(`Meri dukaan ki website: ${els.liveLink.href}`)}`, '_blank', 'noopener');
});

function restart() {
  window.location.reload();
}
document.querySelectorAll('.restart').forEach((b) => b.addEventListener('click', restart));
els.retry.addEventListener('click', restart);

// Example sites: render only real, configured entries; otherwise the section stays hidden.
function renderExamples() {
  const valid = (EXAMPLES || []).filter((e) => e && e.name && typeof e.url === 'string' && /^https:\/\//.test(e.url));
  if (!valid.length) return; // section stays hidden; never shows a broken/placeholder link
  const list = $('examples-list');
  list.replaceChildren(...valid.map((e) => {
    const li = el('li');
    const a = el('a', 'example-link');
    a.href = e.url;
    a.target = '_blank';
    a.rel = 'noopener';
    // A screenshot is optional and must be a file we ship ourselves (public/img/), never a remote URL.
    if (typeof e.image === 'string' && /^\/img\/[\w.-]+\.(jpg|png|webp)$/.test(e.image)) {
      const img = el('img', 'example-shot');
      img.src = e.image;
      img.alt = e.imageAlt || `Screenshot of the ${e.name} website`;
      img.width = 360;
      img.height = 420;
      img.loading = 'lazy';
      a.append(img);
    }
    const text = el('span', 'example-text');
    text.append(el('span', 'example-name', e.name));
    if (e.category) text.append(el('span', 'example-cat', e.category));
    if (e.note) text.append(el('span', 'example-note', e.note));
    a.append(text, el('span', 'example-go', 'View site →'));
    li.append(a);
    return li;
  }));
  $('examples').hidden = false;
}
renderExamples();
