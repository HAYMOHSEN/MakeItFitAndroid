// Make It Fit (Android) — app logic. Everything runs on this phone; nothing is uploaded.
import * as pdfTools from './js/pdf-tools.js';
import { t, tn, setLang, getLang, HELP, PRIVACY } from './js/i18n.js';
import { parseRules, normalizeText } from './js/rules.js';
import { CropEditor } from './js/crop.js';
import { probeFile } from './engine/probe.js';

const VERSION = '1.0.0';
const SETTINGS_KEY = 'mifa.settings.v1';
const FORMS_KEY = 'mifa.forms.v1';
const SHARE_CACHE = 'mifa-share';
const PRESETS = [10e3, 20e3, 50e3, 100e3, 200e3, 500e3, 1e6, 2e6, 5e6, 10e6];
const MAX_FILES = 60;
// Phones with little memory get a lower PDF ceiling (the whole file is held in memory twice).
const MAX_PDF_BYTES = (() => { const m = Number(navigator.deviceMemory) || 4; return m <= 2 ? 60e6 : m <= 4 ? 100e6 : 150e6; })();
const MAX_IMAGE_BYTES = 80e6;
const LIMIT_MIN = 1000;
const LIMIT_MAX = 4e9;

const SETUP_KEYS = ['limit', 'minValue', 'minUnit', 'photoFormat', 'resizeMode', 'resizeW', 'resizeH', 'resizeFit', 'clean', 'gray', 'combine', 'cropAspect', 'minPxW', 'minPxH'];
const BASE_SETUP = { minValue: '', minUnit: '1000', photoFormat: 'image/jpeg', resizeMode: 'none', resizeW: '', resizeH: '', resizeFit: 'crop', clean: 'off', gray: false, combine: false, cropAspect: 'free', minPxW: '', minPxH: '' };
const PURPOSES = [
  { id: 'signature', icon: 'pen', setup: { ...BASE_SETUP, limit: 20e3, clean: 'signature' } },
  { id: 'photo', icon: 'user', setup: { ...BASE_SETUP, limit: 50e3, cropAspect: '3:4' } },
  { id: 'document', icon: 'id', setup: { ...BASE_SETUP, limit: 200e3, clean: 'document' } },
  { id: 'scanpdf', icon: 'pdf', setup: { ...BASE_SETUP, limit: 1e6, photoFormat: 'auto', clean: 'document', combine: true } },
  { id: 'email', icon: 'mail', setup: { ...BASE_SETUP, limit: 10e6, photoFormat: 'auto' } },
];
const DEFAULTS = {
  lang: 'auto', theme: 'system', ...BASE_SETUP, limit: 200e3, photoFormat: 'auto',
  pdfScanFallback: true, pdfPrivacy: true, strong: false, pageSize: 'auto', margin: 'small', suffixStyle: 'limit',
};
const CROP_ASPECTS = [
  { key: 'free', label: () => t('crop.free') },
  { key: '1:1', label: () => t('crop.square'), value: 1 },
  { key: '3:4', label: () => '3:4', value: 3 / 4 },
  { key: '4:3', label: () => '4:3', value: 4 / 3 },
  { key: '35:45', label: () => t('crop.passport'), value: 35 / 45 },
];

const IMAGE_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };
const EXT_FOR = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif', 'application/pdf': 'pdf' };
const FORMAT_LABEL = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/bmp': 'BMP', 'image/avif': 'AVIF', 'application/pdf': 'PDF' };
const NOTE_KEYS = ['resized', 'lowQuality', 'transparencyWhite', 'cleaned', 'flattened', 'protected', 'rebuilt', 'pdfa', 'cleanedSignature', 'cleanedDocument', 'cropped', 'gray', 'padded'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const coded = (code, message) => Object.assign(new Error(message || code), { code });
const trimNum = (v) => String(Math.round(v * 100) / 100);
// Rounded down, so a file of 19,999 bytes shows as 19.9 KB, never as "20 KB" next to a 20 KB limit.
const floorTo = (v, d) => { const k = 10 ** d; return (Math.floor(v * k + 1e-9) / k).toFixed(d); };
const rawFmtBytes = (n) => (n < 1000 ? `${n} B` : n < 1e6 ? `${floorTo(n / 1e3, n < 100e3 ? 1 : 0)} KB` : n < 1e9 ? `${floorTo(n / 1e6, n < 10e6 ? 2 : 1)} MB` : `${floorTo(n / 1e9, 2)} GB`);
const rawLimitLabel = (n) => (n >= 1e6 ? `${trimNum(n / 1e6)} MB` : `${trimNum(n / 1e3)} KB`);
// Sizes and pixel dimensions are wrapped in left-to-right isolates so they read correctly
// inside Arabic sentences ("50 KB", not "KB 50").
const iso = (s) => `\u2066${s}\u2069`;
const limitLabel = (n) => iso(rawLimitLabel(n));
const fmtBytes = (n) => iso(rawFmtBytes(n));
const dims = (w, h) => iso(`${w} × ${h}`);
const fsi = (s) => `\u2068${s}\u2069`;
const arrow = () => (document.documentElement.dir === 'rtl' ? '←' : '→');
const extOf = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const baseOf = (name) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);
const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const bdi = (s) => `<bdi>${esc(s)}</bdi>`;
const parseNum = (v) => { const n = parseFloat(normalizeText(String(v ?? '')).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : NaN; };

// ---------- settings ----------
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { /* defaults */ }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage full or blocked */ } }
let forms = [];
try { const f = JSON.parse(localStorage.getItem(FORMS_KEY) || '[]'); if (Array.isArray(f)) forms = f.filter((x) => x && x.id && x.name && x.setup); } catch { /* none */ }
function saveForms() { try { localStorage.setItem(FORMS_KEY, JSON.stringify(forms)); } catch { /* ignore */ } }

function resolveLang() {
  if (settings.lang === 'en' || settings.lang === 'ar') return settings.lang;
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  return String(langs[0] || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.dataset.theme = settings.theme; else delete root.dataset.theme;
}

/** Minimum size in bytes (1 KB = 1,024 so the file passes either way), or 0. */
function minBytes() {
  const v = parseNum(settings.minValue);
  if (!(v > 0)) return 0;
  const unit = Number(settings.minUnit) === 1e6 ? 1048576 : 1024;
  const bytes = Math.ceil(v * unit);
  if (Math.round(v * Number(settings.minUnit || 1000)) >= settings.limit) return -1; // invalid
  return Math.min(bytes, settings.limit);
}
const minLabel = () => limitLabel(parseNum(settings.minValue) * Number(settings.minUnit || 1000));

// ---------- engine client ----------
class Engine {
  constructor() { this.worker = null; this.pending = new Map(); this.seq = 0; }
  // The worker starts on first use, and after a crash only when the next job comes, so a
  // worker that can't load never restarts in a loop.
  spawn() {
    this.worker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { if (p.onProgress) p.onProgress(m.value, m.label, m.vars); return; }
      this.pending.delete(m.id);
      if (m.type === 'result') p.resolve(m.result); else p.reject(coded(m.code || 'UNKNOWN', m.message));
    };
    this.worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const pending = [...this.pending.values()];
      this.pending.clear();
      try { this.worker.terminate(); } catch { /* gone */ }
      this.worker = null;
      for (const p of pending) p.reject(coded('ENGINE_CRASH'));
    };
  }
  run(task, payload, onProgress, transfer = []) {
    return new Promise((resolve, reject) => {
      if (!this.worker) { try { this.spawn(); } catch { reject(coded('ENGINE_CRASH')); return; } }
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, task, payload }, transfer);
    });
  }
  cancel() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(coded('CANCELLED'));
  }
}
const engine = new Engine();

// One background job at a time (thumbnails, PDF checks) keeps phone memory low.
let queueTail = Promise.resolve();
const enqueue = (fn) => { queueTail = queueTail.then(fn, fn).catch(() => {}); return queueTail; };

// ---------- state ----------
const items = new Map();
let order = [];
let running = false;
let abort = null;
let uid = 0;
const COMBINED_ID = 'combined';

const el = {
  empty: $('#empty'), fileList: $('#fileList'), rows: $('#rows'), fileCount: $('#fileCount'), summary: $('#summary'),
  summaryText: $('#summaryText'), btnRun: $('#btnRun'), runHint: $('#runHint'), chips: $('#chips'), limitValue: $('#limitValue'),
  limitUnit: $('#limitUnit'), minValue: $('#minValue'), minUnit: $('#minUnit'), limitText: $('#limitText'), fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'), toast: $('#toast'), purposes: $('#purposes'), setupSummary: $('#setupSummary'),
};

function itemList() { return order.map((id) => items.get(id)).filter(Boolean); }
function processable(it) { return it.kind !== 'unsupported' && !it.isCombined && !it.tooBig && !(it.pdf && (it.pdf.locked || it.pdf.needsPassword || it.pdf.unreadable || it.pdf.inspectFailed)); }

// ---------- dialogs and the Android back button ----------
// The Android back button must close the open sheet, not leave the app. Each open dialog adds
// a history entry: where the browser closes dialogs on back by itself (Chrome's close requests)
// the entry is removed when the dialog closes; elsewhere (older browsers, the WebView fallback)
// going back pops the entry and closes the dialog here.
const dialogStack = [];
let ignorePops = 0;
function openDialog(d) {
  if (d.open) return;
  d.showModal();
  dialogStack.push(d);
  try { history.pushState({ mifDialog: dialogStack.length }, ''); d._pushed = true; } catch { d._pushed = false; }
  hideToast(); // a message about the main screen shouldn't sit on top of the new window
}
for (const d of $$('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) d.close();
    else if (e.target === d && d.classList.contains('sheet') && d.id !== 'dlgConfirm') d.close();
  });
  d.addEventListener('close', () => {
    const i = dialogStack.lastIndexOf(d);
    if (i >= 0) dialogStack.splice(i, 1);
    if (d._pushed) {
      d._pushed = false;
      if (!d._byPop) { ignorePops++; history.back(); }
    }
    d._byPop = false;
  });
}
window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  const top = dialogStack[dialogStack.length - 1];
  if (top && top._pushed) { top._byPop = true; top._pushed = false; top.close(); }
});

