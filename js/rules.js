// Make It Fit — reads upload rules written in English or Arabic, e.g.
//   "Photo: JPG, between 20 KB and 50 KB, 200 x 230 pixels. Signature: 10-20 KB, 140x60 px"
//   "الصورة الشخصية بصيغة JPG وبحجم لا يتجاوز 100 كيلوبايت وأبعاد 4×6 سم"
// and turns them into settings. Pure functions, no browser APIs (tested in Node).

const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

export function normalizeText(text) {
  return String(text || '')
    .replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d])
    .replace(/(\d)٫(\d)/g, '$1.$2')
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2') // 1,5 MB -> 1.5 MB (2+ digit groups like 1,000 stay)
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d{1,3})[ \u00a0\u202f](\d{3})(?=\s*(?:kb|mb|k\.b|m\.b|kilo|mega|كيلو|ميجا|ميغا))/gi, '$1$2')
    .replace(/[ً-ْـ]/g, '') // Arabic diacritics and tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[×✕✖]/g, 'x')
    .replace(/[–—−]/g, '-')
    .replace(/،/g, ',')
    .replace(/‏|‎/g, '')
    .toLowerCase();
}

// Units. Order matters: longer spellings first.
const KB = '(?:kilo\\s?-?bytes?|kbytes?|kibibytes?|kib|kbs|k\\.?\\s?b\\.?|كيلو\\s?-?\\s?بايت|كيلوبايت|كيلو|ك\\.?\\s?ب\\.?|kb)';
const MB = '(?:mega\\s?-?bytes?|mbytes?|mebibytes?|mib|mbs|m\\.?\\s?b\\.?|ميجا\\s?-?\\s?بايت|ميغا\\s?-?\\s?بايت|ميجابايت|ميغابايت|ميجا|ميغا|م\\.?\\s?ب\\.?|mb)';
const BYTES = '(?:bytes?|بايت)';
const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const RANGE_SEP = '\\s*(?:-|~|to|and|until|till|الي|حتي|و|ل)\\s*';

const unitBytes = (u) => {
  if (new RegExp(`^${MB}$`, 'i').test(u)) return 1e6;
  if (new RegExp(`^${KB}$`, 'i').test(u)) return 1e3;
  return 1;
};

