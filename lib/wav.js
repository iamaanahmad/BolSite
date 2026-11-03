// Minimal RIFF/WAVE header validation so we fail fast with a clear message
// instead of a vague 400 from the ASR endpoint.

export function inspectWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, reason: 'Audio is not a WAV file' };
  }
  let offset = 12;
  let fmt = null;
  let dataBytes = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || dataBytes === null) return { ok: false, reason: 'WAV file is missing fmt or data chunk' };
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) return { ok: false, reason: 'WAV must be 16-bit integer PCM' };
  if (fmt.channels !== 1) return { ok: false, reason: 'WAV must be mono' };
  if (fmt.sampleRate !== 16000 && fmt.sampleRate !== 24000) return { ok: false, reason: 'WAV must be 16 kHz or 24 kHz' };

  const durationSec = dataBytes / (fmt.sampleRate * 2);
  return { ok: true, ...fmt, durationSec };
}