function confirmDialog({ title, body, buttons }) {
  const d = $('#dlgConfirm');
  $('#confirmTitle').textContent = title;
  $('#confirmBody').innerHTML = body;
  const foot = $('#confirmFoot');
  foot.innerHTML = buttons.map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-value="${esc(b.value)}">${esc(b.label)}</button>`).join('');
  return new Promise((resolve) => {
    d.returnValue = '';
    const onClick = (e) => { const b = e.target.closest('[data-value]'); if (b) { d.returnValue = b.dataset.value; d.close(); } };
    const onClose = () => { foot.removeEventListener('click', onClick); d.removeEventListener('close', onClose); resolve(d.returnValue || 'cancel'); };
    foot.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
    openDialog(d);
  });
}

// ---------- toast ----------
let toastTimer = 0;
const popoverOk = typeof el.toast.showPopover === 'function';
function hideToast() {
  clearTimeout(toastTimer);
  el.toast.classList.remove('show');
  if (popoverOk) { try { if (el.toast.matches(':popover-open')) el.toast.hidePopover(); } catch { /* ignore */ } }
}
function toast(text) {
  el.toast.textContent = text;
  // Over a full-screen window the bottom is full of buttons, so show the message near the top.
  el.toast.classList.toggle('top', dialogStack.some((d) => d.open));
  if (popoverOk) { try { if (el.toast.matches(':popover-open')) el.toast.hidePopover(); el.toast.showPopover(); } catch { /* ignore */ } }
  requestAnimationFrame(() => el.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => { if (popoverOk && !el.toast.classList.contains('show')) { try { el.toast.hidePopover(); } catch { /* ignore */ } } }, 250);
  }, 3200);
}

// ---------- language ----------
function applyLanguage() {
  const lang = resolveLang();
  setLang(lang);
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const n of $$('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of $$('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  for (const n of $$('[data-i18n-placeholder]')) n.placeholder = t(n.dataset.i18nPlaceholder);
  $('#helpBody').innerHTML = HELP[lang].map(([q, a]) => `<h3>${esc(q)}</h3><p>${a}</p>`).join('');
  $('#privacyBody').innerHTML = PRIVACY[lang].map(([h, p]) => `${h ? `<h3>${esc(h)}</h3>` : ''}<p>${p}</p>`).join('');
  $('#versionLabel').textContent = t('settings.version', { v: VERSION });
  $('#settingsVersion').textContent = t('settings.version', { v: VERSION });
  document.title = t('app.name');
}

// ---------- setup: purposes and my forms ----------
const setupOf = (s) => Object.fromEntries(SETUP_KEYS.map((k) => [k, s[k]]));
const sameValue = (a, b) => String(a ?? '') === String(b ?? '');
const matches = (setup) => SETUP_KEYS.every((k) => sameValue(setup[k] ?? BASE_SETUP[k], settings[k]));
function activeSetupId() {
  for (const p of PURPOSES) if (matches(p.setup)) return `p:${p.id}`;
  for (const f of forms) if (matches(f.setup)) return `f:${f.id}`;
  return '';
}
function setupSummary(s) {
  const parts = [];
  const minV = parseNum(s.minValue);
  if (minV > 0) parts.push(t('sum.between', { min: limitLabel(minV * Number(s.minUnit || 1000)), max: limitLabel(s.limit) }));
  else parts.push(t('sum.under', { limit: limitLabel(s.limit) }));
  if (s.combine) parts.push(t('sum.combine'));
  else if (s.photoFormat === 'image/jpeg') parts.push(t('sum.jpg'));
  else if (s.photoFormat === 'image/png') parts.push(t('sum.png'));
  else if (s.photoFormat === 'image/webp') parts.push(t('sum.webp'));
  if (s.clean === 'signature') parts.push(t('sum.cleanSignature'));
  if (s.clean === 'document') parts.push(t('sum.cleanDocument'));
  if (s.gray) parts.push(t('sum.gray'));
  const w = parseNum(s.resizeW), h = parseNum(s.resizeH);
  if (s.resizeMode === 'exact' && w > 0 && h > 0) parts.push(t('sum.exact', { dims: dims(w, h) }));
  if (s.resizeMode === 'max' && (w > 0 || h > 0)) parts.push(t('sum.max', { dims: dims(w > 0 ? w : '—', h > 0 ? h : '—') }));
  const mw = parseNum(s.minPxW), mh = parseNum(s.minPxH);
  if (mw > 0 || mh > 0) parts.push(t('sum.minPx', { dims: dims(mw > 0 ? mw : '—', mh > 0 ? mh : '—') }));
  return parts.join(' · ');
}
function renderPurposes() {
  const active = activeSetupId();
  const chip = (id, iconId, title, sub, extra = '') => `<button class="purpose" role="radio" aria-checked="${active === id}" data-setup="${esc(id)}" ${extra}><span class="pi">${icon(iconId)}</span><span class="pt"><b>${esc(title)}</b><small>${sub}</small></span></button>`;
  let html = PURPOSES.map((p) => chip(`p:${p.id}`, p.icon, t(`purpose.${p.id}`), esc(limitLabel(p.setup.limit)))).join('');
  html += forms.map((f) => chip(`f:${f.id}`, 'star', f.name, esc(limitLabel(f.setup.limit)))).join('');
  html += `<button class="purpose add" data-act="save-form"><span class="pi">${icon('plus')}</span><span class="pt"><b>${esc(t('purpose.save'))}</b><small>${esc(t('purpose.saveSub'))}</small></span></button>`;
  el.purposes.innerHTML = html;
  el.setupSummary.innerHTML = esc(setupSummary(settings));
}
function applySetup(setup) {
  if (!sameValue(setup.combine ?? BASE_SETUP.combine, settings.combine)) invalidateCombined();
  for (const k of SETUP_KEYS) settings[k] = setup[k] ?? BASE_SETUP[k];
  saveSettings();
  syncSettingsUI();
  revealUsedOptions();
  renderAll();
}
el.purposes.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'save-form') { openSaveForm(); return; }
  const id = b.dataset.setup;
  if (!id) return;
  if (id.startsWith('p:')) { const p = PURPOSES.find((x) => `p:${x.id}` === id); if (p) applySetup(p.setup); }
  else { const f = forms.find((x) => `f:${x.id}` === id); if (f) applySetup(f.setup); }
});
el.purposes.addEventListener('contextmenu', (e) => {
  const b = e.target.closest('[data-setup^="f:"]');
  if (!b) return;
  e.preventDefault();
  openForms();
});

function openSaveForm(defaultName) {
  const d = $('#dlgSaveForm');
  const input = $('#formName');
  input.value = defaultName || t('forms.defaultName', { n: forms.length + 1 });
  $('#formSummary').textContent = setupSummary(settings);
  openDialog(d);
  setTimeout(() => { try { input.focus(); input.select(); } catch { /* ignore */ } }, 60);
}
$('#saveFormForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#formName').value.trim().slice(0, 40);
  if (!name) return;
  const existing = forms.find((f) => f.name === name);
  const setup = setupOf(settings);
  if (existing) existing.setup = setup;
  else forms.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, setup });
  saveForms();
  $('#dlgSaveForm').close();
  renderPurposes();
  toast(t('forms.saved', { name: fsi(name) }));
});
function renderFormList() {
  const list = $('#formList');
  if (!forms.length) { list.innerHTML = `<li><span class="fl-text"><small>${esc(t('forms.empty'))}</small></span></li>`; return; }
  list.innerHTML = forms.map((f) => `<li><span class="fl-text"><b>${bdi(f.name)}</b><small>${esc(setupSummary({ ...BASE_SETUP, ...f.setup }))}</small></span><button class="btn icon" data-del="${esc(f.id)}" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button></li>`).join('');
}
function openForms() { renderFormList(); openDialog($('#dlgForms')); }
$('#formList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const f = forms.find((x) => x.id === b.dataset.del);
  if (!f) return;
  forms = forms.filter((x) => x !== f);
  saveForms();
  renderFormList();
  renderPurposes();
  toast(t('forms.deleted', { name: fsi(f.name) }));
});
$('#btnManageForms').addEventListener('click', () => { $('#dlgSettings').close(); openForms(); });

// ---------- size limit ----------
function renderLimit() {
  el.chips.innerHTML = PRESETS.map((v) => `<button class="chip" role="radio" data-limit="${v}" aria-checked="${v === settings.limit}">${limitLabel(v)}</button>`).join('');
  const unit = settings.limit >= 1e6 ? 1e6 : 1e3;
  el.limitUnit.value = String(unit);
  if (document.activeElement !== el.limitValue) el.limitValue.value = trimNum(settings.limit / unit);
  if (document.activeElement !== el.minValue) el.minValue.value = settings.minValue === '' ? '' : String(settings.minValue);
  el.minUnit.value = String(settings.minUnit || '1000');
  const mb = minBytes();
  if (mb < 0) el.limitText.innerHTML = `<span class="bad">${esc(t('limit.minTooBig'))}</span>`;
  else if (mb > 0) el.limitText.innerHTML = esc(t('limit.textRange', { min: '\u0001', max: '\u0002' })).replace('\u0001', `<b>${esc(minLabel())}</b>`).replace('\u0002', `<b>${esc(limitLabel(settings.limit))}</b>`);
  else el.limitText.innerHTML = esc(t('limit.text', { max: '\u0002' })).replace('\u0002', `<b>${esc(limitLabel(settings.limit))}</b>`);
  updateRunButton();
}
el.chips.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  settings.limit = Number(b.dataset.limit);
  saveSettings();
  renderLimit();
  renderPurposes();
});
function readCustomLimit() {
  const v = parseNum(el.limitValue.value);
  if (v > 0) settings.limit = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(v * Number(el.limitUnit.value))));
  saveSettings();
  renderLimit();
  renderPurposes();
}
function readMin() {
  const v = parseNum(el.minValue.value);
  settings.minValue = v > 0 ? trimNum(v) : '';
  settings.minUnit = el.minUnit.value;
  saveSettings();
  renderLimit();
  renderPurposes();
}
el.limitValue.addEventListener('change', readCustomLimit);
el.limitUnit.addEventListener('change', readCustomLimit);
el.minValue.addEventListener('change', readMin);
el.minUnit.addEventListener('change', readMin);
for (const input of [el.limitValue, el.minValue]) {
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
}

// ---------- option bindings ----------
function syncSettingsUI() {
  for (const node of $$('[data-setting]')) {
    const key = node.dataset.setting;
    if (node.type === 'checkbox') node.checked = !!settings[key]; else node.value = settings[key] ?? '';
  }
  syncOptionVisibility();
  renderLimit();
  renderPurposes();
}
function bindSettings() {
  for (const node of $$('[data-setting]')) {
    const key = node.dataset.setting;
    node.addEventListener('change', () => {
      if (node.type === 'checkbox') settings[key] = node.checked;
      else if (key === 'resizeW' || key === 'resizeH') { const v = parseNum(node.value); settings[key] = v > 0 ? String(Math.min(8000, Math.max(16, Math.round(v)))) : ''; node.value = settings[key]; }
      else settings[key] = node.value;
      if (key === 'combine') invalidateCombined();
      if (key === 'resizeMode' && node.value === 'exact' && settings.cropAspect === 'free') settings.cropAspect = 'form';
      if (key === 'resizeMode' && node.value !== 'exact' && settings.cropAspect === 'form') settings.cropAspect = 'free';
      saveSettings();
      if (key === 'theme') applyTheme();
      if (key === 'lang') { applyLanguage(); syncSettingsUI(); }
      syncOptionVisibility();
      renderPurposes();
      renderAll();
    });
  }
  syncSettingsUI();
}
function syncOptionVisibility() {
  const mode = settings.resizeMode;
  $('#resizeFields').hidden = mode === 'none';
  $('#fitField').hidden = mode !== 'exact';
}
// Opens the option groups that the current setup uses, so nothing is hidden by surprise.
function revealUsedOptions() {
  if (settings.combine) $('#combineOpts').open = true;
  if (settings.clean !== 'off' || settings.gray || settings.resizeMode !== 'none') $('#photoOpts').open = true;
}

// ---------- adding files ----------
function kindOf(file, ext) {
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (IMAGE_EXT[ext] || /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type)) return 'image';
  return 'unsupported';
}
function unsupportedError(ext, type) {
  let key = 'unsupported.other';
  if (ext === 'heic' || ext === 'heif' || /heic|heif/.test(type)) key = 'unsupported.heic';
  else if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'txt', 'rtf'].includes(ext)) key = 'unsupported.office';
  else if (['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'mp3', 'm4a', 'wav', 'aac', 'ogg', 'opus', 'amr'].includes(ext) || /^(video|audio)\//.test(type)) key = 'unsupported.media';
  else if (['zip', 'rar', '7z'].includes(ext)) key = 'unsupported.archive';
  return { key };
}
function addFiles(files, how = 'added') {
  let added = 0;
  for (let file of files) {
    if (!file || !(file.size >= 0)) continue;
    if (itemList().filter((x) => !x.isCombined).length >= MAX_FILES) { toast(t('toast.tooMany', { n: MAX_FILES })); break; }
    const name = file.name || `file-${uid + 1}`;
    const ext = extOf(name);
    let type = (file.type || '').toLowerCase();
    if (type === 'image/jpg' || type === 'image/pjpeg') type = 'image/jpeg';
    if (!type && IMAGE_EXT[ext]) type = IMAGE_EXT[ext];
    if (!type && ext === 'pdf') type = 'application/pdf';
    if (type !== file.type || !file.name) file = new File([file], name, { type, lastModified: file.lastModified || Date.now() });
    const kind = kindOf(file, ext);
    const it = { id: `f${++uid}`, file, name, ext: ext || EXT_FOR[type] || '', kind, size: file.size, rotate: 0, crop: null, cropAspect: null, status: 'ready', progress: 0, label: '', vars: null, pdf: {}, thumb: null, result: null, error: null, strong: false };
    if (kind === 'unsupported') { it.status = 'error'; it.error = unsupportedError(ext, type); }
    else if ((kind === 'pdf' && file.size > MAX_PDF_BYTES) || (kind === 'image' && file.size > MAX_IMAGE_BYTES)) {
      it.status = 'error'; it.tooBig = true; it.error = { code: 'TOO_BIG', vars: { max: limitLabel(kind === 'pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES) } };
    }
    items.set(it.id, it);
    order.push(it.id);
    added++;
    if (kind === 'image' && !it.tooBig) enqueue(() => makeImageThumb(it));
    if (kind === 'pdf' && !it.tooBig) { it.status = 'analyzing'; enqueue(() => analyzePdfItem(it)); }
  }
  if (added) {
    if (items.has(COMBINED_ID)) invalidateCombined();
    renderAll();
    toast(tn(how === 'received' ? 'toast.received' : 'toast.added', added));
  }
}
async function makeImageThumb(it) {
  if (!items.has(it.id)) return;
  try {
    if (!it.dims) it.dims = await probeFile(it.file);
    if (!it.thumbBmp) {
      const opts = { imageOrientation: 'from-image', resizeQuality: 'medium' };
      const d = it.dims;
      const T = 192;
      if (d && Math.max(d.ow, d.oh) > T) { if (d.ow >= d.oh) opts.resizeWidth = T; else opts.resizeHeight = T; }
      else if (!d) opts.resizeWidth = T;
      it.thumbBmp = await createImageBitmap(it.file, opts);
    }
    if (!it.dims) it.dims = { ow: it.thumbBmp.width, oh: it.thumbBmp.height, guessed: true };
    await drawThumb(it);
    it.decodeOk = true;
  } catch {
    it.decodeOk = false;
  }
  renderItem(it);
}
// Thumbnail with the item's rotation and crop applied.
async function drawThumb(it) {
  const b = it.thumbBmp;
  if (!b) return;
  const rot = it.rotate % 360;
  const rw = rot % 180 ? b.height : b.width, rh = rot % 180 ? b.width : b.height;
  const cr = it.crop || { x: 0, y: 0, w: 1, h: 1 };
  const cw = Math.max(1, Math.round(cr.w * rw)), ch = Math.max(1, Math.round(cr.h * rh));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.translate(-cr.x * rw, -cr.y * rh);
  g.translate(rw / 2, rh / 2);
  g.rotate((rot * Math.PI) / 180);
  g.drawImage(b, -b.width / 2, -b.height / 2);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  if (it.thumb && it.thumb.startsWith('blob:')) URL.revokeObjectURL(it.thumb);
  it.thumb = blob ? URL.createObjectURL(blob) : null;
}
async function analyzePdfItem(it) {
  if (!items.has(it.id)) return;
  it.status = 'analyzing';
  renderItem(it);
  try {
    const q = await engine.run('inspect', { file: it.file });
    if (!q.isPdf) throw coded('NOT_PDF');
    it.pdf.signed = q.signed;
    it.pdf.pdfa = q.pdfa;
    try {
      applyPdfInfo(it, await pdfTools.analyzePdf(it.file));
      it.status = 'ready';
      if (it.pdf.locked) setError(it, coded('PDF_LOCKED'));
    } catch (e) {
      if (e.code === 'PDF_NEEDS_PASSWORD') { it.pdf.encrypted = true; it.pdf.needsPassword = true; it.status = 'needs-password'; }
      else { it.pdf.unreadable = true; setError(it, coded('PDF_DAMAGED')); }
    }
  } catch (e) {
    if (!items.has(it.id)) return;
    if (e.code === 'CANCELLED') { it.status = 'analyzing'; renderItem(it); enqueue(() => analyzePdfItem(it)); return; } // Stop was pressed: check again
    if (e.code === 'ENGINE_CRASH') { it.pdf.inspectFailed = true; setError(it, e); }
    else { it.pdf.unreadable = true; setError(it, e); }
  }
  renderItem(it);
  updateRunButton();
}
function applyPdfInfo(it, info) {
  it.pdf.pages = info.pages;
  it.pdf.restricted = info.restricted;
  it.pdf.canPrint = info.canPrint;
  if (info.restricted) { it.pdf.encrypted = true; it.pdf.locked = !info.canPrint; }
  if (info.thumb) { if (it.thumb && it.thumb.startsWith('blob:')) URL.revokeObjectURL(it.thumb); it.thumb = URL.createObjectURL(info.thumb); }
}

// ---------- rendering ----------
function renderAll() {
  const list = itemList();
  el.empty.hidden = list.length > 0;
  el.fileList.hidden = list.length === 0;
  el.fileCount.textContent = list.length ? `(${list.length})` : '';
  for (const node of $$('.row', el.rows)) if (!items.has(node.dataset.id)) node.remove();
  list.forEach((it, i) => {
    let row = $(`.row[data-id="${it.id}"]`, el.rows);
    if (!row) {
      row = document.createElement('li');
      row.className = 'row';
      row.dataset.id = it.id;
      row.innerHTML = '<div class="thumb"></div><div class="body"></div><div class="rm"></div><div class="actions"></div>';
    }
    if (el.rows.children[i] !== row) el.rows.insertBefore(row, el.rows.children[i] || null);
    renderItem(it);
  });
  updateRunButton();
  updateSummary();
}
function errorText(err) {
  if (!err) return { title: t('errors.UNKNOWN').split('|')[0], hint: '' };
  const raw = err.key ? t(err.key) : t(`errors.${err.code || 'UNKNOWN'}`, err.vars);
  const [title, hint] = (raw.includes('|') ? raw : t('errors.UNKNOWN')).split('|');
  return { title, hint };
}
function renderItem(it) {
  const row = $(`.row[data-id="${it.id}"]`, el.rows);
  if (!row) return;
  row.classList.toggle('combined', !!it.isCombined);
  row.dataset.status = it.status;
  const thumb = $('.thumb', row);
  const src = it.thumb || 'icon';
  if (thumb.dataset.src !== src) {
    thumb.innerHTML = it.thumb ? `<img src="${it.thumb}" alt="">` : icon(it.kind === 'pdf' || it.isCombined ? 'file' : 'image');
    thumb.dataset.src = src;
  }
  $('.body', row).innerHTML = bodyHtml(it);
  $('.actions', row).innerHTML = actionsHtml(it);
  const idle = !running && it.status !== 'working' && it.status !== 'analyzing';
  $('.rm', row).innerHTML = idle ? `<button class="btn icon" data-act="remove" aria-label="${esc(t('row.remove'))}" title="${esc(t('row.remove'))}">${icon('x')}</button>` : '';
  $('.actions', row).hidden = !$('.actions', row).querySelector('button');
}
function metaHtml(it) {
  const parts = [];
  if (it.isCombined) parts.push('PDF', tn('row.photos', it.parts.length));
  else {
    parts.push(it.kind === 'pdf' ? 'PDF' : (it.ext || 'file').toUpperCase());
    if (it.pdf && it.pdf.pages) parts.push(tn('row.pages', it.pdf.pages));
    parts.push(fmtBytes(it.size));
    if (it.rotate) parts.push(t('row.rotated', { d: it.rotate }));
    if (it.crop) parts.push(t('row.cropped'));
  }
  const badges = [];
  if (it.pdf && it.pdf.signed) badges.push(`<span class="badge warn">${esc(t('badge.signed'))}</span>`);
  if (it.pdf && it.pdf.locked) badges.push(`<span class="badge warn">${esc(t('badge.locked'))}</span>`);
  else if (it.pdf && it.pdf.encrypted && !it.pdf.needsPassword) badges.push(`<span class="badge">${esc(t('badge.protected'))}</span>`);
  if (it.pdf && it.pdf.pdfa) badges.push(`<span class="badge">${esc(t('badge.pdfa'))}</span>`);
  return `<div class="meta">${parts.map((p) => `<span>${bdi(p)}</span>`).join('<span aria-hidden="true">·</span>')}${badges.join('')}</div>`;
}
function noteTexts(r) {
  const notes = (r.notes || []).filter((n) => NOTE_KEYS.includes(n)).map((n) => t(`notes.${n}`));
  if (r.converted) notes.unshift(t('row.savedAs', { ext: r.ext.toUpperCase() }));
  return notes;
}
function bodyHtml(it) {
  let state = '';
  const r = it.result;
  switch (it.status) {
    case 'analyzing': state = `<span class="hint">${esc(t('row.checking'))}</span>`; break;
    case 'ready': state = it.isCombined ? '' : `<span class="hint">${esc(t('row.ready'))}</span>`; break;
    case 'needs-password': state = `<span class="bad">${esc(t('row.needsPassword'))}</span><button class="link" data-act="password">${esc(t('row.enterPassword'))}</button>`; break;
    case 'working': state = `<span>${esc(t(`progress.${it.label || 'starting'}`, it.vars || undefined))}</span><div class="progress" style="flex-basis:100%"><div style="width:${Math.round((it.progress || 0) * 100)}%"></div></div>`; break;
    case 'included': state = `<span class="hint">${esc(t('row.included'))}</span>`; break;
    case 'skipped': state = `<span class="hint">${esc(t('row.skippedSigned'))}</span>`; break;
    case 'error': {
      const e = errorText(it.error);
      state = `<span class="bad">${esc(e.title)}</span>${e.hint ? `<span class="hint" style="flex-basis:100%">${esc(e.hint)}</span>` : ''}`;
      const code = it.error && it.error.code;
      if (code === 'PDF_DAMAGED' && !it.pdf.unreadable) state += `<button class="link" data-act="rebuild">${esc(t('row.tryRebuild'))}</button>`;
      if (['UNKNOWN', 'ENGINE_CRASH', 'FILE_UNREADABLE', 'VERIFY_FAILED'].includes(code)) state += `<button class="link" data-act="retry">${esc(t('row.tryAgain'))}</button>`;
      break;
    }
    case 'done': {
      if (!r) break;
      const notes = noteTexts(r);
      const sizes = `<span class="sizes"><span class="from">${fmtBytes(it.size)} ${arrow()} </span><span class="to ${r.fits && !r.belowMin ? '' : 'bad'}">${fmtBytes(r.size)}</span></span>`;
      if (r.kept && !r.belowMin && !r.notes.includes('padded')) state = `<span class="ok">${esc(t('row.alreadyUnder'))}</span>${sizes}<span class="hint" style="flex-basis:100%">${esc([t('row.unchanged'), ...notes].join(' · '))}</span>`;
      else if (r.fits && r.belowMin) state = `<span class="bad">${esc(t('row.belowMin', { min: it.minLabel }))}</span>${sizes}<span class="hint" style="flex-basis:100%">${esc(noteTexts(r).join(' · '))}</span>`;
      else if (r.fits) state = `<span class="ok">${icon('check')} ${esc(t('row.fits'))}</span>${sizes}<span class="hint" style="flex-basis:100%">${esc([t('row.quality', { q: t(`quality.${r.quality || 'Good'}`) }) + (r.quality === 'Low' ? ` — ${t('row.checkReadable')}` : ''), ...notes].join(' · '))}</span>`;
      else state = `<span class="bad">${esc(t('row.couldNotReach', { limit: limitLabel(it.limit) }))}</span>${sizes}<span class="hint" style="flex-basis:100%">${esc([t('row.smallestClear', { size: fmtBytes(r.size) }), ...notes].join(' · '))}</span>${!(settings.strong || it.strong) ? `<button class="link" data-act="strong">${esc(t('row.allowLower'))}</button>` : `<span class="hint">${esc(t('row.asSmall'))}</span>`}`;
      const max = Math.max(it.size, it.limit * 1.08, r.size);
      const startSide = getLang() === 'ar' ? 'right' : 'left';
      state += `<div class="gauge ${r.fits && !r.belowMin ? '' : 'over'}" style="flex-basis:100%" aria-hidden="true"><div class="g-res" style="width:${(100 * r.size / max).toFixed(1)}%"></div><div class="g-limit" style="${startSide}:${(100 * it.limit / max).toFixed(1)}%"></div></div>`;
      const mini = checks(it).filter((c) => c.mini);
      if (mini.length) state += `<div class="mini-checks" style="flex-basis:100%">${mini.map((c) => `<span class="${c.ok ? 'yes' : 'no'}">${icon(c.ok ? 'check' : 'alert')}${esc(c.text)}</span>`).join('')}</div>`;
      break;
    }
    default: break;
  }
  return `<div class="name">${bdi(it.isCombined ? `${t('row.combinedName')}.pdf` : it.name)}</div>${metaHtml(it)}${state ? `<div class="state">${state}</div>` : ''}`;
}
function actionsHtml(it) {
  const r = it.result;
  const ib = (act, label, iconId) => `<button class="btn icon" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}">${icon(iconId)}</button>`;
  let html = '';
  if (it.status === 'done' && r) html += `<button class="btn" data-act="preview">${icon('eye')}${esc(t('row.preview'))}</button><button class="btn primary" data-act="save">${icon('save')}${esc(t('row.save'))}</button><button class="btn" data-act="share">${icon('share')}${esc(t('row.share'))}</button>`;
  html += '<span class="spacer"></span>';
  const idle = !running && it.status !== 'working' && it.status !== 'analyzing';
  if (it.kind === 'image' && !it.tooBig && it.status !== 'error' && idle) {
    html += ib('crop', t('row.crop'), 'crop') + ib('rotate', t('row.rotate'), 'rotate');
    if (settings.combine) html += ib('up', t('row.up'), 'up') + ib('down', t('row.down'), 'down');
  }
  return html;
}
el.rows.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.row');
  const it = row && items.get(row.dataset.id);
  if (!it) return;
  const act = btn.dataset.act;
  if (act === 'remove') removeItem(it);
  else if (act === 'rotate') {
    if (running) return;
    if (it.crop) { const c = it.crop; it.crop = { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w }; }
    it.rotate = (it.rotate + 90) % 360;
    if (it.status === 'done') { it.status = 'ready'; clearResult(it); }
    if (inCombined(it)) invalidateCombined();
    await drawThumb(it);
    renderAll();
  } else if (act === 'crop') { if (!running) openCrop(it); }
  else if (act === 'up' || act === 'down') {
    if (running) return;
    const i = order.indexOf(it.id); const j = act === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < order.length && order[j] !== COMBINED_ID) { [order[i], order[j]] = [order[j], order[i]]; if (inCombined(it)) invalidateCombined(); renderAll(); }
  }
  else if (act === 'preview') openPreview(it);
  else if (act === 'save') saveItems([it]);
  else if (act === 'share') shareItems([it]);
  else if (act === 'password') askPassword(it);
  else if (act === 'strong' || act === 'retry') {
    if (running) { toast(t('toast.busy')); return; }
    if (act === 'retry' && it.kind === 'pdf' && it.pdf.inspectFailed) { it.pdf = {}; it.error = null; it.status = 'analyzing'; renderItem(it); enqueue(() => analyzePdfItem(it)); return; }
    if (act === 'strong') it.strong = true;
    if (act === 'retry' && !it.isCombined) { it.status = 'ready'; it.error = null; renderItem(it); }
    // The combined PDF is remade from its photos.
    runItems(it.isCombined ? (it.parts || []).map((id) => items.get(id)).filter(Boolean) : [it]);
  }
  else if (act === 'rebuild') rebuildItem(it);
});
function inCombined(it) { const c = items.get(COMBINED_ID); return !!(c && it && (c.parts || []).includes(it.id)); }
// The combined PDF no longer matches its photos (one was rotated, cropped, moved, removed or
// added, or combining was switched off): drop it, so an outdated file can't be saved.
function invalidateCombined() {
  const c = items.get(COMBINED_ID);
  if (!c || c.status === 'working') return;
  for (const id of c.parts || []) { const p = items.get(id); if (p && p.status === 'included') p.status = 'ready'; }
  clearResult(c);
  items.delete(COMBINED_ID);
  order = order.filter((id) => id !== COMBINED_ID);
}
function clearResult(it) {
  if (it.result && it.result.url) URL.revokeObjectURL(it.result.url);
  it.result = null;
}
function removeItem(it) {
  if (inCombined(it)) invalidateCombined();
  clearResult(it);
  if (it.thumb && it.thumb.startsWith('blob:') && !it.isCombined) URL.revokeObjectURL(it.thumb);
  if (it.thumbBmp) { try { it.thumbBmp.close(); } catch { /* ignore */ } it.thumbBmp = null; }
  items.delete(it.id);
  order = order.filter((id) => id !== it.id);
  if (it.isCombined) for (const id of it.parts) { const p = items.get(id); if (p && p.status === 'included') p.status = 'ready'; }
  renderAll();
}
function updateRunButton() {
  const list = itemList();
  const ok = list.filter(processable);
  const mbad = minBytes() < 0;
  el.btnRun.disabled = running ? false : ok.length === 0 || mbad;
  el.btnRun.textContent = running ? t('run.stop') : t('run.go');
  el.btnRun.classList.toggle('primary', !running);
  el.btnRun.classList.toggle('stop', running);
  const mb = minBytes();
  el.runHint.classList.toggle('bad', !running && mbad && ok.length > 0);
  const photos = ok.filter((x) => x.kind === 'image').length;
  if (running) el.runHint.textContent = t('run.hintWorking');
  else if (!list.length) el.runHint.textContent = t('run.hintAdd');
  else if (!ok.length) el.runHint.textContent = t('run.hintNone');
  else if (mb < 0) el.runHint.textContent = t('limit.minTooBig');
  else if (settings.combine && photos && photos === ok.length) el.runHint.textContent = tn('run.hintCombine', photos, { limit: limitLabel(settings.limit) });
  else if (mb > 0) el.runHint.textContent = tn('run.hintReadyRange', ok.length, { limit: limitLabel(settings.limit), min: minLabel() });
  else el.runHint.textContent = tn('run.hintReady', ok.length, { limit: limitLabel(settings.limit) });
}
function updateSummary() {
  const done = itemList().filter((it) => it.status === 'done' && it.result);
  el.summary.hidden = done.length === 0 || running;
  if (done.length) {
    const fit = done.filter((it) => it.result.fits && !it.result.belowMin).length;
    const limit = limitLabel(done[0].limit);
    el.summaryText.textContent = fit === done.length ? (done.length === 1 ? t('summary.oneFits', { limit }) : t('summary.allFit', { n: done.length, limit })) : t('summary.some', { fit, n: done.length });
    $('#saveAllLabel').textContent = t('files.saveAll', { n: done.length });
  }
}

