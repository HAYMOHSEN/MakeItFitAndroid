// Make It Fit (Android) — service worker: keeps the whole app available offline and receives
// files shared from other apps. Cache names start with "mifa-" so they never touch the caches
// of other apps on the same website.
const VERSION = 'mifa-__VERSION__';
const SHARE_CACHE = 'mifa-share';
const ASSETS = __ASSETS__;

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
