// Batch-test real voice notes end-to-end through the same code the API uses.
// Usage: npm run try-note -- samples/note1.opus samples/note2.m4a
// Any audio format ffmpeg understands. Results saved to samples/out/<name>.json (gitignored).

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { transcribeWav } from '../lib/meta.js';
import { extractFacts } from '../lib/extract.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run try-note -- <audio file> [more files]');
  process.exit(1);
}

const outDir = path.join('samples', 'out');
mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const base = path.basename(file, path.extname(file));
  const wavPath = path.join(tmpdir(), `bolsite-${base}-${Date.now()}.wav`);
  console.log(`\n=== ${file}`);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-t', '65', wavPath]);
    const wav = readFileSync(wavPath);

    let t = Date.now();
    const asr = await transcribeWav(wav);
    console.log(`transcript (${Date.now() - t} ms): ${asr.transcript}`);

    t = Date.now();
    const result = await extractFacts(asr.transcript);
    console.log(`extraction (${Date.now() - t} ms), language=${result.language_detected}, publishable=${result.publishable}`);
    for (const [field, f] of Object.entries(result.facts)) {
      const flags = f.flags.length ? ` [${f.flags.join(', ')}]` : '';
      console.log(`  ${f.status.padEnd(8)} ${field.padEnd(13)} ${String(f.confidence).padEnd(5)} ${f.value ?? '—'}${flags}`);
    }
    for (const s of result.services) console.log(`  service       ${s.name}${s.price ? ` @ ${s.price}` : ''} (${s.confidence})`);
    for (const s of result.omitted.services) console.log(`  omitted svc   ${s.name} (${s.reason}, ${s.confidence})`);
    for (const h of result.highlights) console.log(`  highlight     ${h.text} (${h.confidence})`);
    for (const c of result.clarifications) console.log(`  ASK ${c.field}: ${c.question}${c.options.length ? `  options: ${c.options.join(' | ')}` : ''}`);

    writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify({ file, transcript: asr.transcript, ...result }, null, 2));
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
  } finally {
    rmSync(wavPath, { force: true });
  }
}
