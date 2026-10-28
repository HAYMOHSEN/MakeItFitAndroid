// Make It Fit — photo engine (runs inside the processing worker).
// Finds the best-quality version of a photo that is smaller than a byte limit.

import { probeImage, decodeCapped } from './probe.js';
import { preparePhoto, normCrop } from './prepare.js';
import { padToMin } from './pad.js';

export class EngineError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const extFor = (mime) => EXT[mime] || 'jpg';

export function normalizeMime(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg';
  return t;
}

// ---------- JPEG helpers (lossless metadata cleanup) ----------

function readExifOrientation(b, tiff) {
  if (tiff + 8 > b.length) return 1;
  const le = b[tiff] === 0x49;
  const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) =>
    (le
      ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
      : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (u16(tiff + 2) !== 42) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > b.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

const isExif = (b, p) => b[p] === 0x45 && b[p + 1] === 0x78 && b[p + 2] === 0x69 && b[p + 3] === 0x66 && b[p + 4] === 0;
const isAdobe = (b, p) => b[p] === 0x41 && b[p + 1] === 0x64 && b[p + 2] === 0x6f && b[p + 3] === 0x62 && b[p + 4] === 0x65;
const isIcc = (b, p) => b[p] === 0x49 && b[p + 1] === 0x43 && b[p + 2] === 0x43 && b[p + 3] === 0x5f; // "ICC_"

// Basic facts about a JPEG: EXIF orientation, colour components, Adobe marker.
export function jpegInfo(b) {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  let orientation = 1;
  let components = 0;
  let adobe = false;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9 || m === 0xda) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) break;
    const seg = p + 4;
    if (m === 0xe1 && isExif(b, seg)) orientation = readExifOrientation(b, seg + 6);
    if (m === 0xee && isAdobe(b, seg)) adobe = true;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) components = b[seg + 5];
    p += 2 + len;
  }
  return { orientation, components, adobe };
}

