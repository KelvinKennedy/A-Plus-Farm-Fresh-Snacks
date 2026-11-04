/* Service worker: lets the shop open offline after the visitor has loaded it once.
   Put this file next to index.html (the site root). Change VERSION when you update the site
   so visitors get fresh files. */
const VERSION = 'aps-v9';

const PRECACHE = [
  './',
  'index.html', 'shop.html', 'about.html',
  'css/style.css', 'css/hover.css', 'css/rounded.css', 'css/slideshow.css', 'css/extras.css',
  'js/app.js', 'js/home.js', 'js/throttle.js', 'js/slideshow.js', 'js/defaults.js', 'js/config.js', 'js/firebase.js'
];
for (let n = 1; n <= 17; n++) {
  PRECACHE.push('images/slides/snack' + n + '.jpg');
  PRECACHE.push('images/slides/snack' + n + '.webp'); /* missing files are skipped */
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      /* add files one by one so one missing file does not stop the rest */
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameSite = url.origin === self.location.origin;
  const library = /(^|\.)gstatic\.com$/.test(url.hostname) || url.hostname === 'fonts.googleapis.com';

  if (!sameSite && !library) return;                 /* Firestore and Auth calls are never touched */
  if (sameSite && url.pathname.includes('/admin/')) return; /* admin always loads fresh */

  /* Pages: try the network first, use the saved copy when offline */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req)
            .then((hit) => hit || caches.match('index.html'))
            .then((hit) => hit || caches.match('./'))
            .then((hit) => hit || Response.error())
        )
    );
    return;
  }

  /* Everything else: show the saved copy at once, and refresh it in the background */
  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit || Response.error());
        return hit || fresh;
      })
    )
  );
});