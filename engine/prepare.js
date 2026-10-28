// Make It Fit — prepares a decoded photo before it is shrunk: rotation, crop, and the two
// clean-up modes for pictures of paper taken with a phone camera:
//   signature: white background, darker ink, cropped to the signature
//   document:  shadows and grey paper turned white, colours kept
// Runs inside the processing worker (OffscreenCanvas).

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Normalised crop {x,y,w,h} (0..1) or null when it covers the whole picture. */
export function normCrop(c) {
  if (!c) return null;
  let x = Number(c.x), y = Number(c.y), w = Number(c.w), h = Number(c.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  x = clamp01(x); y = clamp01(y);
  w = Math.min(1 - x, Math.max(0, w)); h = Math.min(1 - y, Math.max(0, h));
  if (w < 0.01 || h < 0.01) return null;
  if (x < 0.001 && y < 0.001 && w > 0.998 && h > 0.998) return null;
  return { x, y, w, h };
}

// Estimates the colour of the paper behind every pixel (a coarse grid, smoothed), so shadows
// and uneven light can be divided out. floor: how much darker than the brightest paper a
// region may be treated as "paper" (protects photos printed on documents).
function paperGrid(d, W, H, floor) {
  const cell = Math.max(8, Math.round(Math.max(W, H) / 48));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const BINS = 32;
  const n = gw * gh;
  const cnt = new Uint32Array(n * BINS);
  const sr = new Float64Array(n * BINS), sg = new Float64Array(n * BINS), sb = new Float64Array(n * BINS);
  const step = W * H > 4e6 ? 2 : 1;
  for (let y = 0; y < H; y += step) {
    const gy = (y / cell) | 0;
    let i = y * W * 4;
    for (let x = 0; x < W; x += step, i += 4 * step) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const L = (r * 77 + g * 150 + b * 29) >> 8;
      const k = ((gy * gw + ((x / cell) | 0)) * BINS) + ((L * BINS) >> 8);
      cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
    }
  }
  // Paper colour per cell: average of the brightest ~25% of its pixels.
  const pr = new Float32Array(n), pg = new Float32Array(n), pb = new Float32Array(n), pl = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    let total = 0;
    for (let k = 0; k < BINS; k++) total += cnt[c * BINS + k];
    const want = Math.max(1, total * 0.25);
    let got = 0, r = 0, g = 0, b = 0;
    for (let k = BINS - 1; k >= 0 && got < want; k--) {
      const j = c * BINS + k;
      got += cnt[j]; r += sr[j]; g += sg[j]; b += sb[j];
    }
    if (got) { pr[c] = r / got; pg[c] = g / got; pb[c] = b / got; } else { pr[c] = pg[c] = pb[c] = 255; }
    pl[c] = 0.3 * pr[c] + 0.59 * pg[c] + 0.11 * pb[c];
  }
  // Global paper colour: the brighter cells (75th percentile and up).
  const sorted = Array.from(pl).sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)] || 255;
  let tr = 0, tg = 0, tb = 0, tn = 0;
  for (let c = 0; c < n; c++) if (pl[c] >= p75) { tr += pr[c]; tg += pg[c]; tb += pb[c]; tn++; }
  const gr = tr / tn, gg = tg / tn, gb = tb / tn;
  const gl = 0.3 * gr + 0.59 * gg + 0.11 * gb;
  // Which cells show bare paper? Paper is close to neutral and changes slowly; photos, logos
  // and solid colour areas printed on a document do not. Cells that aren't paper get the
  // paper colour of their neighbours, so their own colours are kept.
  const isPaper = new Uint8Array(n);
  const sat = (c) => Math.max(pr[c], pg[c], pb[c]) - Math.min(pr[c], pg[c], pb[c]);
  for (let c = 0; c < n; c++) isPaper[c] = pl[c] >= gl * floor && sat(c) <= 18 + 0.12 * pl[c] ? 1 : 0;
  const neighbours = (c, fn) => {
    const x = c % gw, y = (c / gw) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < gw && yy >= 0 && yy < gh) fn(yy * gw + xx);
    }
  };
  // A paper cell much darker than the paper around it is really content (e.g. a grey photo).
  const reject = [];
  for (let c = 0; c < n; c++) {
    if (!isPaper[c]) continue;
    const around = [];
    neighbours(c, (j) => { if (isPaper[j]) around.push(pl[j]); });
    if (around.length >= 3) {
      around.sort((a, b) => a - b);
      if (pl[c] < around[around.length >> 1] * 0.82) reject.push(c);
    }
  }
  for (const c of reject) isPaper[c] = 0;
  let paperCount = 0;
  for (let c = 0; c < n; c++) paperCount += isPaper[c];
  if (paperCount === 0) {
    for (let c = 0; c < n; c++) { pr[c] = gr; pg[c] = gg; pb[c] = gb; isPaper[c] = 1; }
  } else {
    let filled = new Uint8Array(isPaper);
    for (let pass = 0, missing = n - paperCount; missing > 0 && pass < gw + gh; pass++) {
      const next = new Uint8Array(filled);
      for (let c = 0; c < n; c++) {
        if (filled[c]) continue;
        let r = 0, g = 0, b = 0, m = 0;
        neighbours(c, (j) => { if (filled[j]) { r += pr[j]; g += pg[j]; b += pb[j]; m++; } });
        if (m) { pr[c] = r / m; pg[c] = g / m; pb[c] = b / m; next[c] = 1; missing--; }
      }
      filled = next;
    }
  }
  for (let c = 0; c < n; c++) {
    pr[c] = Math.max(pr[c], gr * floor, 24); pg[c] = Math.max(pg[c], gg * floor, 24); pb[c] = Math.max(pb[c], gb * floor, 24);
  }
  // Smooth the grid twice (3x3 box) so the correction never shows edges.
  const blur = (a) => {
    const o = new Float32Array(n);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += a[yy * gw + xx]; m++; }
      }
      o[y * gw + x] = s / m;
    }
    return o;
  };
  const R = blur(blur(pr)), G = blur(blur(pg)), B = blur(blur(pb));
  return { cell, gw, gh, R, G, B };
}