// ---------- result checks ----------
function checks(it) {
  const r = it.result;
  if (!r) return [];
  const out = [];
  out.push({ ok: r.size <= it.limit, text: t(r.size <= it.limit ? 'checks.max' : 'checks.maxFail', { limit: limitLabel(it.limit), size: fmtBytes(r.size) }) });
  if (it.minBytes > 0) out.push({ ok: r.size >= it.minBytes, mini: true, text: t(r.size >= it.minBytes ? 'checks.min' : 'checks.minFail', { min: it.minLabel }) });
  const fmt = FORMAT_LABEL[r.mime] || (r.ext || '').toUpperCase();
  if (it.wantFormat && r.mode === 'photo') {
    const okF = r.mime === it.wantFormat;
    out.push({ ok: okF, mini: true, text: okF ? t('checks.format', { f: fmt }) : t('checks.formatFail', { f: fmt, want: FORMAT_LABEL[it.wantFormat] }) });
  }
  if (it.wantPx && r.mode === 'photo' && r.width) {
    const okP = r.width === it.wantPx.w && r.height === it.wantPx.h;
    out.push({ ok: okP, mini: true, text: okP ? t('checks.px', { dims: dims(r.width, r.height) }) : t('checks.pxFail', { dims: dims(r.width, r.height), want: dims(it.wantPx.w, it.wantPx.h) }) });
  }
  if (r.mode === 'photo' && !(r.kept && !(r.notes || []).includes('cleaned'))) out.push({ ok: true, text: t('checks.private') });
  if (r.size <= it.limit) out.push({ ok: null, text: t('checks.both') });
  return out;
}

