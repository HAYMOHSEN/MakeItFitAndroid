// Make It Fit — touch-friendly crop editor. The crop is stored as fractions (0..1) of the
// photo as it looks after rotation, so it works at any resolution.
import { probeFile } from '../engine/probe.js';

const MIN = 0.04; // smallest crop side, as a fraction of the picture

export class CropEditor {
  constructor(el) {
    this.el = el; // { stage, wrap, canvas, box }
    this.img = null;
    this.rot = 0;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.aspect = null; // width / height in pixels, or null for free
    this.drag = null;
    this.token = 0;
    el.box.addEventListener('pointerdown', (e) => this.onDown(e));
    el.box.addEventListener('pointermove', (e) => this.onMove(e));
    el.box.addEventListener('pointerup', (e) => this.onUp(e));
    el.box.addEventListener('pointercancel', (e) => this.onUp(e));
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(el.stage);
  }

  /**
   * Loads a picture file (decoded small, upright) and an existing crop/rotation.
   * Returns false when a newer load or close() happened meanwhile (the result is dropped).
   */
  async load(file, rotate, crop) {
    const token = ++this.token;
    this.blank();
    const p = await probeFile(file);
    const maxSide = 1600;
    const opts = { imageOrientation: 'from-image', resizeQuality: 'high' };
    if (p && Math.max(p.ow, p.oh) > maxSide) { if (p.ow >= p.oh) opts.resizeWidth = maxSide; else opts.resizeHeight = maxSide; }
    const img = await createImageBitmap(file, opts);
    if (token !== this.token) { img.close(); return false; }
    this.img = img;
    this.rot = (((Number(rotate) || 0) % 360) + 360) % 360;
    this.rect = crop ? { ...crop } : { x: 0, y: 0, w: 1, h: 1 };
    this.draw();
    return true;
  }

  // Shows nothing (no leftover picture from the last photo) until the next load finishes.
  blank() {
    if (this.img) { this.img.close(); this.img = null; }
    this.el.canvas.width = 1; this.el.canvas.height = 1;
    this.el.wrap.style.width = '0px'; this.el.wrap.style.height = '0px';
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
  }

  get ready() { return !!this.img; }

  close() { this.token++; this.blank(); this.drag = null; }

  get size() { // picture size after rotation, in preview pixels
    const w = this.img ? this.img.width : 1, h = this.img ? this.img.height : 1;
    return this.rot % 180 ? { w: h, h: w } : { w, h };
  }

  draw() {
    if (!this.img) return;
    const { w, h } = this.size;
    const c = this.el.canvas;
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((this.rot * Math.PI) / 180);
    g.drawImage(this.img, -this.img.width / 2, -this.img.height / 2);
    g.restore();
    this.layout();
  }

  layout() {
    if (!this.img) return;
    const st = this.el.stage;
    const cs = getComputedStyle(st);
    const aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const { w, h } = this.size;
    const k = Math.max(0.01, Math.min(aw / w, ah / h));
    this.el.wrap.style.width = `${Math.round(w * k)}px`;
    this.el.wrap.style.height = `${Math.round(h * k)}px`;
    this.paint();
  }

  paint() {
    const r = this.rect, b = this.el.box.style;
    b.left = `${r.x * 100}%`; b.top = `${r.y * 100}%`; b.width = `${r.w * 100}%`; b.height = `${r.h * 100}%`;
  }

  // Fraction-space height that gives the locked pixel aspect for a fraction-space width.
  hFor(w) { const { w: W, h: H } = this.size; return (w * W) / (this.aspect * H); }
  wFor(h) { const { w: W, h: H } = this.size; return (h * this.aspect * H) / W; }

  /** Locks the shape (pixel width/height) or unlocks it (null), keeping the centre. */
  setAspect(aspect) {
    this.aspect = aspect && aspect > 0 ? aspect : null;
    if (!this.aspect) { this.paint(); return; }
    const cx = this.rect.x + this.rect.w / 2, cy = this.rect.y + this.rect.h / 2;
    // Largest box of that shape inside the picture, then shrink to the current box size.
    let w = 1, h = this.hFor(1);
    if (h > 1) { h = 1; w = this.wFor(1); }
    const scale = Math.min(1, Math.max(this.rect.w / w, this.rect.h / h, 0.6));
    w *= scale; h *= scale;
    this.rect = this.clampPos({ x: cx - w / 2, y: cy - h / 2, w, h });
    this.paint();
  }

  reset() {
    if (!this.img) return;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    if (this.aspect) this.setAspect(this.aspect); else this.paint();
  }

  rotate() {
    if (!this.img) return;
    // Turning the picture 90° clockwise moves the crop box with it.
    const r = this.rect;
    this.rect = { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
    this.rot = (this.rot + 90) % 360;
    this.draw();
    if (this.aspect) this.setAspect(this.aspect);
  }

  clampPos(r) {
    const w = Math.min(1, r.w), h = Math.min(1, r.h);
    return { x: Math.min(1 - w, Math.max(0, r.x)), y: Math.min(1 - h, Math.max(0, r.y)), w, h };
  }

  /** The result: rotation and crop (null when the whole picture is kept). */
  result() {
    const r = this.rect;
    const full = r.x < 0.002 && r.y < 0.002 && r.w > 0.996 && r.h > 0.996;
    return { rotate: this.rot, crop: full ? null : { x: r.x, y: r.y, w: r.w, h: r.h } };
  }

  point(e) {
    const b = this.el.wrap.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  }

  onDown(e) {
    if (this.drag || !this.img) return;
    e.preventDefault();
    const handle = e.target.dataset && e.target.dataset.h;
    this.drag = { id: e.pointerId, handle: handle || 'move', start: this.point(e), rect: { ...this.rect } };
    try { this.el.box.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  onUp(e) {
    if (this.drag && this.drag.id === e.pointerId) this.drag = null;
  }

  onMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const p = this.point(e);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    const s = d.rect;
    if (d.handle === 'move') {
      this.rect = this.clampPos({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h });
      this.paint();
      return;
    }
    // The opposite corner stays fixed.
    const west = d.handle.includes('w'), north = d.handle.includes('n');
    const ax = west ? s.x + s.w : s.x;
    const ay = north ? s.y + s.h : s.y;
    let w = west ? ax - (s.x + dx) : s.x + s.w + dx - ax;
    let h = north ? ay - (s.y + dy) : s.y + s.h + dy - ay;
    const maxW = west ? ax : 1 - ax;
    const maxH = north ? ay : 1 - ay;
    w = Math.max(MIN, Math.min(maxW, w));
    h = Math.max(MIN, Math.min(maxH, h));
    if (this.aspect) {
      // Follow the larger movement, keep the shape, stay inside the picture.
      const hw = this.hFor(w);
      if (hw > h) h = hw; else w = this.wFor(h);
      if (w > maxW) { w = maxW; h = this.hFor(w); }
      if (h > maxH) { h = maxH; w = this.wFor(h); }
      if (w < MIN || h < MIN) { const k = Math.max(MIN / w, MIN / h); w *= k; h *= k; }
    }
    this.rect = { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
    this.paint();
  }
}
