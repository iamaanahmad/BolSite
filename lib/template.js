// The one BolSite template. Mobile-first, no JavaScript, every value escaped.
// Sections render only when their facts exist: nothing on this page is filler.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatPhone(e164) {
  const d = e164.replace(/\D/g, '').slice(-10);
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

const pair = (b, cls = '') => {
  if (!b) return '';
  if (!b.hi || b.hi.trim() === b.en.trim()) return `<span class="${cls}">${esc(b.en)}</span>`;
  return `<span class="${cls}">${esc(b.en)}</span><span class="${cls} hi" lang="hi">${esc(b.hi)}</span>`;
};

const heading = (en, hi) => `<h2>${esc(en)} <span class="hi" lang="hi">· ${esc(hi)}</span></h2>`;

const CSS = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fbf7f0;color:#1d1a16;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;padding-bottom:84px;overflow-wrap:anywhere}
img{max-width:100%;display:block}
.wrap{max-width:640px;margin:0 auto}
.hero{position:relative;aspect-ratio:4/3;background:#e8e1d6;overflow:hidden}
.hero img{width:100%;height:100%;object-fit:cover}
.ai-label{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.72);color:#fff;font-size:12px;padding:3px 9px;border-radius:999px}
header{padding:18px 16px 6px}
h1{margin:0;font-size:1.9rem;line-height:1.15;letter-spacing:-.01em}
.native{display:block;font-size:1.15rem;color:#6b645a;margin-top:2px}
.cat{display:inline-block;margin-top:10px;background:#fde6dc;color:#a83a17;padding:2px 10px;border-radius:999px;font-size:.9rem}
.cat .hi::before{content:" · "}
.tagline{margin:12px 0 0;font-size:1.1rem}
.tagline span,.about p span{display:block}.tagline .hi,.about p .hi{color:#6b645a}
.about p .hi{margin-top:6px}
.info a{color:#a83a17;font-weight:600}
section{padding:14px 16px;border-top:1px solid #e8e1d6}
h2{font-size:1rem;margin:0 0 10px}h2 .hi{color:#6b645a;font-weight:500}
.about p{margin:0}
.svc{list-style:none;margin:0;padding:0}
.svc li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px dashed #e8e1d6}
.svc li:last-child{border-bottom:0}
.svc .n span{display:block}.svc .n .hi{color:#6b645a;font-size:.9rem}
.price{font-weight:700;white-space:nowrap;color:#a83a17}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{background:#fff;border:1px solid #e8e1d6;border-radius:12px;overflow:hidden;margin:0}
.card img{width:100%;height:auto;aspect-ratio:1/1;object-fit:cover}
.card figcaption{padding:8px 10px;font-size:.9rem}
.card figcaption span{display:block}.card .hi{color:#6b645a;font-size:.85rem}
.info{list-style:none;margin:0;padding:0}
.info li{padding:6px 0}.info li span{display:block}.info .hi{color:#6b645a}
.info .label{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:#6b645a}
.maps{display:inline-block;margin-top:6px;color:#a83a17;font-weight:600}
.hl{margin:0;padding-left:18px}.hl li{margin:4px 0}.hl .hi{display:block;color:#6b645a}
footer{padding:20px 16px 28px;color:#6b645a;font-size:.85rem;border-top:1px solid #e8e1d6}
footer p{margin:0 0 6px}
.cta{position:fixed;left:0;right:0;bottom:0;display:flex;gap:10px;padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:rgba(251,247,240,.96);border-top:1px solid #e8e1d6}
.cta a{flex:1;display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:12px;font-weight:700;text-decoration:none;font-size:1.05rem}
.call{background:#e4572e;color:#fff}.wa{background:#1f8a4c;color:#fff}
a:focus-visible{outline:3px solid #1d1a16;outline-offset:2px}
`;

/**
 * site = {
 *   slug, name: { latin, native }, category: {en,hi}, tagline: {en,hi}|null, about: {en,hi}|null,
 *   phone, whatsapp|null, address: {en,hi}|null, mapsUrl|null, hours: {en,hi}|null,
 *   services: [{ name: {en,hi}, price|null }], highlights: [{en,hi}],
 *   hero: { src, ai, alt }|null, cards: [{ src, alt, label: {en,hi}|null, price|null }], canonicalUrl|null
 * }
 */
export function renderSite(site) {
  const title = `${site.name.latin} · ${site.category.en}`;
  const desc = site.tagline?.en || `${site.category.en}${site.address ? ` · ${site.address.en}` : ''}`;
  const phoneDisplay = formatPhone(site.phone);
  const showNative = site.name.native && site.name.native.trim() !== site.name.latin.trim();
  const ogImage = site.hero && site.canonicalUrl ? `${site.canonicalUrl}/${site.hero.src.split('/').pop()}` : null;

  const hero = site.hero
    ? `<div class="hero"><img src="${esc(site.hero.src)}" alt="${esc(site.hero.alt)}" width="1024" height="768">${site.hero.ai ? '<span class="ai-label">AI-generated image · AI से बनी तस्वीर</span>' : ''}</div>`
    : '';

  const about = site.about
    ? `<section class="about">${heading('About', 'हमारे बारे में')}<p>${pair(site.about)}</p></section>`
    : '';

  const services = site.services.length
    ? `<section>${heading('Services & prices', 'सेवाएँ और दाम')}<ul class="svc">${site.services
        .map((s) => `<li><span class="n">${pair(s.name)}</span>${s.price ? `<span class="price">${esc(s.price)}</span>` : ''}</li>`)
        .join('')}</ul></section>`
    : '';

  const cards = site.cards.length
    ? `<section>${heading('Photos', 'तस्वीरें')}<div class="cards">${site.cards
        .map((c) => `<figure class="card"><img src="${esc(c.src)}" alt="${esc(c.alt)}" loading="lazy" width="600" height="600">${c.label || c.price ? `<figcaption>${pair(c.label)}${c.price ? `<span class="price">${esc(c.price)}</span>` : ''}</figcaption>` : ''}</figure>`)
        .join('')}</div></section>`
    : '';

  const highlights = site.highlights.length
    ? `<section>${heading('Good to know', 'खास बातें')}<ul class="hl">${site.highlights.map((h) => `<li>${pair(h)}</li>`).join('')}</ul></section>`
    : '';

  const infoItems = [
    site.hours ? `<li><span class="label">Hours · समय</span>${pair(site.hours)}</li>` : '',
    site.address ? `<li><span class="label">Address · पता</span>${pair(site.address)}${site.mapsUrl ? `<a class="maps" href="${esc(site.mapsUrl)}" rel="noopener">Open in Maps · नक्शे में देखें</a>` : ''}</li>` : '',
    `<li><span class="label">Phone · फ़ोन</span><a href="tel:${esc(site.phone)}">${esc(phoneDisplay)}</a></li>`,
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
${site.canonicalUrl ? `<link rel="canonical" href="${esc(site.canonicalUrl)}">` : ''}
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
${hero}
<header>
<h1>${esc(site.name.latin)}${showNative ? `<span class="native" lang="hi">${esc(site.name.native)}</span>` : ''}</h1>
<span class="cat">${pair(site.category)}</span>
${site.tagline ? `<p class="tagline">${pair(site.tagline)}</p>` : ''}
</header>
${about}
${services}
${cards}
${highlights}
<section>${heading('Visit or call', 'आइए या फ़ोन करें')}<ul class="info">${infoItems}</ul></section>
<footer>
<p>Every detail on this page comes from the owner's own voice note.</p>
<p lang="hi">इस पेज की हर जानकारी मालिक की अपनी आवाज़ से ली गई है।</p>
<p>Made with BolSite</p>
</footer>
</div>
<nav class="cta" aria-label="Contact">
<a class="call" href="tel:${esc(site.phone)}">Call · फ़ोन करें</a>
${site.whatsapp ? `<a class="wa" href="https://wa.me/${esc(site.whatsapp.replace(/\D/g, ''))}" rel="noopener">WhatsApp</a>` : ''}
</nav>
</body>
</html>`;
}