// ---------- processing ----------
function setError(it, e) {
  it.status = 'error';
  it.error = { code: (e && e.code) || 'UNKNOWN' };
}
function outputName(it, r) {
  const base = it.isCombined ? t('row.combinedName') : baseOf(it.name);
  const ext = r.kept && !r.converted ? (it.ext || r.ext || 'jpg') : r.ext;
  let suffix = '';
  if (settings.suffixStyle === 'limit') suffix = r.fits ? `_under-${rawLimitLabel(it.limit).replace(' ', '')}` : '_smaller';
  else if (settings.suffixStyle === 'small') suffix = '_small';
  return `${base}${suffix}.${ext}`;
}
function setResult(it, r) {
  clearResult(it);
  const mime = r.blob.type || (r.mode === 'photo' ? r.mime : 'application/pdf');
  const ext = r.mode === 'photo' ? EXT_FOR[r.mime] || EXT_FOR[mime] || 'jpg' : 'pdf';
  it.result = {
    blob: r.blob, url: URL.createObjectURL(r.blob), size: r.blob.size, fits: !!r.fits, kept: !!r.kept, belowMin: !!r.belowMin,
    quality: r.quality || '', notes: r.notes || [], mode: r.mode, width: r.width, height: r.height, pages: r.pages, mime: r.mode === 'photo' ? (r.mime || mime) : 'application/pdf', ext,
    converted: r.mode === 'photo' && !r.kept && ext !== it.ext && !(ext === 'jpg' && (it.ext === 'jpeg' || it.ext === 'jfif')),
  };
  it.result.name = outputName(it, it.result);
  it.status = 'done';
  it.progress = 1;
}
function progressOf(it) {
  let last = 0;
  return (v, label, vars) => {
    if (v < last) return;
    last = v;
    it.progress = v;
    it.label = label;
    it.vars = vars || null;
    if (!it._raf) it._raf = requestAnimationFrame(() => { it._raf = 0; renderItem(it); });
  };
}
// Applies the minimum size to a finished PDF (photos handle it inside the engine).
async function padPdfIfNeeded(it, r, min, limit) {
  if (!(min > 0) || !r.fits || r.blob.size >= min) return r;
  try {
    it.label = 'reachingMinimum'; renderItem(it);
    const out = await engine.run('pad', { blob: r.blob, min, max: limit });
    if (out && out.blob) return { ...r, blob: out.blob, notes: [...(r.notes || []), 'padded'] };
  } catch (e) { if (e.code === 'CANCELLED') throw e; }
  return { ...r, belowMin: true };
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (running && document.visibilityState === 'visible') keepAwake(true); });

