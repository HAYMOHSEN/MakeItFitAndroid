// Make It Fit — reaches a form's MINIMUM size. Some upload portals reject files that are too
// small. When a finished file is below the minimum, harmless filler is added inside the file
// format's own comment space, so every viewer and portal still reads the picture/PDF as normal:
//   JPEG: COM (comment) segments before the image data
//   PNG:  a tEXt chunk before the end
//   PDF:  an unused stream object
import { PDFDocument, PDFName, PDFRawStream } from '../lib/pdf-lib.min.js';

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
function crc32(buf, crc = -1) { for (let i = 0; i < buf.length; i++) crc = CRC[(crc ^ buf[i]) & 255] ^ (crc >>> 8); return crc; }

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function padJpeg(b, add) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  // Insert before the first SOS marker (FFDA), after all header segments.
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xda) break;
    if (m === 0xd9) return null;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
  if (p + 4 > b.length || b[p + 1] !== 0xda) return null;
  const segs = [];
  let left = Math.max(5, add);
  while (left > 0) {
    const data = Math.max(1, Math.min(65533, left - 4));
    const seg = new Uint8Array(4 + data).fill(0x20);
    seg[0] = 0xff; seg[1] = 0xfe; seg[2] = ((data + 2) >> 8) & 255; seg[3] = (data + 2) & 255;
    segs.push(seg);
    left -= 4 + data;
  }
  return concat([b.subarray(0, p), ...segs, b.subarray(p)]);
}

function padPng(b, add) {
  if (b[0] !== 0x89 || b[1] !== 0x50) return null;
  const iend = b.length - 12;
  if (iend < 8 || String.fromCharCode(b[iend + 4], b[iend + 5], b[iend + 6], b[iend + 7]) !== 'IEND') return null;
  const key = new TextEncoder().encode('Comment\0');
  const textLen = Math.max(1, add - 12 - key.length);
  const data = new Uint8Array(key.length + textLen).fill(0x20);
  data.set(key, 0);
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4); // tEXt
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(chunk.subarray(4, 8 + data.length)) ^ -1) >>> 0);
  return concat([b.subarray(0, iend), chunk, b.subarray(iend)]);
}

async function padPdf(b, add) {
  const doc = await PDFDocument.load(b, { updateMetadata: false, ignoreEncryption: false });
  const filler = new Uint8Array(Math.max(1, add)).fill(0x20);
  const ref = doc.context.register(PDFRawStream.of(doc.context.obj({}), filler));
  doc.catalog.set(PDFName.of('MakeItFitPadding'), ref);
  // PDF/A-1 forbids object streams; keep such files compliant.
  const text = new TextDecoder('latin1').decode(b);
  const pdfa1 = /pdfaid:part(?:\s*=\s*["']|>)\s*1\b/.test(text);
  return doc.save({ useObjectStreams: !pdfa1, addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: Infinity });
}

/**
 * Returns a Blob of at least minBytes (and at most maxBytes), or null when this file type
 * can't be padded safely. The filler is a few bytes over the minimum on purpose.
 */
export async function padToMin(blob, minBytes, maxBytes) {
  const size = blob.size;
  if (size >= minBytes) return blob;
  const b = new Uint8Array(await blob.arrayBuffer());
  const type = blob.type;
  let out = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const add = minBytes - (out ? out.length : size) + 32 + attempt * 64;
    const src = out || b;
    if (type === 'image/jpeg') out = padJpeg(src, add);
    else if (type === 'image/png') out = padPng(src, add);
    else if (type === 'application/pdf') { try { out = await padPdf(src, add); } catch { out = null; } }
    if (!out) return null;
    if (out.length >= minBytes) break;
  }
  if (!out || out.length < minBytes || (maxBytes && out.length > maxBytes)) return null;
  return new Blob([out], { type });
}