function cleanPixels(id, mode) {
  const { width: W, height: H, data: d } = id;
  const grid = paperGrid(d, W, H, mode === 'signature' ? 0.5 : 0.8);
  const { cell, gw, gh, R, G, B } = grid;
  const lo = mode === 'signature' ? 0.3 : 0.07;
  const hi = mode === 'signature' ? 0.84 : 0.93;
  const span = hi - lo;
  const sig = mode === 'signature';
  for (let y = 0; y < H; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const a = y0 * gw + x0, b = y0 * gw + x1, c = y1 * gw + x0, e = y1 * gw + x1;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      const br = R[a] * w00 + R[b] * w01 + R[c] * w10 + R[e] * w11;
      const bg = G[a] * w00 + G[b] * w01 + G[c] * w10 + G[e] * w11;
      const bb = B[a] * w00 + B[b] * w01 + B[c] * w10 + B[e] * w11;
      let vr = 255 * clamp01((d[i] / br - lo) / span);
      let vg = 255 * clamp01((d[i + 1] / bg - lo) / span);
      let vb = 255 * clamp01((d[i + 2] / bb - lo) / span);
      // Signatures: anything this light is paper texture or a shadow edge, not ink.
      if (sig && vr * 0.3 + vg * 0.59 + vb * 0.11 > 205) vr = vg = vb = 255;
      d[i] = vr; d[i + 1] = vg; d[i + 2] = vb;
      d[i + 3] = 255;
    }
  }
}

// Bounding box of the ink (ignores single stray specks). Returns null when nothing is found.
function inkBox(id) {
  const { width: W, height: H, data: d } = id;
  const rows = new Uint32Array(H), cols = new Uint32Array(W);
  for (let y = 0; y < H; y++) {
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 170) { rows[y]++; cols[x]++; }
    }
  }
  const minRun = 2;
  let top = 0; while (top < H && rows[top] < minRun) top++;
  let bottom = H - 1; while (bottom > top && rows[bottom] < minRun) bottom--;
  let left = 0; while (left < W && cols[left] < minRun) left++;
  let right = W - 1; while (right > left && cols[right] < minRun) right--;
  if (top >= H || left >= W) return null;
  const bw = right - left + 1, bh = bottom - top + 1;
  if (bw * bh < W * H * 0.002 || bw < 8 || bh < 4) return null;
  const m = Math.max(8, Math.round(Math.max(bw, bh) * 0.06));
  const x = Math.max(0, left - m), y = Math.max(0, top - m);
  return { x, y, w: Math.min(W, right + m + 1) - x, h: Math.min(H, bottom + m + 1) - y };
}

/**
 * Applies rotation (degrees, clockwise), crop (normalised, in the rotated picture) and
 * clean-up to a decoded picture. Returns a new ImageBitmap; the input is not closed.
 * o = { rotate, crop, clean: 'signature'|'document'|null, gray, keepAlpha }
 */
export async function preparePhoto(bmp, o) {
  const rot = (((Number(o.rotate) || 0) % 360) + 360) % 360;
  const crop = normCrop(o.crop);
  const clean = o.clean === 'signature' || o.clean === 'document' ? o.clean : null;
  const gray = !!o.gray;
  const rw = rot % 180 ? bmp.height : bmp.width;
  const rh = rot % 180 ? bmp.width : bmp.height;
  let cx = 0, cy = 0, cw = rw, ch = rh;
  if (crop) {
    cx = Math.round(crop.x * rw); cy = Math.round(crop.y * rh);
    cw = Math.max(1, Math.min(rw - cx, Math.round(crop.w * rw)));
    ch = Math.max(1, Math.min(rh - cy, Math.round(crop.h * rh)));
  }
  // Signatures never need more than ~2400 px; working smaller keeps clean-up fast on phones.
  const k = clean === 'signature' ? Math.min(1, 2400 / Math.max(cw, ch)) : 1;
  const W = Math.max(1, Math.round(cw * k)), H = Math.max(1, Math.round(ch * k));
  const canvas = new OffscreenCanvas(W, H);
  const keepAlpha = !!(o.keepAlpha && !clean);
  const g = canvas.getContext('2d', { alpha: keepAlpha, willReadFrequently: !!(clean || gray) });
  if (!keepAlpha) { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); }
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.scale(k, k);
  g.translate(-cx, -cy);
  g.translate(rw / 2, rh / 2);
  g.rotate((rot * Math.PI) / 180);
  g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (!clean && !gray) return canvas.transferToImageBitmap();
  const id = g.getImageData(0, 0, W, H);
  if (clean) cleanPixels(id, clean);
  if (gray) {
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114); d[i] = d[i + 1] = d[i + 2] = v; }
  }
  g.putImageData(id, 0, 0);
  if (clean === 'signature') {
    const box = inkBox(id);
    if (box && (box.w < W || box.h < H)) {
      const out = new OffscreenCanvas(box.w, box.h);
      out.getContext('2d', { alpha: false }).drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      canvas.width = canvas.height = 1;
      return out.transferToImageBitmap();
    }
  }
  return canvas.transferToImageBitmap();
}