function runContext() {
  const mb = minBytes();
  const w = parseNum(settings.resizeW), h = parseNum(settings.resizeH);
  return {
    limit: settings.limit,
    minBytes: mb > 0 ? mb : 0,
    minLabel: mb > 0 ? minLabel() : '',
    wantFormat: ['image/jpeg', 'image/png', 'image/webp'].includes(settings.photoFormat) ? settings.photoFormat : null,
    wantPx: settings.resizeMode === 'exact' && w > 0 && h > 0 ? { w: Math.round(w), h: Math.round(h) } : null,
  };
}
function stamp(it, ctx) { it.limit = ctx.limit; it.minBytes = ctx.minBytes; it.minLabel = ctx.minLabel; it.wantFormat = ctx.wantFormat; it.wantPx = ctx.wantPx; }

async function runItems(selected) {
  if (running) return;
  const ctx = runContext();
  const list = selected.filter((it) => processable(it) && it.status !== 'analyzing');
  if (!list.length) return;
  const signed = list.filter((it) => it.kind === 'pdf' && it.pdf.signed && !it.pdf.signedOk);
  if (signed.length) {
    const choice = await confirmDialog({
      title: signed.length === 1 ? t('signed.title1') : t('signed.titleN', { n: signed.length }),
      body: `<p>${esc(t('signed.body'))}</p><p>${signed.map((s) => `<b>${bdi(s.name)}</b>`).join(', ')}</p><p class="hint">${esc(t('signed.hint'))}</p>`,
      buttons: [{ label: t('common.cancel'), value: 'cancel' }, { label: t('signed.skip'), value: 'skip' }, { label: t('signed.go'), value: 'go', primary: true }],
    });
    if (choice === 'cancel' || !choice) return;
    for (const s of signed) { if (choice === 'skip') { s.status = 'skipped'; renderItem(s); } else s.pdf.signedOk = true; }
  }
  running = true;
  abort = new AbortController();
  keepAwake(true);
  renderAll();
  try {
    let images = list.filter((it) => it.kind === 'image' && it.status !== 'skipped');
    if (settings.combine) {
      // A photo that can't be opened would spoil the whole PDF: flag it and leave it out.
      for (const bad of images.filter((it) => it.decodeOk === false)) { setError(bad, coded('IMAGE_DECODE')); renderItem(bad); }
      images = images.filter((it) => it.decodeOk !== false);
    }
    const pdfs = list.filter((it) => it.kind === 'pdf' && it.status !== 'skipped');
    if (settings.combine && images.length) await processCombined(images, ctx);
    else for (const it of images) { if (abort.signal.aborted) break; await processPhoto(it, ctx); }
    for (const it of pdfs) { if (abort.signal.aborted) break; await processPdf(it, ctx); }
  } finally {
    running = false;
    abort = null;
    keepAwake(false);
    renderAll();
  }
}
function photoOpts(it, ctx) {
  const opts = {
    limit: ctx.limit, minBytes: ctx.minBytes, mime: settings.photoFormat,
    resize: { mode: settings.resizeMode, w: parseNum(settings.resizeW) || 0, h: parseNum(settings.resizeH) || 0, fit: settings.resizeFit, minW: parseNum(settings.minPxW) || 0, minH: parseNum(settings.minPxH) || 0 },
    rotate: it.rotate, crop: it.crop, clean: settings.clean === 'off' ? null : settings.clean, gray: !!settings.gray,
    strong: settings.strong || it.strong, privacy: true,
  };
  if (opts.resize.mode === 'exact' && !(opts.resize.w > 0 && opts.resize.h > 0)) opts.resize.mode = 'none';
  return opts;
}
async function processPhoto(it, ctx) {
  if (!items.has(it.id)) return;
  stamp(it, ctx);
  it.status = 'working'; it.progress = 0; it.label = 'starting'; it.vars = null;
  renderItem(it);
  try {
    const r = await engine.run('photo', { file: it.file, opts: photoOpts(it, ctx) }, progressOf(it));
    if (!items.has(it.id)) return; // removed while it was being made
    setResult(it, r);
  } catch (e) {
    if (e.code === 'CANCELLED') it.status = 'ready'; else setError(it, e);
  }
  renderItem(it);
}
async function processCombined(images, ctx) {
  let c = items.get(COMBINED_ID);
  if (!c) {
    c = { id: COMBINED_ID, isCombined: true, name: 'combined.pdf', ext: 'pdf', kind: 'pdf', size: 0, status: 'ready', progress: 0, label: '', pdf: {}, thumb: null, result: null, error: null, parts: [], strong: false };
    items.set(COMBINED_ID, c);
    order.unshift(COMBINED_ID);
  }
  c.parts = images.map((it) => it.id);
  c.size = images.reduce((s, it) => s + it.size, 0);
  c.thumb = images[0].thumb;
  stamp(c, ctx);
  c.wantFormat = null; c.wantPx = null;
  c.status = 'working'; c.progress = 0; c.label = 'starting'; c.vars = null;
  for (const it of images) { it.status = 'included'; stamp(it, ctx); }
  renderAll();
  try {
    const pageSize = settings.pageSize === 'auto' ? (/-(US|CA|PH|MX)$/i.test(navigator.language) ? 'letter' : 'a4') : settings.pageSize;
    let r = await engine.run('combine', {
      files: images.map((it) => ({ file: it.file, rotate: it.rotate, crop: it.crop })),
      opts: { limit: ctx.limit, pageSize, margin: settings.margin, strong: settings.strong || c.strong, clean: settings.clean === 'off' ? null : settings.clean, gray: !!settings.gray, title: t('row.combinedName') },
    }, progressOf(c));
    r = await padPdfIfNeeded(c, r, ctx.minBytes, ctx.limit);
    if (!items.has(COMBINED_ID)) return;
    c.pdf.pages = r.pages;
    setResult(c, r);
  } catch (e) {
    for (const it of images) if (it.status === 'included') it.status = 'ready';
    if (e.code === 'CANCELLED') c.status = 'ready';
    else if (e.code === 'IMAGE_DECODE' && /^\d+$/.test(e.message) && images[Number(e.message)]) {
      // The worker says which photo couldn't be opened: mark that one, drop the combined PDF.
      setError(images[Number(e.message)], e);
      c.status = 'ready';
      invalidateCombined();
    } else setError(c, e);
  }
  renderAll();
}
async function scanMode(it, limit, reason) {
  const r = await pdfTools.scanModePdf(it.file, {
    limit, strong: settings.strong || it.strong, password: it.pdf.password, signal: abort && abort.signal, onProgress: progressOf(it), title: baseOf(it.name),
    assemble: async (pages, meta) => (await engine.run('assemble', { pages, meta }, null, pages.map((p) => p.bytes.buffer))).blob,
  });
  r.notes = reason === 'protected' ? ['protected', 'flattened'] : reason === 'rebuild' ? ['rebuilt', 'flattened'] : ['flattened'];
  return r;
}
async function processPdf(it, ctx) {
  if (!items.has(it.id)) return;
  stamp(it, ctx);
  it.wantFormat = null; it.wantPx = null;
  it.status = 'working'; it.progress = 0; it.label = 'starting'; it.vars = null;
  renderItem(it);
  try {
    if (it.pdf.locked) throw coded('PDF_LOCKED');
    let res = null;
    if (!it.pdf.encrypted) {
      try {
        res = await engine.run('pdf', { file: it.file, opts: { limit: ctx.limit, strong: settings.strong || it.strong, privacy: settings.pdfPrivacy } }, progressOf(it));
      } catch (e) {
        if (e.code === 'PDF_ENCRYPTED') it.pdf.encrypted = true;
        else if (e.code === 'VERIFY_FAILED') res = null;
        else throw e;
      }
    }
    if (it.pdf.encrypted) {
      if (it.pdf.needsPassword) { it.status = 'needs-password'; renderItem(it); return; }
      if (it.pdf.canPrint === false) throw coded('PDF_LOCKED');
      res = await scanMode(it, ctx.limit, 'protected');
    } else if ((!res || !res.fits) && settings.pdfScanFallback && !(abort && abort.signal.aborted)) {
      it.label = 'flattening'; it.vars = null;
      let scan = null;
      try { scan = await scanMode(it, ctx.limit, 'fallback'); } catch (e) { if (e.code === 'CANCELLED') throw e; }
      if (scan && (scan.fits || !res || scan.blob.size < res.blob.size)) res = scan;
    }
    if (!res) throw coded('VERIFY_FAILED');
    res = await padPdfIfNeeded(it, res, ctx.minBytes, ctx.limit);
    if (!items.has(it.id)) return;
    setResult(it, res);
  } catch (e) {
    if (e.code === 'CANCELLED') it.status = 'ready'; else setError(it, e);
  }
  renderItem(it);
}
async function rebuildItem(it) {
  if (running) return;
  const ctx = runContext();
  running = true; abort = new AbortController(); keepAwake(true); updateRunButton();
  stamp(it, ctx);
  it.status = 'working'; it.progress = 0; it.label = 'rebuilding'; it.vars = null;
  renderItem(it);
  try { setResult(it, await padPdfIfNeeded(it, await scanMode(it, ctx.limit, 'rebuild'), ctx.minBytes, ctx.limit)); }
  catch (e) { if (e.code === 'CANCELLED') it.status = 'ready'; else { it.pdf.unreadable = true; setError(it, e); } }
  finally { running = false; abort = null; keepAwake(false); renderAll(); }
}
el.btnRun.addEventListener('click', () => {
  if (running) { if (abort) abort.abort(); engine.cancel(); toast(t('toast.stopping')); return; }
  runItems(itemList());
});

