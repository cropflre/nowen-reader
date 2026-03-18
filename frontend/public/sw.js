// NowenReader Service Worker
const CACHE_NAME = "nowen-reader-v1";
const STATIC_CACHE = "nowen-static-v1";
const IMAGE_CACHE = "nowen-images-v1";
const API_CACHE = "nowen-api-v1";

// Static assets to pre-cache
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
];

// Install: pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  const currentCaches = [CACHE_NAME, STATIC_CACHE, IMAGE_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !currentCaches.includes(name))
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip non-http(s) schemes (e.g. chrome-extension://)
  if (!url.protocol.startsWith("http")) return;

  // API requests: Network first, fallback to cache
  if (url.pathname.startsWith("/api/")) {
    // Cache comic thumbnails and pages aggressively
    if (url.pathname.includes("/thumbnail") || url.pathname.includes("/page/")) {
      event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE, 30 * 24 * 60 * 60));
      return;
    }

    // Cache novel chapter content for offline reading (network-first, 7 days)
    if (url.pathname.match(/\/api\/comics\/[^/]+\/chapter\/\d+/)) {
      event.respondWith(networkFirstStrategy(request, API_CACHE, 7 * 24 * 60 * 60));
      return;
    }

    // Cache comic list API briefly
    if (url.pathname === "/api/comics" && !url.search) {
      event.respondWith(networkFirstStrategy(request, API_CACHE, 60));
      return;
    }

    // Other API: network only
    return;
  }

  // Static assets (JS, CSS, fonts, images): Cache first
  if (
    url.pathname.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/) ||
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(cacheFirstStrategy(request, STATIC_CACHE));
    return;
  }

  // HTML pages: Network first (for SPA navigation)
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstStrategy(request, CACHE_NAME, 300));
    return;
  }

  // Default: Network first
  event.respondWith(networkFirstStrategy(request, CACHE_NAME));
});

// Cache-first strategy (good for static assets and images)
async function cacheFirstStrategy(request, cacheName, maxAge) {
  const cached = await caches.match(request);
  if (cached) {
    // Check if cached response is still fresh (if maxAge specified)
    if (maxAge) {
      const dateHeader = cached.headers.get("sw-cache-date");
      if (dateHeader) {
        const cacheDate = new Date(dateHeader).getTime();
        if (Date.now() - cacheDate > maxAge * 1000) {
          // Expired, fetch fresh
          return fetchAndCache(request, cacheName);
        }
      }
    }
    return cached;
  }
  return fetchAndCache(request, cacheName);
}

// Network-first strategy (good for dynamic content)
async function networkFirstStrategy(request, cacheName, maxAge) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      const responseClone = response.clone();
      // Add cache date header
      const headers = new Headers(responseClone.headers);
      headers.set("sw-cache-date", new Date().toISOString());
      const cachedResponse = new Response(await responseClone.blob(), {
        status: responseClone.status,
        statusText: responseClone.statusText,
        headers,
      });
      if (request.url.startsWith("http")) {
        cache.put(request, cachedResponse);
      }
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Return offline page for HTML requests
    if (request.headers.get("accept")?.includes("text/html")) {
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NowenReader - Offline</title><style>body{background:#09090b;color:#fafafa;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}div{text-align:center}h1{color:#6366f1}p{color:#a1a1aa}button{background:#6366f1;color:#fff;border:none;padding:8px 24px;border-radius:8px;cursor:pointer;margin-top:16px}</style></head><body><div><h1>NowenReader</h1><p>You are currently offline</p><button onclick="location.reload()">Retry</button></div></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("Offline", { status: 503 });
  }
}

// Fetch and cache helper
async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && request.url.startsWith("http")) {
      const cache = await caches.open(cacheName);
      const responseClone = response.clone();
      const headers = new Headers(responseClone.headers);
      headers.set("sw-cache-date", new Date().toISOString());
      const cachedResponse = new Response(await responseClone.blob(), {
        status: responseClone.status,
        statusText: responseClone.statusText,
        headers,
      });
      cache.put(request, cachedResponse);
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

// Listen for messages from the app
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_CACHE") {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});
