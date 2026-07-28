// Service worker: this file runs independently of any open tab. The browser
// (via the OS's own push service) wakes this up when a push arrives, even if
// the page isn't open and the screen is off. This is the piece that makes
// "background / screen-off" notifications actually possible.

self.addEventListener('push', (event) => {
  let data = { title: '⏰ 偶運會提醒', body: '時間快到了' };
  try {
    if (event.data) data = event.data.json();
  } catch (err) {
    // ignore malformed payloads
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: undefined,
      badge: undefined,
      tag: data.title + data.body, // collapse duplicate pushes for the same reminder
      vibrate: [500, 250, 500, 250, 500, 250, 500], // long, unmistakable vibration pattern
      silent: false, // explicit: let the device play its default notification sound
      requireInteraction: true, // stays on screen until the person dismisses it, instead of auto-disappearing
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