// ---------- saving and sharing ----------
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function saveItems(list) {
  const done = list.filter((it) => it.result);
  if (!done.length) return;
  for (let i = 0; i < done.length; i++) {
    downloadBlob(done[i].result.blob, done[i].result.name);
    if (i < done.length - 1) await sleep(700);
  }
  toast(done.length === 1 ? t('toast.saved', { name: fsi(done[0].result.name) }) : tn('toast.savedAll', done.length));
}
async function shareItems(list) {
  const done = list.filter((it) => it.result);
  if (!done.length) return;
  const files = done.map((it) => new File([it.result.blob], it.result.name, { type: it.result.blob.type || it.result.mime || 'application/octet-stream' }));
  let canShare = false;
  try { canShare = !!(navigator.canShare && navigator.canShare({ files })); } catch { canShare = false; }
  if (canShare) {
    try { await navigator.share({ files }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  toast(t('toast.shareFail'));
  await sleep(400);
  for (let i = 0; i < done.length; i++) { downloadBlob(done[i].result.blob, done[i].result.name); if (i < done.length - 1) await sleep(700); }
}
const doneItems = () => itemList().filter((it) => it.status === 'done' && it.result);
$('#btnSaveAll').addEventListener('click', () => saveItems(doneItems()));
$('#btnShareAll').addEventListener('click', () => shareItems(doneItems()));

// ---------- preview ----------
let previewItem = null;
let previewUrls = [];
async function originalPreviewUrl(it, maxSide = 1600) {
  const p = it.dims || (await probeFile(it.file));
  const opts = { imageOrientation: 'from-image', resizeQuality: 'high' };
  if (p && Math.max(p.ow, p.oh) > maxSide) { if (p.ow >= p.oh) opts.resizeWidth = maxSide; else opts.resizeHeight = maxSide; }
  const b = await createImageBitmap(it.file, opts);
  try {
    const rot = it.rotate % 360;
    const rw = rot % 180 ? b.height : b.width, rh = rot % 180 ? b.width : b.height;
    const cr = it.crop || { x: 0, y: 0, w: 1, h: 1 };
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(cr.w * rw)); c.height = Math.max(1, Math.round(cr.h * rh));
    const g = c.getContext('2d');
    g.translate(-cr.x * rw, -cr.y * rh);
    g.translate(rw / 2, rh / 2);
    g.rotate((rot * Math.PI) / 180);
    g.drawImage(b, -b.width / 2, -b.height / 2);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    return { url: URL.createObjectURL(blob), w: c.width, h: c.height };
  } finally { b.close(); }
}
async function openPreview(it) {
  const d = $('#dlgPreview');
  const body = $('#previewBody');
  const tabs = $('#previewTabs');
  const r = it.result;
  previewItem = it;
  for (const u of previewUrls) URL.revokeObjectURL(u);
  previewUrls = [];
  $('#previewTitle').innerHTML = bdi(r.name);
  $('#previewChecks').innerHTML = checks(it).map((c) => `<li class="${c.ok === true ? 'yes' : c.ok === false ? 'no' : 'info'}">${icon(c.ok === false ? 'alert' : c.ok === true ? 'check' : 'shield')}<span>${esc(c.text)}</span></li>`).join('');
  body.innerHTML = '';
  openDialog(d);
  if (r.mode === 'photo') {
    let orig = null;
    try { orig = await originalPreviewUrl(it); previewUrls.push(orig.url); } catch { orig = null; }
    const sameShape = orig && r.width && Math.abs(orig.w / orig.h - r.width / r.height) < 0.01;
    if (orig && sameShape) {
      tabs.hidden = true;
      body.innerHTML = `<div class="compare" style="--ar:${r.width} / ${r.height}"><img class="before" src="${orig.url}" alt=""><img class="after" src="${r.url}" alt=""><div class="handle"></div><span class="tag l">${esc(t('preview.original'))}</span><span class="tag r">${esc(t('preview.result'))}</span><input type="range" min="0" max="100" value="50" aria-label="${esc(t('preview.compareHint'))}"></div><p class="hint" style="margin:10px 0 0">${esc(t('preview.compareHint'))}</p>`;
      const cmp = $('.compare', body);
      $('input', cmp).addEventListener('input', (e) => cmp.style.setProperty('--cut', `${e.target.value}%`));
    } else {
      tabs.hidden = !orig;
      const show = (which) => {
        for (const tb of $$('.tab', tabs)) tb.setAttribute('aria-selected', String(tb.dataset.tab === which));
        const src = which === 'result' ? r.url : orig.url;
        const ar = which === 'result' ? `${r.width} / ${r.height}` : `${orig.w} / ${orig.h}`;
        body.innerHTML = `<div class="compare" style="--ar:${ar}"><img src="${src}" alt=""></div>`;
      };
      tabs.onclick = (e) => { const tb = e.target.closest('.tab'); if (tb) show(tb.dataset.tab); };
      show('result');
    }
  } else {
    tabs.hidden = false;
    const show = async (which) => {
      for (const tb of $$('.tab', tabs)) tb.setAttribute('aria-selected', String(tb.dataset.tab === which));
      body.innerHTML = '<div class="pages"></div>';
      const pages = $('.pages', body);
      try {
        const blob = which === 'result' ? r.blob : it.isCombined ? null : it.file;
        if (!blob) { pages.innerHTML = `<p class="hint">${esc(t('row.included'))}</p>`; return; }
        const info = await pdfTools.renderPreview(blob, pages, { password: which === 'result' ? undefined : it.pdf.password, maxPages: 6, width: Math.min(900, body.clientWidth || 360) });
        if (info.pages > info.shown) pages.insertAdjacentHTML('beforeend', `<p class="more">${esc(t('preview.pagesMore', { shown: info.shown, total: info.pages }))}</p>`);
      } catch { pages.innerHTML = `<p class="hint">${esc(t('preview.cantShow'))}</p>`; }
    };
    tabs.onclick = (e) => { const tb = e.target.closest('.tab'); if (tb) show(tb.dataset.tab); };
    if (it.isCombined) tabs.hidden = true;
    show('result');
  }
}
$('#dlgPreview').addEventListener('close', () => { $('#previewBody').innerHTML = ''; for (const u of previewUrls) URL.revokeObjectURL(u); previewUrls = []; });
$('#previewSave').addEventListener('click', () => { if (previewItem) saveItems([previewItem]); });
$('#previewShare').addEventListener('click', () => { if (previewItem) shareItems([previewItem]); });

// ---------- crop ----------
const cropEditor = new CropEditor({ stage: $('#cropStage'), wrap: $('#cropWrap'), canvas: $('#cropCanvas'), box: $('#cropBox') });
let cropItem = null;
let cropAspectKey = 'free';
function cropAspects() {
  const list = CROP_ASPECTS.slice();
  const w = parseNum(settings.resizeW), h = parseNum(settings.resizeH);
  if (settings.resizeMode === 'exact' && w > 0 && h > 0) list.unshift({ key: 'form', label: () => t('crop.form', { dims: dims(w, h) }), value: w / h });
  return list;
}
function renderCropAspects() {
  const list = cropAspects();
  $('#cropAspects').innerHTML = list.map((a) => `<button class="chip" role="radio" data-aspect="${a.key}" aria-checked="${a.key === cropAspectKey}">${esc(a.label())}</button>`).join('');
  const a = list.find((x) => x.key === cropAspectKey);
  let hint = a && a.value ? t('crop.hintAspect', { a: a.label() }) : t('crop.hintFree');
  if (settings.clean === 'signature') hint += ` ${t('crop.hintSignature')}`;
  $('#cropHint').textContent = hint;
}
const cropButtons = () => [$('#cropDone'), $('#cropRotate'), $('#cropReset')];
async function openCrop(it) {
  cropItem = it;
  const list = cropAspects();
  const wanted = it.cropAspect || settings.cropAspect || 'free';
  cropAspectKey = list.some((a) => a.key === wanted) ? wanted : 'free';
  renderCropAspects();
  for (const b of cropButtons()) b.disabled = true; // until this photo has loaded
  openDialog($('#dlgCrop'));
  try {
    const loaded = await cropEditor.load(it.file, it.rotate, it.crop);
    if (!loaded || cropItem !== it || !$('#dlgCrop').open) return;
    const a = list.find((x) => x.key === cropAspectKey);
    cropEditor.aspect = null;
    if (a && a.value) cropEditor.setAspect(a.value);
    for (const b of cropButtons()) b.disabled = false;
  } catch {
    if (cropItem !== it) return;
    $('#dlgCrop').close();
    setError(it, coded('IMAGE_DECODE'));
    renderItem(it);
  }
}
$('#cropAspects').addEventListener('click', (e) => {
  const b = e.target.closest('[data-aspect]');
  if (!b || !cropEditor.ready) return;
  cropAspectKey = b.dataset.aspect;
  const a = cropAspects().find((x) => x.key === cropAspectKey);
  cropEditor.setAspect(a && a.value ? a.value : null);
  renderCropAspects();
});
$('#cropRotate').addEventListener('click', () => cropEditor.rotate());
$('#cropReset').addEventListener('click', () => cropEditor.reset());
$('#cropDone').addEventListener('click', async () => {
  const it = cropItem;
  if (!it || !cropEditor.ready) return;
  const r = cropEditor.result();
  const changed = r.rotate !== it.rotate || JSON.stringify(r.crop) !== JSON.stringify(it.crop);
  it.rotate = r.rotate;
  it.crop = r.crop;
  it.cropAspect = cropAspectKey;
  $('#dlgCrop').close();
  if (changed) {
    if (it.status === 'done') { it.status = 'ready'; clearResult(it); }
    if (inCombined(it)) invalidateCombined();
    await drawThumb(it);
    renderAll();
  }
});
$('#dlgCrop').addEventListener('close', () => { cropEditor.close(); cropItem = null; });

// ---------- rules ----------
let rulesTimer = 0;
let lastProfiles = [];
function physLabel(p) {
  return t('rules.line.phys', { dims: dims(trimNum(p.physical.w), trimNum(p.physical.h)), unit: t(`unit.${p.physical.unit}`), pdims: dims(p.width, p.height) });
}
function profileLines(p) {
  const lines = [];
  if (p.limit) lines.push(t('rules.line.max', { v: limitLabel(p.limit) }));
  if (p.min) lines.push(t('rules.line.min', { v: limitLabel(p.min) }));
  if (p.width && p.height) lines.push(p.physical ? physLabel(p) : t('rules.line.px', { dims: dims(p.width, p.height) }));
  if (p.minPx) lines.push(t('rules.line.minPx', { dims: dims(p.minPx.w, p.minPx.h) }));
  if (p.maxPx) lines.push(t('rules.line.maxPx', { dims: dims(p.maxPx.w, p.maxPx.h) }));
  if (p.format) lines.push(t('rules.line.format', { f: FORMAT_LABEL[p.format] || p.format }));
  if (p.gray) lines.push(t('rules.line.gray'));
  if (p.type === 'signature') lines.push(t('rules.line.clean'));
  return lines;
}
function renderRules() {
  const text = $('#rulesText').value;
  const out = $('#rulesResult');
  if (!text.trim()) { out.innerHTML = ''; lastProfiles = []; return; }
  const { profiles } = parseRules(text);
  lastProfiles = profiles;
  if (!profiles.length) { out.innerHTML = `<p class="rules-empty">${esc(t('rules.none'))}</p>`; return; }
  out.innerHTML = profiles.map((p, i) => `<div class="rule-card"><h3>${esc(t(`rules.type.${p.type}`))}</h3><ul>${profileLines(p).map((l) => `<li>${icon('check')}<span>${esc(l)}</span></li>`).join('')}</ul><div class="row-buttons"><button class="btn primary" data-use="${i}">${esc(t('rules.use'))}</button><button class="btn" data-saveform="${i}">${esc(t('rules.saveForm'))}</button></div></div>`).join('');
}
function profileToSetup(p) {
  const s = { ...BASE_SETUP, limit: settings.limit, photoFormat: 'auto' };
  if (p.limit) s.limit = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(p.limit)));
  if (p.min && (!p.limit || p.min < p.limit)) {
    if (p.min >= 1e6) { s.minValue = trimNum(p.min / 1e6); s.minUnit = '1000000'; } else { s.minValue = trimNum(p.min / 1e3); s.minUnit = '1000'; }
  }
  if (p.width && p.height) { s.resizeMode = 'exact'; s.resizeW = String(p.width); s.resizeH = String(p.height); s.resizeFit = 'crop'; s.cropAspect = 'form'; }
  else if (p.maxPx) { s.resizeMode = 'max'; s.resizeW = String(p.maxPx.w); s.resizeH = String(p.maxPx.h); }
  if (p.minPx) { s.minPxW = String(p.minPx.w); s.minPxH = String(p.minPx.h); }
  if (p.format === 'image/jpeg' || p.format === 'image/png' || p.format === 'image/webp') s.photoFormat = p.format;
  if (p.format === 'application/pdf' && p.type !== 'signature' && p.type !== 'photo') s.combine = true;
  if (p.type === 'signature') s.clean = 'signature';
  else if (p.type === 'document') s.clean = 'document';
  if (p.gray) s.gray = true;
  return s;
}
$('#rulesText').addEventListener('input', () => { clearTimeout(rulesTimer); rulesTimer = setTimeout(renderRules, 200); });
$('#rulesResult').addEventListener('click', (e) => {
  const use = e.target.closest('[data-use]');
  const save = e.target.closest('[data-saveform]');
  if (!use && !save) return;
  const p = lastProfiles[Number(use ? use.dataset.use : save.dataset.saveform)];
  if (!p) return;
  applySetup(profileToSetup(p));
  $('#dlgRules').close();
  if (save) openSaveForm(`${t(`rules.type.${p.type}`)} ${p.limit ? rawLimitLabel(p.limit) : ''}`.trim());
  else toast(t('rules.applied'));
});
$('#rulesPaste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { $('#rulesText').value = text; renderRules(); } else toast(t('rules.pasteFailed'));
  } catch { toast(t('rules.pasteFailed')); $('#rulesText').focus(); }
});
$('#rulesClear').addEventListener('click', () => { $('#rulesText').value = ''; renderRules(); $('#rulesText').focus(); });
$('#btnRules').addEventListener('click', () => { renderRules(); openDialog($('#dlgRules')); });

