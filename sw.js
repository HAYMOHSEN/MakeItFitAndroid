// Make It Fit (Android) — service worker: keeps the whole app available offline and receives
// files shared from other apps. Cache names start with "mifa-" so they never touch the caches
// of other apps on the same website.
const VERSION = 'mifa-1.0.0-d533c97b57';
const SHARE_CACHE = 'mifa-share';
const ASSETS = ["./", "./app.js", "./index.html", "./manifest.webmanifest", "./privacy.html", "./styles.css", "./engine/image-engine.js", "./engine/pad.js", "./engine/pdf-engine.js", "./engine/prepare.js", "./engine/probe.js", "./engine/worker.js", "./icons/favicon.svg", "./icons/icon-192.png", "./icons/icon-48.png", "./icons/icon-512.png", "./icons/icon.svg", "./icons/maskable-512.png", "./icons/monochrome-512.png", "./icons/shortcut-photo-96.png", "./icons/shortcut-rules-96.png", "./icons/shortcut-signature-96.png", "./js/crop.js", "./js/i18n.js", "./js/pdf-tools.js", "./js/rules.js", "./lib/pdf-lib.min.js", "./lib/pdfjs/pdf.min.js", "./lib/pdfjs/pdf.worker.min.js", "./lib/pdfjs/cmaps/78-EUC-H.bcmap", "./lib/pdfjs/cmaps/78-EUC-V.bcmap", "./lib/pdfjs/cmaps/78-H.bcmap", "./lib/pdfjs/cmaps/78-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/78-RKSJ-V.bcmap", "./lib/pdfjs/cmaps/78-V.bcmap", "./lib/pdfjs/cmaps/78ms-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/78ms-RKSJ-V.bcmap", "./lib/pdfjs/cmaps/83pv-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/90ms-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/90ms-RKSJ-V.bcmap", "./lib/pdfjs/cmaps/90msp-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/90msp-RKSJ-V.bcmap", "./lib/pdfjs/cmaps/90pv-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/90pv-RKSJ-V.bcmap", "./lib/pdfjs/cmaps/Add-H.bcmap", "./lib/pdfjs/cmaps/Add-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/Add-RKSJ-V.bcmap", "./lib/pdfjs/cmaps/Add-V.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-0.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-1.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-2.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-3.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-4.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-5.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-6.bcmap", "./lib/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap", "./lib/pdfjs/cmaps/Adobe-GB1-0.bcmap", "./lib/pdfjs/cmaps/Adobe-GB1-1.bcmap", "./lib/pdfjs/cmaps/Adobe-GB1-2.bcmap", "./lib/pdfjs/cmaps/Adobe-GB1-3.bcmap", "./lib/pdfjs/cmaps/Adobe-GB1-4.bcmap", "./lib/pdfjs/cmaps/Adobe-GB1-5.bcmap", "./lib/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-0.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-1.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-2.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-3.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-4.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-5.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-6.bcmap", "./lib/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap", "./lib/pdfjs/cmaps/Adobe-Korea1-0.bcmap", "./lib/pdfjs/cmaps/Adobe-Korea1-1.bcmap", "./lib/pdfjs/cmaps/Adobe-Korea1-2.bcmap", "./lib/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap", "./lib/pdfjs/cmaps/B5-H.bcmap", "./lib/pdfjs/cmaps/B5-V.bcmap", "./lib/pdfjs/cmaps/B5pc-H.bcmap", "./lib/pdfjs/cmaps/B5pc-V.bcmap", "./lib/pdfjs/cmaps/CNS-EUC-H.bcmap", "./lib/pdfjs/cmaps/CNS-EUC-V.bcmap", "./lib/pdfjs/cmaps/CNS1-H.bcmap", "./lib/pdfjs/cmaps/CNS1-V.bcmap", "./lib/pdfjs/cmaps/CNS2-H.bcmap", "./lib/pdfjs/cmaps/CNS2-V.bcmap", "./lib/pdfjs/cmaps/ETHK-B5-H.bcmap", "./lib/pdfjs/cmaps/ETHK-B5-V.bcmap", "./lib/pdfjs/cmaps/ETen-B5-H.bcmap", "./lib/pdfjs/cmaps/ETen-B5-V.bcmap", "./lib/pdfjs/cmaps/ETenms-B5-H.bcmap", "./lib/pdfjs/cmaps/ETenms-B5-V.bcmap", "./lib/pdfjs/cmaps/EUC-H.bcmap", "./lib/pdfjs/cmaps/EUC-V.bcmap", "./lib/pdfjs/cmaps/Ext-H.bcmap", "./lib/pdfjs/cmaps/Ext-RKSJ-H.bcmap", "./lib/pdfjs/cmaps/Ext-RKSJ-V.bcmap", "./lib/pdfjs/cmaps/Ext-V.bcmap", "./lib/pdfjs/cmaps/GB-EUC-H.bcmap", "./lib/pdfjs/cmaps/GB-EUC-V.bcmap", "./lib/pdfjs/cmaps/GB-H.bcmap", "./lib/pdfjs/cmaps/GB-V.bcmap", "./lib/pdfjs/cmaps/GBK-EUC-H.bcmap", "./lib/pdfjs/cmaps/GBK-EUC-V.bcmap", "./lib/pdfjs/cmaps/GBK2K-H.bcmap", "./lib/pdfjs/cmaps/GBK2K-V.bcmap", "./lib/pdfjs/cmaps/GBKp-EUC-H.bcmap", "./lib/pdfjs/cmaps/GBKp-EUC-V.bcmap", "./lib/pdfjs/cmaps/GBT-EUC-H.bcmap", "./lib/pdfjs/cmaps/GBT-EUC-V.bcmap", "./lib/pdfjs/cmaps/GBT-H.bcmap", "./lib/pdfjs/cmaps/GBT-V.bcmap", "./lib/pdfjs/cmaps/GBTpc-EUC-H.bcmap", "./lib/pdfjs/cmaps/GBTpc-EUC-V.bcmap", "./lib/pdfjs/cmaps/GBpc-EUC-H.bcmap", "./lib/pdfjs/cmaps/GBpc-EUC-V.bcmap", "./lib/pdfjs/cmaps/H.bcmap", "./lib/pdfjs/cmaps/HKdla-B5-H.bcmap", "./lib/pdfjs/cmaps/HKdla-B5-V.bcmap", "./lib/pdfjs/cmaps/HKdlb-B5-H.bcmap", "./lib/pdfjs/cmaps/HKdlb-B5-V.bcmap", "./lib/pdfjs/cmaps/HKgccs-B5-H.bcmap", "./lib/pdfjs/cmaps/HKgccs-B5-V.bcmap", "./lib/pdfjs/cmaps/HKm314-B5-H.bcmap", "./lib/pdfjs/cmaps/HKm314-B5-V.bcmap", "./lib/pdfjs/cmaps/HKm471-B5-H.bcmap", "./lib/pdfjs/cmaps/HKm471-B5-V.bcmap", "./lib/pdfjs/cmaps/HKscs-B5-H.bcmap", "./lib/pdfjs/cmaps/HKscs-B5-V.bcmap", "./lib/pdfjs/cmaps/Hankaku.bcmap", "./lib/pdfjs/cmaps/Hiragana.bcmap", "./lib/pdfjs/cmaps/KSC-EUC-H.bcmap", "./lib/pdfjs/cmaps/KSC-EUC-V.bcmap", "./lib/pdfjs/cmaps/KSC-H.bcmap", "./lib/pdfjs/cmaps/KSC-Johab-H.bcmap", "./lib/pdfjs/cmaps/KSC-Johab-V.bcmap", "./lib/pdfjs/cmaps/KSC-V.bcmap", "./lib/pdfjs/cmaps/KSCms-UHC-H.bcmap", "./lib/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap", "./lib/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap", "./lib/pdfjs/cmaps/KSCms-UHC-V.bcmap", "./lib/pdfjs/cmaps/KSCpc-EUC-H.bcmap", "./lib/pdfjs/cmaps/KSCpc-EUC-V.bcmap", "./lib/pdfjs/cmaps/Katakana.bcmap", "./lib/pdfjs/cmaps/NWP-H.bcmap", "./lib/pdfjs/cmaps/NWP-V.bcmap", "./lib/pdfjs/cmaps/RKSJ-H.bcmap", "./lib/pdfjs/cmaps/RKSJ-V.bcmap", "./lib/pdfjs/cmaps/Roman.bcmap", "./lib/pdfjs/cmaps/UniCNS-UCS2-H.bcmap", "./lib/pdfjs/cmaps/UniCNS-UCS2-V.bcmap", "./lib/pdfjs/cmaps/UniCNS-UTF16-H.bcmap", "./lib/pdfjs/cmaps/UniCNS-UTF16-V.bcmap", "./lib/pdfjs/cmaps/UniCNS-UTF32-H.bcmap", "./lib/pdfjs/cmaps/UniCNS-UTF32-V.bcmap", "./lib/pdfjs/cmaps/UniCNS-UTF8-H.bcmap", "./lib/pdfjs/cmaps/UniCNS-UTF8-V.bcmap", "./lib/pdfjs/cmaps/UniGB-UCS2-H.bcmap", "./lib/pdfjs/cmaps/UniGB-UCS2-V.bcmap", "./lib/pdfjs/cmaps/UniGB-UTF16-H.bcmap", "./lib/pdfjs/cmaps/UniGB-UTF16-V.bcmap", "./lib/pdfjs/cmaps/UniGB-UTF32-H.bcmap", "./lib/pdfjs/cmaps/UniGB-UTF32-V.bcmap", "./lib/pdfjs/cmaps/UniGB-UTF8-H.bcmap", "./lib/pdfjs/cmaps/UniGB-UTF8-V.bcmap", "./lib/pdfjs/cmaps/UniJIS-UCS2-H.bcmap", "./lib/pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap", "./lib/pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap", "./lib/pdfjs/cmaps/UniJIS-UCS2-V.bcmap", "./lib/pdfjs/cmaps/UniJIS-UTF16-H.bcmap", "./lib/pdfjs/cmaps/UniJIS-UTF16-V.bcmap", "./lib/pdfjs/cmaps/UniJIS-UTF32-H.bcmap", "./lib/pdfjs/cmaps/UniJIS-UTF32-V.bcmap", "./lib/pdfjs/cmaps/UniJIS-UTF8-H.bcmap", "./lib/pdfjs/cmaps/UniJIS-UTF8-V.bcmap", "./lib/pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap", "./lib/pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap", "./lib/pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap", "./lib/pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap", "./lib/pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap", "./lib/pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap", "./lib/pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap", "./lib/pdfjs/cmaps/UniJISPro-UCS2-V.bcmap", "./lib/pdfjs/cmaps/UniJISPro-UTF8-V.bcmap", "./lib/pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap", "./lib/pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap", "./lib/pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap", "./lib/pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap", "./lib/pdfjs/cmaps/UniKS-UCS2-H.bcmap", "./lib/pdfjs/cmaps/UniKS-UCS2-V.bcmap", "./lib/pdfjs/cmaps/UniKS-UTF16-H.bcmap", "./lib/pdfjs/cmaps/UniKS-UTF16-V.bcmap", "./lib/pdfjs/cmaps/UniKS-UTF32-H.bcmap", "./lib/pdfjs/cmaps/UniKS-UTF32-V.bcmap", "./lib/pdfjs/cmaps/UniKS-UTF8-H.bcmap", "./lib/pdfjs/cmaps/UniKS-UTF8-V.bcmap", "./lib/pdfjs/cmaps/V.bcmap", "./lib/pdfjs/cmaps/WP-Symbol.bcmap", "./lib/pdfjs/iccs/CGATS001Compat-v2-micro.icc", "./lib/pdfjs/standard_fonts/FoxitDingbats.pfb", "./lib/pdfjs/standard_fonts/FoxitFixed.pfb", "./lib/pdfjs/standard_fonts/FoxitFixedBold.pfb", "./lib/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb", "./lib/pdfjs/standard_fonts/FoxitFixedItalic.pfb", "./lib/pdfjs/standard_fonts/FoxitSerif.pfb", "./lib/pdfjs/standard_fonts/FoxitSerifBold.pfb", "./lib/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb", "./lib/pdfjs/standard_fonts/FoxitSerifItalic.pfb", "./lib/pdfjs/standard_fonts/FoxitSymbol.pfb", "./lib/pdfjs/standard_fonts/LiberationSans-Bold.ttf", "./lib/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf", "./lib/pdfjs/standard_fonts/LiberationSans-Italic.ttf", "./lib/pdfjs/standard_fonts/LiberationSans-Regular.ttf", "./lib/pdfjs/wasm/jbig2.wasm", "./lib/pdfjs/wasm/openjpeg.wasm", "./lib/pdfjs/wasm/qcms_bg.wasm"];

// A new version waits until the app is closed, so a running app never mixes old and new files.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mifa-') && k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// "Share to Make It Fit": Android posts the files here; keep them and open the app.
async function receiveShare(request) {
  try {
    const data = await request.formData();
    const files = data.getAll('files').filter((f) => f && typeof f === 'object' && 'size' in f);
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    let i = 0;
    for (const f of files) {
      const headers = { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || `shared-${i + 1}`) };
      await cache.put(new Request(`./__shared/${String(i).padStart(3, '0')}`), new Response(f, { headers }));
      i++;
    }
  } catch { /* open the app anyway */ }
  return Response.redirect('./?share=1', 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  // Everything comes from this version's cache, so the app starts instantly and offline.
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(VERSION)
      .then(async (c) => (await c.match(req, { ignoreSearch: true })) || (url.pathname.endsWith('/') ? c.match('./') : undefined))
      .then((cached) => cached || fetch(req)));
    return;
  }
  e.respondWith(caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true })).then((cached) => {
    if (cached) return cached;
    return fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    });
  }));
});
