const CACHE_NAME = "purdue-ball-v1";
const PRECACHE = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/main.js",
  "/purdue_ballers.png",
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.json"
];

// ─── Install: precache shell ────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ─────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: network-first for API, cache-first for shell ──
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // ESPN API calls: always go to network (live data)
  if (url.hostname.includes("espn")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // App shell: try cache, fallback to network
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// ─── Push notifications ─────────────────────────
self.addEventListener("push", (e) => {
  let data = { title: "Purdue Ball", body: "Boiler Up! 🚂" };
  if (e.data) {
    try {
      data = e.data.json();
    } catch {
      data.body = e.data.text();
    }
  }

  e.waitUntil(
    self.registration.showNotification(data.title || "Purdue Ball", {
      body: data.body || "",
      icon: "/purdue_ballers.png",
      badge: "/favicon.svg",
      data: data.url || "/",
      vibrate: [200, 100, 200]
    })
  );
});

// ─── Notification click: open the app ───────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const targetUrl = e.notification.data || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
