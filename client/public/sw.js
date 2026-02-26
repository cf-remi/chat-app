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
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
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

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
