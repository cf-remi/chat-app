const CACHE_NAME = "chat-app-shell-v1";
const OFFLINE_URL = "/offline.html";

// Cache the app shell on install so we can show an offline page
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Remove old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigation; fall back to offline page if both fail
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((r) => r || new Response("Offline", { status: 503 }))
    )
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Chat App", body: event.data.text() };
  }

  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-96.png",
    tag: data.tag || "chat-message",
    data: {
      url: data.url || "/",
      channelId: data.channelId,
    },
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Chat App", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If the app is already open, navigate it to the target URL and focus it
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.postMessage({ type: "NOTIFICATION_CLICK", url: targetUrl });
            return client.focus();
          }
        }
        // Otherwise open a new window at the target URL
        return clients.openWindow(targetUrl);
      })
  );
});
