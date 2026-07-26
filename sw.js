// Service worker: home-screen install + push notifications.
//
// Deliberately does NOT cache app data. A stale chore list is worse than a
// spinner — if a kid marks something done and the parent's tablet shows
// yesterday's cache, the whole thing stops being trustworthy.

const SHELL_CACHE = 'chore-tracker-shell-v1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for the shell so a deploy is picked up on the next load;
// the cache is only a fallback for being genuinely offline.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && SHELL.some((path) => url.pathname.endsWith(path.replace('./', '')))) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? Response.error())),
  );
});

// ---------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Chores', body: event.data ? event.data.text() : 'Something needs checking' };
  }

  const title = payload.title || 'Chore to check';
  const options = {
    body: payload.body || 'Someone marked a chore done.',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: payload.tag || 'chore-review',
    renotify: true,
    data: { url: payload.url || './' },
    actions: [{ action: 'open', title: 'Review' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
