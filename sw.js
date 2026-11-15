// TroShare service worker.
// Pages, scripts and styles are network-first, so a new deploy shows up on the next load;
// the cache is only a fallback for offline use. Images are cache-first because they rarely change.
const CACHE = 'troshare-v11';
const ASSETS = [
  './', './index.html', './styles.css', './data.js', './app.js', './intro.js', './manifest.webmanifest',
  './vendor/model-viewer.min.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './images/map.jpg', './images/bean.jpg', './images/lamp.jpg', './images/floor.jpg',
  './images/fan.jpg', './images/topper.jpg', './images/tv.jpg', './images/cart.jpg', './images/sample-room.jpg',
  './models/lamp.glb', './models/lamp.usdz', './models/floor.glb', './models/floor.usdz',
  './models/fan.glb', './models/fan.usdz', './models/bean.glb', './models/bean.usdz',
  './models/tv.glb', './models/tv.usdz', './models/topper.glb', './models/topper.usdz',
  './models/cart.glb', './models/cart.usdz'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a new version never caches old files.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// iOS AR Quick Look only accepts USDZ when the response type is model/vnd.usdz+zip.
// GitHub Pages and Python's http.server send these as a generic download, so fix it here.
function modelType(url) {
  const path = new URL(url, self.location).pathname;
  if (path.endsWith('.usdz')) return 'model/vnd.usdz+zip';
  if (path.endsWith('.glb')) return 'model/gltf-binary';
  return '';
}
function withModelType(res, url) {
  const type = modelType(url);
  if (!type || !res) return res;
  const headers = new Headers(res.headers);
  headers.set('Content-Type', type);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function remember(request, response) {
  if (response.ok && new URL(request.url).origin === location.origin) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return withModelType(response, request.url);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.destination === 'image') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => remember(req, res))));
    return;
  }

  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => remember(req, res))
      .catch(() => caches.match(req).then((hit) => (hit && withModelType(hit, req.url)) || caches.match('./index.html')))
  );
});
