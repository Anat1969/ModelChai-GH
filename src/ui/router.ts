/** Hash routes, so every screen has a link and the app needs no router library. Projects is the home screen. */
import { useSyncExternalStore } from 'react'

export type Route = 'projects' | 'new' | 'studio' | 'compare'
const ROUTES: Route[] = ['projects', 'new', 'studio', 'compare']

export interface Location {
  route: Route
  params: URLSearchParams
}

function parse(hash: string): Location {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const route = (ROUTES as string[]).includes(path) ? (path as Route) : 'projects'
  return { route, params: new URLSearchParams(query) }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parse(window.location.hash).route)
}

/** The query of the current route, e.g. the version id of `#/studio?v=…`. */
export function useParam(name: string): string | null {
  return useSyncExternalStore(subscribe, () => parse(window.location.hash).params.get(name))
}

export function navigate(r: Route, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params)}` : ''
  window.location.hash = `/${r}${q}`
}
