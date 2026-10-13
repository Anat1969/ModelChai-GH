/** Two screens until Stage 5 adds Projects: a hash route keeps them linkable without a router library. */
import { useSyncExternalStore } from 'react'

export type Route = 'new' | 'studio'

const read = (): Route => (window.location.hash.replace(/^#\/?/, '') === 'studio' ? 'studio' : 'new')

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb)
      return () => window.removeEventListener('hashchange', cb)
    },
    read,
  )
}

export function navigate(r: Route) {
  window.location.hash = `/${r}`
}
