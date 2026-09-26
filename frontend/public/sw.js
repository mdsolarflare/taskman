/**
 * Taskman service worker — zero-dependency, cache-first app shell.
 *
 * Update model: the build emits `./dist/cache-manifest.js` containing
 * `self.CACHE_MANIFEST = { buildId, files }` where `buildId` is the SHA-256
 * of all shell file hashes. The cache name embeds the buildId, so any
 * content change ships a new cache; the old one is deleted on activate.
 * This is the staleness fix for stable (non-hashed) filenames.
 */

/* global CACHE_MANIFEST — provided by dist/cache-manifest.js at install time */

importScripts("./dist/cache-manifest.js");

const CACHE_NAME = `taskman-shell-${CACHE_MANIFEST.buildId}`;
const PRECACHE_URLS = ["./", ...CACHE_MANIFEST.files.map((f) => `./${f}`)];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
    })(),
  );
});

// New builds wait until the page approves (toast → SKIP_WAITING → reload),
// so an in-flight session never has its shell swapped mid-edit.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Delete every cache that isn't this build's.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle same-origin GETs; skip non-http (chrome-extension:) schemes.
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Navigations: serve the precached index.html (offline SPA fallback).
  if (req.mode === "navigate") {
    event.respondWith(
      caches
        .match("./index.html", { cacheName: CACHE_NAME })
        .then((r) => r ?? fetch(req)),
    );
    return;
  }

  // Everything else: cache-first, then network (and fill cache on miss for
  // in-scope GETs so runtime-fetched assets also go offline).
  event.respondWith(
    caches.match(req, { cacheName: CACHE_NAME }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