// Comparison words and the way they point when used plainly: "upper" = the number is a
// maximum ("under 50 KB"), "lower" = a minimum ("at least 10 KB"). A negation just before a
// relative word flips it ("not more than" = maximum, "not less than" = minimum); absolute
// words (max, minimum, at least, up to…) never flip.
const WORDS = [
  // [pattern, direction, absolute]
  ['max(?:imum)?\\.?', 'upper', true], ['at\\s+most', 'upper', true], ['up\\s*to', 'upper', true], ['limit(?:ed)?(?:\\s+to)?', 'upper', true],
  ['within', 'upper', true], ['under', 'upper', false], ['below', 'upper', false], ['less\\s+than', 'upper', false],
  ['smaller\\s+than', 'upper', false], ['lower\\s+than', 'upper', false], ['<=?', 'upper', true], ['≤', 'upper', true],
  ['min(?:imum)?\\.?', 'lower', true], ['at\\s+least', 'lower', true], ['more\\s+than', 'lower', false], ['larger\\s+than', 'lower', false],
  ['bigger\\s+than', 'lower', false], ['greater\\s+than', 'lower', false], ['higher\\s+than', 'lower', false], ['above', 'lower', false],
  ['over', 'lower', false], ['exceed(?:s|ing)?', 'lower', false], ['>=?', 'lower', true], ['≥', 'lower', true],
  ['حد(?:ها)?\\s+(?:ال)?اقصي', 'upper', true], ['الحد\\s+الاقصي', 'upper', true], ['اقصي', 'upper', true], ['لغايه', 'upper', true], ['حتي', 'upper', true],
  ['اقل\\s+من', 'upper', false], ['اصغر\\s+من', 'upper', false], ['[يت]قل', 'upper', false],
  ['حد(?:ها)?\\s+(?:ال)?ادني', 'lower', true], ['الحد\\s+الادني', 'lower', true], ['ادني', 'lower', true], ['علي\\s+الاقل', 'lower', true],
  ['اكثر\\s+من', 'lower', false], ['اكبر\\s+من', 'lower', false], ['[يت]زيد', 'lower', false], ['[يت]تجاوز', 'lower', false], ['[يت]تعدي', 'lower', false],
];
const WORD_RE = new RegExp(WORDS.map(([w]) => `(${w})`).join('|'), 'gi');
const NEGATION = /(?:\bnot\b|n['’]t\b|\bcannot\b|\bnever\b|\bno\b|(?:^|\s)[وف]?(?:لا|لن|ليس|غير|عدم|الا))\s*(?:\S+\s+){0,2}$/i;
const ASCII_WORD = /^[a-z]/i;
// Letters that attach to the front of an Arabic word: and, so, to, with, the.
const ARABIC_PREFIXES = new Set(['', 'و', 'ف', 'ل', 'ب', 'ال', 'وال', 'فال', 'بال', 'لل', 'ول', 'وب']);

function keywordsIn(text) {
  const out = [];
  WORD_RE.lastIndex = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const k = m.slice(1).findIndex((g) => g !== undefined);
    const [, dir, absolute] = WORDS[k];
    // English words must stand alone ("over" not in "overall", "under" not in "understand").
    const prev = text[m.index - 1] || ' ', next = text[m.index + m[0].length] || ' ';
    if (ASCII_WORD.test(m[0]) && (/[a-z]/i.test(prev) || /[a-z]/i.test(next))) continue;
    // Arabic words must stand alone too ("تقل" in "مستقلة" is not "less"); و/ف/ل may be attached in front.
    if (/^[\u0600-\u06ff]/.test(m[0])) {
      if (/[\u0600-\u06ff]/.test(next)) continue;
      const pre = (text.slice(0, m.index).match(/[\u0600-\u06ff]*$/) || [''])[0];
      if (!ARABIC_PREFIXES.has(pre)) continue;
    }
    let d = dir;
    if (!absolute && NEGATION.test(text.slice(Math.max(0, m.index - 20), m.index))) d = dir === 'upper' ? 'lower' : 'upper';
    out.push({ index: m.index, end: m.index + m[0].length, len: m[0].length, dir: d, absolute });
  }
  return out;
}

// "files over 2 MB are rejected": a limit phrased as a rejection, directly after the number.
const REJECTED = /^\s*(?:files?|images?|photos?|ones?|which|that|are|is|will|would|shall|may|be|get|الملفات|التي|سوف|س)?\s*(?:\S+\s+){0,2}?(?:be\s+)?(reject|not\s+(?:be\s+)?(?:accepted|allowed|uploaded|valid)|won['’]?t\s+be|cannot\s+be|can['’]t\s+be|refused|invalid|لن\s+(?:يقبل|تقبل|يتم)|مرفوض|غير\s+مقبول|لا\s+(?:يقبل|تقبل))/i;

function roleOf(t, start, end) {
  // Look back to the start of the clause (sentence, line, comma, or the previous number).
  let before = t.slice(Math.max(0, start - 50), start);
  let cut = Math.max(before.lastIndexOf('\n'), before.lastIndexOf(';'), before.lastIndexOf(','), before.search(/\d[^\d]*$/));
  for (const m of before.matchAll(/(?<!\bmax|\bmin|\bapprox|\bno)[.!?؟](?=\s)/gi)) cut = Math.max(cut, m.index);
  if (cut >= 0) before = before.slice(cut + 1);
  const tail = t.slice(end, end + 50).split(/[,;.\n]|\bor\b|\botherwise\b|\bbut\b|وال[اإ]|والا|\sاو\s/)[0];
  const kb = keywordsIn(before);
  let best = null;
  for (const k of kb) {
    const dist = before.length - k.end;
    if (!best || dist < best.dist || (dist === best.dist && k.len > best.len)) best = { ...k, dist };
  }
  if (best) {
    let dir = best.dir;
    if (!best.absolute && REJECTED.test(tail)) dir = dir === 'upper' ? 'lower' : 'upper';
    return { role: dir === 'upper' ? 'max' : 'min', explicit: true };
  }
  // "50 KB max", "20 KB minimum", "2 MB or smaller", "50 كيلوبايت كحد اقصي"
  const after = t.slice(end, end + 22).split(/[,;.\n]/)[0];
  // "100 KB < size", "500 KB > file": the number is on the left of the comparison.
  if (/^\s*<=?\s*(?:size|file|image|photo|x|الحجم|حجم)/i.test(after)) return { role: 'min', explicit: true };
  if (/^\s*>=?\s*(?:size|file|image|photo|x|الحجم|حجم)/i.test(after)) return { role: 'max', explicit: true };
  const flipIfRejected = (role, phraseLen) => (REJECTED.test(t.slice(end + phraseLen, end + phraseLen + 45).split(/[,;.\n]|\botherwise\b|\bbut\b/)[0]) ? (role === 'max' ? 'min' : 'max') : role);
  let m2 = after.match(/^\s*(?:or\s+(?:less|smaller|lower|below)|and\s+(?:below|under|less))/i);
  if (m2) return { role: flipIfRejected('max', m2[0].length), explicit: true };
  m2 = after.match(/^\s*(?:or\s+(?:more|larger|bigger|higher|above|greater)|and\s+(?:above|over|more))/i);
  if (m2) return { role: flipIfRejected('min', m2[0].length), explicit: true };
  const ka = keywordsIn(after).filter((k) => k.absolute && k.index <= 6);
  if (ka.length) return { role: ka[0].dir === 'upper' ? 'max' : 'min', explicit: true };
  if (/^\s*(?:او\s+اقل|فما\s+دون|او\s+اصغر)/.test(after)) return { role: 'max', explicit: true };
  if (/^\s*(?:او\s+اكثر|فما\s+فوق|او\s+اكبر)/.test(after)) return { role: 'min', explicit: true };
  // No direction words: a size on its own is a limit, unless the text says it gets rejected.
  if (REJECTED.test(tail)) return { role: 'min', explicit: true };
  return { role: 'max', explicit: false };
}

const TOTAL_WORDS = /(\btotal\b|\bin\s+total\b|\bcombined\b|\baltogether\b|\ball\s+files\b|\boverall\b|\bupload\s+limit\b|المجموع|الاجمالي|اجمالي|مجموع|جميع\s+الملفات|كل\s+الملفات)/i;
const EACH_WORDS = /(\beach\b|\bper\s+(?:file|image|photo|document)\b|\bevery\s+file\b|لكل\s+ملف|كل\s+ملف|لكل\s+صوره)/i;

const SECTION_WORDS = [
  ['signature', /(\bsign(?:ature)?s?\b|[\u0600-\u06ff]*توقيع[\u0600-\u06ff]*)/gi],
  ['photo', /(\bphoto(?:graph)?s?\b|\bpictures?\b|\bimages?\b|\bportraits?\b|[\u0600-\u06ff]*صور[\u0600-\u06ff]*)/gi],
  ['document', /(document|certificate|transcript|\bid\s+card|passport\s+copy|\bpdf\s+file|وثيقه|الوثيقه|شهاده|الشهاده|مستند|المستند|كشف|هويه|الهويه|جواز)/gi],
];

function findSizes(t) {
  const out = [];
  const used = [];
  const overlaps = (s, e) => used.some(([a, b]) => s < b && e > a);
  // Ranges: "20-50 kb", "20 kb - 50 kb", "between 20 and 50 kb", "من 20 الي 50 كيلوبايت"
  const unit = `(${MB}|${KB}|${BYTES})`;
  const range = new RegExp(`${NUM}\\s*${unit}?${RANGE_SEP}${NUM}\\s*${unit}(?![a-z\\u0600-\\u06ff])`, 'gi');
  for (const m of t.matchAll(range)) {
    const u2 = m[4];
    const u1 = m[2] || u2;
    const a = parseFloat(m[1]) * unitBytes(u1);
    const b = parseFloat(m[3]) * unitBytes(u2);
    if (!(a > 0 && b > 0) || a === b) continue;
    out.push({ kind: 'range', min: Math.min(a, b), max: Math.max(a, b), index: m.index, end: m.index + m[0].length });
    used.push([m.index, m.index + m[0].length]);
  }
  const single = new RegExp(`${NUM}\\s*${unit}(?![a-z\\u0600-\\u06ff])|${NUM}\\s*k(?![a-z\\u0600-\\u06ff])`, 'gi');
  for (const m of t.matchAll(single)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    let bytes;
    if (m[1]) bytes = parseFloat(m[1]) * unitBytes(m[2]);
    else { const v = parseFloat(m[3]); if (!(v >= 10)) continue; bytes = v * 1e3; } // "4K" is a screen resolution, not 4 KB
    if (!(bytes > 0)) continue;
    const { role, explicit } = roleOf(t, m.index, m.index + m[0].length);
    const ctx = t.slice(Math.max(0, m.index - 45), Math.min(t.length, m.index + m[0].length + 25));
    out.push({ kind: role, bytes, index: m.index, end: m.index + m[0].length, explicit, total: TOTAL_WORDS.test(ctx) && !EACH_WORDS.test(ctx), each: EACH_WORDS.test(ctx) });
  }
  return out.sort((a, b) => a.index - b.index);
}

const PX = '(?:px|pixels?|pixel|pix|بكسل|بيكسل|بكسيل|نقطه)';
const CM = '(?:cm|centimet(?:er|re)s?|سم|سنتيمتر|سنتمتر|سانتي|سانتيمتر)';
const MM = '(?:mm|millimet(?:er|re)s?|مم|مليمتر|ملم)';
const IN = '(?:inch(?:es)?|in\\b|"|انش|بوصه)';

function findDims(t) {
  const out = [];
  const pair = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${PX}|${CM}|${MM}|${IN})?\\s*(?:x|\\*|by|في)\\s*(\\d+(?:\\.\\d+)?)\\s*(${PX}|${CM}|${MM}|${IN})?`, 'gi');
  for (const m of t.matchAll(pair)) {
    const u = (m[4] || m[2] || '').toLowerCase();
    const w = parseFloat(m[1]), h = parseFloat(m[3]);
    if (!(w > 0 && h > 0)) continue;
    let unitKind = 'px';
    if (new RegExp(`^${CM}$`, 'i').test(u)) unitKind = 'cm';
    else if (new RegExp(`^${MM}$`, 'i').test(u)) unitKind = 'mm';
    else if (new RegExp(`^${IN}$`, 'i').test(u)) unitKind = 'in';
    else if (!u) {
      // Bare "200x230": pixels when the numbers are big enough; small ones (3.5x4.5) are ambiguous.
      if (w < 16 || h < 16) continue;
    }
    // "at least 640 x 480 pixels" is a minimum resolution, "no larger than 1024 x 768" a maximum.
    const r = roleOf(t, m.index, m.index + m[0].length);
    out.push({ w, h, unit: unitKind, index: m.index, role: r.explicit ? r.role : 'exact' });
  }
  // "width 200 ... height 230", "العرض 200 ... الارتفاع 230"
  const wm = t.match(new RegExp(`(?:width|wide|العرض|عرض)\\s*(?:of|is|:|=|-)?\\s*(\\d+(?:\\.\\d+)?)\\s*(${PX}|${CM}|${MM})?`, 'i'));
  const hm = t.match(new RegExp(`(?:height|high|tall|الارتفاع|ارتفاع|الطول|طول)\\s*(?:of|is|:|=|-)?\\s*(\\d+(?:\\.\\d+)?)\\s*(${PX}|${CM}|${MM})?`, 'i'));
  if (!out.length && wm && hm) {
    const u = (wm[2] || hm[2] || '').toLowerCase();
    const unitKind = new RegExp(`^${CM}$`, 'i').test(u) ? 'cm' : new RegExp(`^${MM}$`, 'i').test(u) ? 'mm' : 'px';
    out.push({ w: parseFloat(wm[1]), h: parseFloat(hm[1]), unit: unitKind, index: Math.min(wm.index, hm.index), role: 'exact' });
  }
  return out;
}

function findFormat(t) {
  const has = (re) => re.test(t);
  const jpg = has(/\b(jpe?g|jfif)\b|جي\s?بي\s?جي/i);
  const png = has(/\bpng\b/i);
  const pdf = has(/\bpdf\b/i);
  const webp = has(/\bwebp\b/i);
  if (jpg) return 'image/jpeg';
  if (png && !pdf) return 'image/png';
  if (pdf && !png) return 'application/pdf';
  if (webp) return 'image/webp';
  return null;
}

const PHYS = { cm: 1 / 2.54, mm: 1 / 25.4, in: 1 };

function buildProfile(type, t) {
  // "size (KB): 20-50", "size in KB: 50": the unit comes before the numbers.
  t = t.replace(/(?:\bin\s+|\()\s*(kb|mb|كيلوبايت|ميجابايت)\s*\)?\s*[:=]?\s*(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?/gi,
    (m, u, a, b) => (b ? ` ${a} ${u} - ${b} ${u} ` : ` ${a} ${u} `));
  const sizes = findSizes(t);
  const p = { type };
  let max = null, min = null;
  const ranges = sizes.filter((x) => x.kind === 'range');
  if (ranges.length) { max = ranges[0].max; min = ranges[0].min; }
  // A per-file limit beats a total upload limit; several limits for one item: the strictest.
  let maxes = sizes.filter((x) => x.kind === 'max');
  if (maxes.some((x) => !x.total)) maxes = maxes.filter((x) => !x.total);
  if (maxes.some((x) => x.each)) maxes = maxes.filter((x) => x.each);
  if (maxes.length) { const v = Math.min(...maxes.map((x) => x.bytes)); max = max == null ? v : Math.min(max, v); }
  const mins = sizes.filter((x) => x.kind === 'min');
  if (mins.length) { const v = Math.max(...mins.map((x) => x.bytes)); min = min == null ? v : Math.max(min, v); }
  if (max != null && min != null && min >= max) { const keep = Math.max(min, max); min = null; max = keep; }
  if (max != null) p.limit = Math.round(max);
  if (min != null) p.min = Math.round(min);
  const dims = findDims(t);
  if (dims.length) {
    const d = dims[0];
    let w = d.w, h = d.h, physical = null;
    if (d.unit !== 'px') { const k = PHYS[d.unit] * 300; w = d.w * k; h = d.h * k; physical = { w: d.w, h: d.h, unit: d.unit }; } // print size at 300 dpi
    w = Math.round(w); h = Math.round(h);
    // Phones handle up to 4096 x 4096 (16.7 megapixels); larger "rules" are almost surely misreads.
    if (w >= 16 && h >= 16 && w <= 8000 && h <= 8000 && w * h <= 4096 * 4096) {
      if (d.role === 'min') p.minPx = { w, h };
      else if (d.role === 'max') p.maxPx = { w, h };
      else { p.width = w; p.height = h; p.aspect = physical ? [d.w, d.h] : [w, h]; if (physical) p.physical = physical; }
    }
  }
  const fmt = findFormat(t);
  if (fmt) p.format = fmt;
  if (/(black\s*(?:and|&|\/)\s*white|grey\s*scale|gray\s*scale|greyscale|grayscale|monochrome|ابيض\s*و\s*اسود|ابيض\s+واسود|رمادي|تدرج\s+رمادي)/i.test(t)) p.gray = true;
  return p;
}

const meaningful = (p) => p.limit != null || p.min != null || p.width != null || p.minPx || p.maxPx || p.format != null || p.gray;

/**
 * Returns { profiles: [ {type, limit, min, width, height, aspect, physical, format, gray} ] }.
 * When the text describes several items (photo, signature, document), one profile per item.
 */
export function parseRules(text) {
  const t = normalizeText(text);
  if (!t.trim()) return { profiles: [] };
  const marks = [];
  for (const [type, re] of SECTION_WORDS) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) marks.push({ type, index: m.index, end: m.index + m[0].length });
  }
  marks.sort((a, b) => a.index - b.index);
  // "signature image", "scanned image of your signature": two words for one item. Within a
  // short distance the more specific word wins (signature > document > photo).
  // "photo & signature", "الصورة والتوقيع": one rule for both items.
  const PRIORITY = { signature: 3, document: 2, photo: 1 };
  const sections = [];
  for (const m of marks) {
    const last = sections[sections.length - 1];
    if (last && last.types.includes(m.type) && m.index - last.at < 25) { last.at = m.index; last.endAt = m.end; continue; }
    if (last && m.index - last.at < 25 && !/\d/.test(t.slice(last.at, m.index))) {
      const between = t.slice(last.endAt, m.index).trim();
      const word = t.slice(m.index, m.end);
      if (/^(?:&|and|or|\/|,|و|او)$/.test(between) || (between === '' && /^و[\u0600-\u06ff]/.test(word))) {
        if (!last.types.includes(m.type)) last.types.push(m.type);
      } else if (last.types.length === 1 && PRIORITY[m.type] > PRIORITY[last.types[0]]) last.types = [m.type];
      last.at = m.index; last.endAt = m.end;
      continue;
    }
    sections.push({ types: [m.type], start: m.index, at: m.index, endAt: m.end });
  }
  for (let i = sections.length - 1; i > 0; i--) if (sections[i].types.join() === sections[i - 1].types.join()) sections.splice(i, 1);
  const profiles = [];
  const add = (p) => {
    if (!meaningful(p)) return;
    const same = profiles.find((x) => x.type === p.type);
    if (same) { for (const k of Object.keys(p)) if (same[k] == null) same[k] = p[k]; } else profiles.push(p);
  };
  if (sections.length >= 2 || (sections.length === 1 && sections[0].types.length > 1)) {
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const start = i === 0 ? 0 : s.start;
      const end = i + 1 < sections.length ? sections[i + 1].start : t.length;
      const p = buildProfile(s.types[0], t.slice(start, end));
      for (const type of s.types) add({ ...p, type });
    }
  }
  if (!profiles.length) {
    // "file must be under 100 KB, signature under 50 KB": a general rule before the first item.
    const first = sections[0];
    if (first && first.start > 0) {
      const pre = buildProfile('any', t.slice(0, first.start));
      const own = buildProfile(first.types[0], t.slice(first.start));
      if (pre.limit != null && (own.limit != null || own.min != null)) { add(pre); for (const type of first.types) add({ ...own, type }); }
    }
  }
  if (!profiles.length) add(buildProfile(sections.length === 1 ? sections[0].types[0] : 'any', t));
  // "…both under 50 KB": a shared limit fills in where an item has none.
  if (profiles.length > 1 && /\b(?:both|all\s+of\s+them|each\s+of\s+them)\b|كلاهما|كليهما|لكليهما|لكلاهما|لكل\s+منهما/.test(t)) {
    const withLimit = profiles.filter((x) => x.limit != null);
    if (withLimit.length === 1) for (const x of profiles) { if (x.limit == null) x.limit = withLimit[0].limit; if (x.min == null && withLimit[0].min != null) x.min = withLimit[0].min; }
  }
  return { profiles };
}
