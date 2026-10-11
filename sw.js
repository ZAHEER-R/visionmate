const CACHE_NAME = "visionmate-shell-v12";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./assets/logo.png",
  "./js/app.js",
  "./js/auth.js",
  "./js/camera.js",
  "./js/config.js",
  "./js/firebase.js",
  "./js/gsap-animations.js",
  "./js/intent.js",
  "./js/routes.js",
  "./js/mt.js",
  "./js/speech.js",
  "./js/stt.js",
  "./js/supabase.js",
  "./js/tts.js",
  "./js/cv.js",
  "./js/anuvaadhub.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("visionmate-shell-") && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "cache-emergency-screen") {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add("./?emergency=1")));
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (!response.ok || response.type !== "basic") return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => {
      if (request.mode === "navigate") return caches.match("./index.html");
      if (new URL(request.url).pathname.endsWith("/js/runtime-config.js")) {
        return new Response("globalThis.VISIONMATE_CONFIG = {};", {
          headers: { "Content-Type": "text/javascript" }
        });
      }
      throw new Error("This app resource is unavailable offline.");
    });
  }));
});
