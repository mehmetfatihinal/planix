self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  const payload = event.data.json();
  const options = {
    body: payload.body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: {
      url: payload.url,
      taskId: payload.taskId,
      token: payload.token
    },
    actions: payload.actions ?? []
  };

  event.waitUntil(self.registration.showNotification(payload.title ?? "Planix", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { url, token } = event.notification.data ?? {};
  const action = event.action || "open";
  const targetUrl = new URL(url || "/today", self.location.origin);

  if (action === "complete" || action === "snooze-1h") {
    event.waitUntil(
      fetch(`${self.location.origin}/api/notification-action-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action })
      }).catch(() => undefined)
    );
  }

  if (action === "open") {
    targetUrl.searchParams.set("notificationAction", "focus");
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl.toString());
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl.toString());
    })
  );
});