// ---------- password ----------
function askPassword(it) {
  const d = $('#dlgPassword');
  const input = $('#passwordInput');
  const err = $('#passwordError');
  $('#passwordName').innerHTML = bdi(it.name);
  input.value = '';
  err.hidden = true;
  const form = $('#passwordForm');
  const onSubmit = async (e) => {
    e.preventDefault();
    $('#passwordSubmit').disabled = true;
    try {
      const info = await pdfTools.analyzePdf(it.file, input.value);
      it.pdf.password = input.value;
      it.pdf.needsPassword = false;
      it.pdf.encrypted = true;
      applyPdfInfo(it, info);
      it.status = 'ready';
      if (it.pdf.locked) setError(it, coded('PDF_LOCKED'));
      d.close();
      renderItem(it);
      updateRunButton();
    } catch (e2) {
      err.textContent = e2.code === 'PDF_WRONG_PASSWORD' ? t('password.wrong') : t('password.cantOpen');
      err.hidden = false;
    } finally { $('#passwordSubmit').disabled = false; }
  };
  form.addEventListener('submit', onSubmit);
  d.addEventListener('close', () => form.removeEventListener('submit', onSubmit), { once: true });
  openDialog(d);
  setTimeout(() => { try { input.focus(); } catch { /* ignore */ } }, 60);
}

