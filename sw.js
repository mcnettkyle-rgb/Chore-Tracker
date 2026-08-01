// Service worker: home-screen install + push notifications.
//
// Deliberately does NOT cache app data. A stale chore list is worse than a
// spinner — if a kid marks something done and the parent's tablet shows
// yesterday's cache, the whole thing stops being trustworthy.

// Bumping this name is what retires the previous cache: the activate handler
// below deletes every cache that isn't the current one.
const SHELL_CACHE = 'chore-tracker-shell-v2';
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

// Network-first, so a deploy is picked up on the next load and the cache is
// only ever a fallback for being genuinely offline.
//
// Every same-origin GET is cached, not just the SHELL list above: index.html
// on its own is useless without js/*.js, so a "shell-only" cache would leave
// an offline tablet showing a blank page. Chore data is not at risk from this
// — it all comes from Supabase, which is cross-origin and returns above.
//
// (This is also what the code already did. The old SHELL.some() guard tested
// `pathname.endsWith('')` for the './' entry, which is true of every path, so
// the filter never excluded anything.)
/**
 * The same request, but forced to check with the server.
 *
 * "Network-first" is not enough on its own: fetch() inside a service worker
 * still consults the browser's HTTP cache, and GitHub Pages serves assets with
 * max-age=600. So for ten minutes after a deploy this worker would dutifully
 * go to "the network", be handed the browser's stale copy, and cache that —
 * leaving a tablet showing the old app long after the new one shipped. That is
 * exactly how a deploy appears not to have worked.
 *
 * `no-cache` still allows a conditional request, so an unchanged file costs a
 * 304 rather than a re-download.
 */
function revalidating(request) {
  try {
    return new Request(request, { cache: 'no-cache' });
  } catch {
    // A navigation request can't be reconstructed (its mode is 'navigate').
    // Browsers already revalidate those, so the original is fine.
    return request;
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  event.respondWith(
    fetch(revalidating(event.request))
      .then((response) => {
        if (response.ok) {
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
