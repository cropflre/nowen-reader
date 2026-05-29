// NowenReader Service Worker
// 注意：升级缓存版本号会让旧版本的缓存（含可能损坏的页面响应）被自动清理。
const CACHE_NAME = "nowen-reader-v2";
const STATIC_CACHE = "nowen-static-v2";
const IMAGE_CACHE = "nowen-images-v2";
const API_CACHE = "nowen-api-v2";

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
    // 检查缓存是否是有效的成功响应：避免把坏响应（500/部分体/空响应）
    // 当成有效缓存返回，导致封面/页面图片永久裂图。
    if (!cached.ok || cached.status !== 200) {
      // 坏缓存，删除并重新拉取
      try {
        const cache = await caches.open(cacheName);
        await cache.delete(request);
      } catch {}
      return fetchAndCache(request, cacheName);
    }
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
    // 同 fetchAndCache：只缓存 200 完整响应，避免坏缓存
    if (response.ok && response.status === 200) {
      const responseClone = response.clone();
      const blob = await responseClone.blob();
      if (blob.size > 0) {
        const cache = await caches.open(cacheName);
        const headers = new Headers(responseClone.headers);
        headers.set("sw-cache-date", new Date().toISOString());
        const cachedResponse = new Response(blob, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers,
        });
        if (request.url.startsWith("http")) {
          cache.put(request, cachedResponse);
        }
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
    // 只缓存真正完整成功的响应（status === 200 且有内容）。
    // 这样避免把 4xx/5xx、部分内容（206）、空 body、被中止的请求等缓存下来，
    // 否则用户下次打开时会拿到坏缓存而看到永久裂图（尤其在 PDF 弹框
    // 同时发起几十个并发渲染请求容易超时/失败）。
    const isCacheable =
      response.ok &&
      response.status === 200 &&
      request.url.startsWith("http");
    if (isCacheable) {
      const responseClone = response.clone();
      const blob = await responseClone.blob();
      // 二次确认 body 非空且 Content-Type 看起来像图片（针对图片缓存场景）
      const contentType = response.headers.get("content-type") || "";
      const isImageCache = cacheName === IMAGE_CACHE;
      const looksLikeImage = !isImageCache || contentType.startsWith("image/");
      if (blob.size > 0 && looksLikeImage) {
        const cache = await caches.open(cacheName);
        const headers = new Headers(responseClone.headers);
        headers.set("sw-cache-date", new Date().toISOString());
        const cachedResponse = new Response(blob, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers,
        });
        cache.put(request, cachedResponse);
      }
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
