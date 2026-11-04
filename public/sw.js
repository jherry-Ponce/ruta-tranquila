// Service worker: guarda la interfaz para que la app instalada abra rápido. Las rutas, el mapa y el
// tráfico necesitan internet, así que /api y los recursos de otros sitios nunca se guardan.
const CACHE = 'voy-tranqui-v3';
const ARCHIVOS = ['/', '/index.html', '/app.js', '/viaje.js', '/almacen.js', '/bateria.js', '/enlaces.js', '/estilos.css', '/icono.svg', '/manifest.webmanifest', '/privacidad.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Primero la red (para recibir siempre la versión nueva); si no hay conexión, la copia guardada.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match('/'))),
  );
});
