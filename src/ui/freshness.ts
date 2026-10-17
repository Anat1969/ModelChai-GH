/**
 * Fresh screens without a manual refresh (DECISIONS.md 125). Two things go stale in an open tab: the app itself,
 * when a new version is deployed, and the data, when it changed elsewhere (another tab, the studio, the phone).
 *
 * The app: every build carries an id, and /version.json holds the id of the one deployed now. The tab checks it
 * when it comes back into view and every few minutes. When they differ, the next move to another screen loads the
 * new version, so nothing typed is lost mid-screen. A screen part that fails to load (an old chunk removed by the
 * deploy) reloads at once, once.
 *
 * The data: a screen hands its loader to useOnReturn, which runs it again when the tab comes back into view.
 */
import { useEffect, useRef } from 'react'

const EVERY = 5 * 60_000
const RELOADED = 'mathcreator-reloaded'

/** A served build id, when there is one, that differs from the running one. */
export const isStale = (running: string, served: string | null | undefined): boolean => !!served && served !== running

let stale = false

async function check() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const { build } = (await res.json()) as { build?: string }
    if (isStale(__BUILD_ID__, build)) stale = true
  } catch {
    // No connection: the running version stays, and the next check tries again.
  }
}

const reload = () => {
  try {
    sessionStorage.setItem(RELOADED, String(Date.now()))
  } catch {
    // Private mode: the reload still happens.
  }
  location.reload()
}

export function startFreshness() {
  if (!import.meta.env.PROD) return
  void check()
  setInterval(() => void check(), EVERY)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    void check()
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {})
  })
  // A move to another screen is the moment to take the new version: the screen being left is done with.
  window.addEventListener('hashchange', () => stale && reload())
  // A part of the old version that the deploy removed: load the new one, but not in a loop.
  window.addEventListener('vite:preloadError', (e) => {
    let last = 0
    try {
      last = Number(sessionStorage.getItem(RELOADED) ?? 0)
    } catch {
      // nothing stored
    }
    if (Date.now() - last < 30_000) return
    e.preventDefault()
    reload()
  })
}

/**
 * Runs `load` again when the tab comes back into view, at most every 10 seconds. `skip` holds it back while
 * something on screen waits to be saved, so what the server sends never overwrites an edit.
 */
export function useOnReturn(load: () => unknown, skip?: () => boolean) {
  const ref = useRef({ load, skip, at: Date.now() })
  ref.current.load = load
  ref.current.skip = skip
  useEffect(() => {
    const back = () => {
      const r = ref.current
      if (document.visibilityState !== 'visible' || Date.now() - r.at < 10_000 || r.skip?.()) return
      r.at = Date.now()
      void r.load()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [])
}