function minimalExif(orientation) {
  // APP1 "Exif" segment holding only the Orientation tag (big-endian TIFF).
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

// Removes location, camera and editing data from a JPEG without re-encoding it.
// Keeps colour profile, JFIF/Adobe headers and the orientation. Returns null if unsure.
export function cleanJpeg(b, orientation) {
  if (!b || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts = [b.subarray(0, 2)];
  if (orientation && orientation !== 1) parts.push(minimalExif(orientation));
  let p = 2;
  let ended = false;
  while (p + 2 <= b.length) {
    if (b[p] !== 0xff) { p++; continue; } // stray bytes between segments: skip them, as decoders do
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9) { parts.push(b.subarray(p, p + 2)); ended = true; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { parts.push(b.subarray(p, p + 2)); p += 2; continue; }
    if (p + 4 > b.length) return null;
    const len = (b[p + 2] << 8) | b[p + 3];
    const end = p + 2 + len;
    if (len < 2 || end > b.length) return null;
    if (m === 0xda) {
      // Start of scan: copy header and entropy-coded data up to the next real marker.
      let q = end;
      while (q + 1 < b.length) {
        if (b[q] === 0xff) {
          const n = b[q + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) { q += n === 0xff ? 1 : 2; continue; }
          break;
        }
        q++;
      }
      parts.push(b.subarray(p, q));
      p = q;
      continue;
    }
    const keep =
      m === 0xe0 || m === 0xee || (m === 0xe2 && isIcc(b, p + 4)) || ((m < 0xe0 || m > 0xef) && m !== 0xfe);
    if (keep) parts.push(b.subarray(p, end));
    p = end;
  }
  if (!ended) return null;
  let total = 0;
  for (const x of parts) total += x.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

// Removes text, time and EXIF chunks (where camera and location details live) from a PNG.
export function cleanPng(b) {
  if (!b || b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const drop = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  const parts = [b.subarray(0, 8)];
  let p = 8, removed = false;
  while (p + 12 <= b.length) {
    const len = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const end = p + 12 + len;
    if (end > b.length) return null;
    if (drop.has(type)) removed = true; else parts.push(b.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  if (!removed) return b;
  let total = 0;
  for (const x of parts) total += x.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

// Removes the EXIF and XMP chunks from a WebP (extended format) and clears their flags.
export function cleanWebp(b) {
  if (!b || b.length < 20 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF' || String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'WEBP') return null;
  const parts = [];
  let p = 12, removed = false;
  while (p + 8 <= b.length) {
    const tag = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24)) >>> 0;
    const end = p + 8 + size + (size & 1);
    if (end > b.length + 1) return null;
    if (tag === 'EXIF' || tag === 'XMP ') removed = true;
    else if (tag === 'VP8X') { const c = b.slice(p, Math.min(end, b.length)); c[8] &= ~0x0c; parts.push(c); }
    else parts.push(b.subarray(p, Math.min(end, b.length)));
    p = end;
  }
  if (!removed) return b;
  let total = 12;
  for (const x of parts) total += x.length;
  const out = new Uint8Array(total);
  out.set(b.subarray(0, 12), 0);
  new DataView(out.buffer).setUint32(4, total - 8, true);
  let o = 12;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

// ---------- rendering ----------

export async function renderPhoto(bmp, rot, outW, outH, layout, fill) {
  const ow = rot % 180 ? bmp.height : bmp.width;
  const oh = rot % 180 ? bmp.width : bmp.height;
  let dw = outW, dh = outH, dx = 0, dy = 0;
  if (layout !== 'full') {
    const c = layout === 'cover' ? Math.max(outW / ow, outH / oh) : Math.min(outW / ow, outH / oh);
    dw = ow * c; dh = oh * c; dx = (outW - dw) / 2; dy = (outH - dh) / 2;
  }
  const sw = Math.max(1, Math.round(rot % 180 ? dh : dw));
  const sh = Math.max(1, Math.round(rot % 180 ? dw : dh));
  const src = sw === bmp.width && sh === bmp.height
    ? bmp
    : await createImageBitmap(bmp, { resizeWidth: sw, resizeHeight: sh, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d', { alpha: !fill });
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, outW, outH); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  if (src !== bmp) src.close();
  return canvas;
}

export function photoQualityLabel(q, w, h, scale, exact) {
  const L = Math.max(w, h);
  if (!exact && scale >= 0.999 && (q == null || q >= 0.75)) return 'High';
  if (exact) {
    if (q == null || q >= 0.8) return 'High';
    if (q >= 0.6) return 'Good';
    return q >= 0.45 ? 'Fair' : 'Low';
  }
  if ((q == null || q >= 0.75) && L >= 1600) return 'High';
  if ((q == null || q >= 0.6) && L >= 1000) return 'Good';
  if ((q == null || q >= 0.45) && L >= 600) return 'Fair';
  return 'Low';
}

// True when the decoded picture has any transparent pixels (checked on a small copy).
async function detectAlpha(bmp) {
  const k = Math.min(1, 384 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

const Q_TOP = 0.92;
const Q_GOOD = 0.6;
const Q_SCALE = 0.78;
// Phones: pictures are decoded and written at most this many pixels on the longest side
// (16.7 megapixels), which keeps memory safe on low-end devices and is far more than any
// upload form needs.
export const MAX_SIDE = 4096;

const dim = (v, k) => Math.max(1, Math.round(v * k));
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

/**
 * Fit one photo under o.limit bytes.
 * o = { limit, mime, resize: {mode:'none'|'max'|'exact', w, h, fit:'crop'|'pad'}, rotate, crop, clean, strong, privacy }
 */
async function fitPhotoCore(blob, o, report, ctx) {
  const srcMime = normalizeMime(blob.type);
  const head = new Uint8Array(await blob.slice(0, 524288).arrayBuffer());
  const probe = probeImage(head);
  let srcBytes = null;
  let info = null;
  if (srcMime === 'image/jpeg' || srcMime === 'image/png' || srcMime === 'image/webp') {
    srcBytes = new Uint8Array(await blob.arrayBuffer());
    if (srcMime === 'image/jpeg') info = jpegInfo(srcBytes);
  }
  let bmp;
  try {
    bmp = await decodeCapped(blob, MAX_SIDE, probe);
  } catch {
    throw new EngineError('IMAGE_DECODE');
  }
  ctx.release = () => { try { bmp.close(); } catch { /* already closed */ } };
  try {
    const rot0 = (((Number(o.rotate) || 0) % 360) + 360) % 360;
    const crop = normCrop(o.crop);
    const clean = o.clean === 'signature' || o.clean === 'document' ? o.clean : null;
    const gray = !!o.gray;
    const capped = !!(probe && Math.max(probe.ow, probe.oh) > Math.max(bmp.width, bmp.height) + 1);
    const opaqueSource = srcMime === 'image/jpeg' || srcMime === 'image/bmp';
    const alpha0 = opaqueSource || clean ? false : await detectAlpha(bmp);
    if (rot0 || crop || clean || gray) {
      report(0.03, clean ? 'cleaning' : 'preparing');
      const prepared = await preparePhoto(bmp, { rotate: rot0, crop, clean, gray, keepAlpha: alpha0 });
      bmp.close();
      bmp = prepared;
    }
    const rot = 0;
    const ow = bmp.width;
    const oh = bmp.height;
    const mode = (o.resize && o.resize.mode) || 'none';
    const exact = mode === 'exact';
    let baseW, baseH, layout = 'full';
    let tooBigExact = false;
    if (exact) {
      baseW = clampInt(o.resize.w, 16, 8192);
      baseH = clampInt(o.resize.h, 16, 8192);
      // Phones can't safely hold more than ~16.7 megapixels; scale the target down if asked for more.
      if (baseW * baseH > MAX_SIDE * MAX_SIDE) {
        const k = Math.sqrt((MAX_SIDE * MAX_SIDE) / (baseW * baseH));
        baseW = Math.max(16, Math.floor(baseW * k)); baseH = Math.max(16, Math.floor(baseH * k));
        tooBigExact = true;
      }
      layout = o.resize.fit === 'pad' ? 'contain' : 'cover';
    } else {
      let s = 1;
      if (mode === 'max') {
        if (Number(o.resize.w) > 0) s = Math.min(s, o.resize.w / ow);
        if (Number(o.resize.h) > 0) s = Math.min(s, o.resize.h / oh);
      }
      s = Math.min(s, MAX_SIDE / Math.max(ow, oh));
      baseW = dim(ow, s);
      baseH = dim(oh, s);
    }
    const alpha = alpha0;
    const userChange = rot0 !== 0 || !!crop || !!clean || gray || exact || baseW !== ow || baseH !== oh;
    let mime = o.mime;
    const minB = Math.max(0, Number(o.minBytes) || 0);
    // Formats that can't be padded to a minimum, and AVIF (rarely accepted, may hold location
    // data), are rewritten as JPG/PNG instead of being kept.
    const keepable = blob.size <= o.limit && srcMime !== 'image/avif' && !(minB && blob.size < minB && srcMime !== 'image/jpeg' && srcMime !== 'image/png');
    if (!mime || mime === 'auto') {
      if (!userChange && keepable) mime = srcMime;
      else if (alpha) mime = srcMime === 'image/webp' && !minB ? 'image/webp' : 'image/png';
      else mime = 'image/jpeg';
    }
    // Keep the original when nothing was asked for and it already fits (even if it is larger
    // than the size this phone can decode at full resolution).
    const needsTransform = userChange || mime !== srcMime;
    const notes = [];
    if (mime !== srcMime) notes.push('converted');
    if (alpha && mime === 'image/jpeg') notes.push('transparencyWhite');
    if (clean === 'signature') notes.push('cleanedSignature');
    if (clean === 'document') notes.push('cleanedDocument');
    if (crop) notes.push('cropped');
    if (gray) notes.push('gray');
    if ((capped && !exact) || tooBigExact) notes.push('resized');

    if (!needsTransform && blob.size <= o.limit) {
      const dw = probe ? probe.ow : ow, dh = probe ? probe.oh : oh;
      if (srcBytes && o.privacy) {
        const cleaned = srcMime === 'image/jpeg' ? cleanJpeg(srcBytes, (info && info.orientation) || 1) : srcMime === 'image/png' ? cleanPng(srcBytes) : cleanWebp(srcBytes);
        if (cleaned && cleaned.length <= blob.size) {
          return { blob: cleaned === srcBytes ? blob : new Blob([cleaned], { type: mime }), fits: true, kept: true, width: dw, height: dh, quality: 'Original', mime, notes: ['cleaned'] };
        }
      }
      return { blob, fits: true, kept: true, width: dw, height: dh, quality: 'Original', mime, notes: [] };
    }

    const fill = mime === 'image/jpeg' || !alpha ? '#FFFFFF' : null;
    const limit = o.limit;
    // Never shrink below a minimum resolution the form asks for ("at least 600 x 600 pixels").
    const minW = Math.max(0, Number(o.resize && o.resize.minW) || 0), minH = Math.max(0, Number(o.resize && o.resize.minH) || 0);
    const kRes = exact ? 0 : Math.min(1, Math.max(minW / baseW, minH / baseH, 0));
    const minSide = Math.max(o.strong ? 160 : 480, Math.ceil(kRes * Math.max(baseW, baseH)));
    const qFloor = o.strong ? 0.2 : 0.4;
    let cache = { w: 0, h: 0, c: null };
    let smallest = null;
    let steps = 0;
    const tick = () => report(Math.min(0.95, 1 - 1 / (1 + ++steps / 6)), 'bestQuality');

    const canvasFor = async (w, h) => {
      if (cache.w !== w || cache.h !== h) {
        if (cache.c) { cache.c.width = 1; cache.c.height = 1; } // free the old canvas right away
        cache = { w, h, c: await renderPhoto(bmp, rot, w, h, layout, fill) };
      }
      return cache.c;
    };
    ctx.encodeAt = async (w, h, q) => (await canvasFor(w, h)).convertToBlob(q == null ? { type: mime } : { type: mime, quality: q });
    const enc = async (w, h, q) => {
      await canvasFor(w, h);
      const b = await cache.c.convertToBlob(q == null ? { type: mime } : { type: mime, quality: q });
      if (!smallest || b.size < smallest.blob.size) smallest = { blob: b, w, h, q };
      tick();
      return b;
    };
    const fits = (b) => b.size <= limit;
    const done = (b, w, h, q, extra = []) => ({
      blob: b, fits: true, kept: false, width: w, height: h,
      quality: photoQualityLabel(q, w, h, Math.max(w / baseW, h / baseH), exact),
      q, mime, notes: [...new Set(notes.concat(extra))],
    });
    const fail = () => ({
      blob: smallest.blob, fits: false, kept: false, width: smallest.w, height: smallest.h,
      quality: photoQualityLabel(smallest.q, smallest.w, smallest.h, smallest.w / baseW, exact),
      q: smallest.q, mime, notes: notes.slice(),
    });
    const searchQ = async (w, h, lo, hi, loBlob, iters = 5) => {
      let best = { b: loBlob, q: lo };
      for (let i = 0; i < iters && hi - lo > 0.02; i++) {
        const q = Math.round(((lo + hi) / 2) * 100) / 100;
        const b = await enc(w, h, q);
        if (fits(b)) { best = { b, q }; lo = q; } else hi = q;
      }
      return best;
    };

    if (mime === 'image/png') {
      const b = await enc(baseW, baseH, null);
      if (fits(b)) return done(b, baseW, baseH, null);
      if (exact) return fail();
      const kMin = Math.min(1, minSide / Math.max(baseW, baseH));
      const bl = await enc(dim(baseW, kMin), dim(baseH, kMin), null);
      if (!fits(bl)) return fail();
      let best = { b: bl, k: kMin };
      let lo = kMin, hi = 1;
      for (let i = 0; i < 8 && hi - lo > 0.01; i++) {
        const k = (lo + hi) / 2;
        const bb = await enc(dim(baseW, k), dim(baseH, k), null);
        if (fits(bb)) { best = { b: bb, k }; lo = k; } else hi = k;
      }
      return done(best.b, dim(baseW, best.k), dim(baseH, best.k), null, ['resized']);
    }

    // Lossy formats (JPG, WebP). For big photos, predict the full-size result from a small
    // probe first, so hopeless full-size attempts are skipped (WebP encoding is slow).
    const slow = mime === 'image/webp';
    let goodSize = null;
    if (!exact && baseW * baseH > 2.5e6) {
      const kp = Math.sqrt(1.2e6 / (baseW * baseH));
      const probe = await enc(dim(baseW, kp), dim(baseH, kp), Q_GOOD);
      goodSize = (probe.size / (kp * kp)) * 0.9;
    }
    if (exact || goodSize === null || goodSize < limit * 1.6) {
      const top = await enc(baseW, baseH, Q_TOP);
      if (fits(top)) return done(top, baseW, baseH, Q_TOP);
      const good = await enc(baseW, baseH, Q_GOOD);
      goodSize = good.size;
      if (fits(good)) {
        const best = await searchQ(baseW, baseH, Q_GOOD, Q_TOP, good, slow ? 3 : 5);
        return done(best.b, baseW, baseH, best.q);
      }
    }
    if (exact) {
      const bf = await enc(baseW, baseH, qFloor);
      if (!fits(bf)) return fail();
      const best = await searchQ(baseW, baseH, qFloor, Q_GOOD, bf);
      return done(best.b, baseW, baseH, best.q, ['lowQuality']);
    }
    const kMin = Math.min(1, minSide / Math.max(baseW, baseH));
    const wMin = dim(baseW, kMin), hMin = dim(baseH, kMin);
    const bMin = await enc(wMin, hMin, Q_SCALE);
    if (fits(bMin)) {
      let best = { b: bMin, k: kMin };
      let lo = kMin, hi = 1;
      let guess = Math.sqrt(limit / goodSize) * 0.85;
      guess = Math.min(0.995, Math.max(kMin, guess));
      for (let i = 0; i < (slow ? 5 : 8) && hi - lo > (slow ? 0.025 : 0.012); i++) {
        const k = i === 0 ? guess : (lo + hi) / 2;
        const bb = await enc(dim(baseW, k), dim(baseH, k), Q_SCALE);
        if (fits(bb)) { if (k > best.k) best = { b: bb, k }; lo = k; } else hi = k;
      }
      const w = dim(baseW, best.k), h = dim(baseH, best.k);
      const refined = await searchQ(w, h, Q_SCALE, 0.9, best.b, slow ? 2 : 3);
      return done(refined.b, w, h, refined.q, ['resized']);
    }
    const bf = await enc(wMin, hMin, qFloor);
    if (fits(bf)) {
      const best = await searchQ(wMin, hMin, qFloor, Q_SCALE, bf, 5);
      return done(best.b, wMin, hMin, best.q, ['resized', 'lowQuality']);
    }
    return fail();
  } catch (e) {
    ctx.release();
    throw e;
  }
}

/**
 * Fit one photo under o.limit bytes (and, when o.minBytes is set, at or above that size).
 * o = { limit, minBytes, mime, resize: {mode:'none'|'max'|'exact', w, h, fit:'crop'|'pad'},
 *       rotate, crop, clean, gray, strong, privacy }
 */
export async function fitPhoto(blob, o, report = () => {}) {
  const auto = !o.mime || o.mime === 'auto';
  let r = await fitPhotoWithMin(blob, o, report);
  // Auto format: a transparent picture saved as PNG can't always get small enough (PNG is
  // lossless), and WebP can't be padded to a minimum. Fall back to JPG on white.
  if (auto && ((!r.fits && r.mime === 'image/png') || (r.belowMin && r.mime === 'image/webp'))) {
    const j = await fitPhotoWithMin(blob, { ...o, mime: 'image/jpeg' }, report);
    if ((j.fits && !j.belowMin) || (!r.fits && j.blob.size < r.blob.size)) {
      r = j;
    }
  }
  return r;
}

async function fitPhotoWithMin(blob, o, report) {
  const ctx = {};
  try {
    let r = await fitPhotoCore(blob, o, report, ctx);
    const min = Math.max(0, Math.round(Number(o.minBytes) || 0));
    if (min && r.fits && r.blob.size < min && min <= o.limit) {
      report(0.97, 'reachingMinimum');
      // First spend the spare bytes on quality, then add filler if it's still too small.
      if (!r.kept && ctx.encodeAt && (r.mime === 'image/jpeg' || r.mime === 'image/webp')) {
        for (const q of [0.95, 0.98, 1]) {
          if (r.q != null && q <= r.q) continue;
          const b = await ctx.encodeAt(r.width, r.height, q);
          if (b.size > o.limit) break;
          r = { ...r, blob: b, q };
          if (b.size >= min) break;
        }
      }
      if (r.blob.size < min) {
        const padded = await padToMin(r.blob, min, o.limit);
        r = padded ? { ...r, blob: padded, notes: [...r.notes, 'padded'] } : { ...r, belowMin: true };
      }
    }
    return r;
  } finally {
    if (ctx.release) ctx.release();
  }
}