// ---------- settings, help, privacy ----------
$('#btnHelp').addEventListener('click', () => openDialog($('#dlgHelp')));
$('#btnSettings').addEventListener('click', () => openDialog($('#dlgSettings')));
$('#btnPrivacy').addEventListener('click', () => openDialog($('#dlgPrivacy')));
$('#btnPrivacy2').addEventListener('click', () => { $('#dlgSettings').close(); openDialog($('#dlgPrivacy')); });
$('#btnResetSettings').addEventListener('click', () => {
  settings = { ...DEFAULTS };
  saveSettings();
  applyTheme();
  applyLanguage();
  syncSettingsUI();
  renderAll();
  toast(t('settings.resetDone'));
});

// ---------- input: picker, camera, drag & drop, paste, share target ----------
$('#btnChoose').addEventListener('click', () => el.fileInput.click());
$('#btnAddMore').addEventListener('click', () => el.fileInput.click());
$('#btnCamera').addEventListener('click', () => el.cameraInput.click());
$('#btnCameraMore').addEventListener('click', () => el.cameraInput.click());
$('#btnClear').addEventListener('click', async () => {
  if (running) return;
  const choice = itemList().length > 1 ? await confirmDialog({ title: t('clear.title'), body: `<p>${esc(t('clear.body'))}</p>`, buttons: [{ label: t('common.cancel'), value: 'cancel' }, { label: t('clear.go'), value: 'go', primary: true }] }) : 'go';
  if (choice !== 'go') return;
  for (const it of itemList()) removeItem(it);
});
el.fileInput.addEventListener('change', () => { addFiles([...el.fileInput.files]); el.fileInput.value = ''; });
el.cameraInput.addEventListener('change', () => {
  const files = [...el.cameraInput.files].map((f, i) => (f.name && !/^image\.(jpe?g|png)$/i.test(f.name) ? f : new File([f], `Photo ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}${i ? `-${i}` : ''}.${EXT_FOR[f.type] || 'jpg'}`, { type: f.type || 'image/jpeg' })));
  addFiles(files);
  el.cameraInput.value = '';
});
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; document.body.classList.remove('dragging');
  const files = [...(e.dataTransfer.files || [])];
  if (files.length) addFiles(files);
});
document.addEventListener('paste', (e) => {
  if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
  const files = [...(e.clipboardData && e.clipboardData.files ? e.clipboardData.files : [])];
  if (!files.length) return;
  e.preventDefault();
  addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `Pasted image ${i + 1}.${EXT_FOR[f.type] || 'png'}`, { type: f.type }))));
});
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const files = [];
    for (const h of params.files || []) { try { files.push(await h.getFile()); } catch { /* skip */ } }
    if (files.length) addFiles(files, 'received');
  });
}
// Files shared from other apps arrive through the service worker (see sw.js).
async function receiveShared() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const keys = await cache.keys();
    const files = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      let name = 'shared';
      try { name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared'); } catch { /* keep */ }
      files.push(new File([blob], name, { type: res.headers.get('Content-Type') || blob.type || '' }));
    }
    await caches.delete(SHARE_CACHE);
    if (files.length) addFiles(files, 'received');
  } catch { /* nothing shared */ }
}

// ---------- offline support ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast(t('toast.update')); });
      });
    } catch { /* offline support unavailable */ }
  });
}

// ---------- boot ----------
// Keep the page's bottom padding equal to the run bar's real height (it grows with a two-line
// hint, the phone's text size and the gesture bar), so nothing ends up hidden behind it.
(() => {
  const bar = document.querySelector('.runbar');
  if (!bar || !('ResizeObserver' in window)) return;
  const set = () => document.documentElement.style.setProperty('--runbar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  new ResizeObserver(set).observe(bar);
  set();
})();
applyTheme();
applyLanguage();
bindSettings();
revealUsedOptions();
renderAll();
// Launch links: home-screen shortcuts (?purpose=…, ?open=rules) and shared files (?share=1).
(() => {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  const p = PURPOSES.find((x) => x.id === q.get('purpose'));
  if (p) applySetup(p.setup);
  if (q.get('open') === 'rules') { renderRules(); openDialog($('#dlgRules')); }
  if (q.has('share')) receiveShared();
})();
window.__mif = { items, order: () => order, settings: () => settings, forms: () => forms, runItems: () => runItems(itemList()), itemList, addFiles, applySetup, parseRules };
