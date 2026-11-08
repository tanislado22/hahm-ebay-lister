// Staff app worker. Keep the fetch choices aligned with staffFetchPlan:
// private data is never written to Cache Storage.
const CACHE = "vsa-staff-v1";
const OFFLINE_URL = "/guatemala/sin-conexion.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const navigation = event.request.mode === "navigate";
  const api = url.pathname.startsWith("/api/");
  const staff = url.pathname.startsWith("/guatemala/");
  if (!api && !staff) return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" }).catch(() => {
      if (!navigation || api) {
        return new Response("", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      return caches.open(CACHE).then((cache) =>
        cache.match(OFFLINE_URL).then(
          (cached) => cached || new Response("No hay internet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
        )
      );
    })
  );
});
