/*
 * The app's service worker (DECISIONS.md 95): it makes the app installable and keeps the last version of each
 * file for when there is no connection. The network always comes first, so a new deploy reaches the screen at
 * once. Requests to other origins (Supabase, fonts) are left alone.
 */
const CACHE = 'mathcreator-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match('/'))),
  )
})
