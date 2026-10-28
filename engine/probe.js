// Make It Fit — reads a picture's pixel size and EXIF orientation from its first bytes,
// without decoding it. Used on the main thread and in the worker so big phone photos can be
// decoded straight to a smaller size (a 50-megapixel photo would otherwise need ~200 MB).

const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const i32le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

function exifOrientation(b, tiff) {
  if (tiff + 8 > b.length) return 1;
  const le = b[tiff] === 0x49;
  const r16 = (o) => (le ? u16le(b, o) : u16be(b, o));
  const r32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  if (r16(tiff + 2) !== 42) return 1;
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > b.length) return 1;
  const n = r16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

function jpeg(b) {
  let p = 2, orientation = 1;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9 || m === 0xda) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = u16be(b, p + 2);
    if (len < 2) break;
    const seg = p + 4;
    if (m === 0xe1 && b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66) orientation = exifOrientation(b, seg + 6);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = u16be(b, seg + 1), w = u16be(b, seg + 3);
      return w > 0 && h > 0 ? { w, h, orientation } : null;
    }
    p += 2 + len;
  }
  return null;
}

/** Returns { w, h, orientation, ow, oh } (ow/oh = size as displayed) or null when unknown. */
export function probeImage(b) {
  if (!b || b.length < 30) return null;
  let r = null;
  if (b[0] === 0xff && b[1] === 0xd8) r = jpeg(b);
  else if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) r = { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0, orientation: 1 };
  else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) r = { w: u16le(b, 6), h: u16le(b, 8), orientation: 1 };
  else if (b[0] === 0x42 && b[1] === 0x4d) r = { w: Math.abs(i32le(b, 18)), h: Math.abs(i32le(b, 22)), orientation: 1 };
  else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8X') r = { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1, orientation: 1 };
    else if (tag === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) r = { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff, orientation: 1 };
    else if (tag === 'VP8L' && b[20] === 0x2f) r = { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)), orientation: 1 };
  }
  if (!r || !(r.w > 0 && r.h > 0) || r.w > 100000 || r.h > 100000) return null;
  const swap = r.orientation >= 5;
  return { ...r, ow: swap ? r.h : r.w, oh: swap ? r.w : r.h };
}

/** Reads enough of a file to probe it (EXIF + frame header live near the start). */
export async function probeFile(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 524288).arrayBuffer());
    return probeImage(head);
  } catch { return null; }
}

/**
 * Decodes a picture, upright, with its longest side at most maxSide pixels.
 * Decoding straight to the smaller size keeps memory low on phones.
 */
export async function decodeCapped(blob, maxSide, probe) {
  const p = probe === undefined ? await probeFile(blob) : probe;
  let bmp;
  if (p && Math.max(p.ow, p.oh) > maxSide) {
    const opts = { imageOrientation: 'from-image', resizeQuality: 'high' };
    if (p.ow >= p.oh) opts.resizeWidth = maxSide; else opts.resizeHeight = maxSide;
    bmp = await createImageBitmap(blob, opts);
  } else {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  }
  const L = Math.max(bmp.width, bmp.height);
  if (L > maxSide) {
    const k = maxSide / L;
    const small = await createImageBitmap(bmp, { resizeWidth: Math.max(1, Math.round(bmp.width * k)), resizeHeight: Math.max(1, Math.round(bmp.height * k)), resizeQuality: 'high' });
    bmp.close();
    bmp = small;
  }
  return bmp;
}
