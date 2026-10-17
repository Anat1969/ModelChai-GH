/** Hash routes, so every screen has a link and the app needs no router library. The landing page is home (DECISIONS.md 97). */
import { useSyncExternalStore } from 'react'

export type Route = 'home' | 'project' | 'article' | 'projects' | 'new' | 'studio' | 'compare' | 'library' | 'collection' | 'dossier' | 'connect'
const ROUTES: Route[] = ['home', 'project', 'article', 'projects', 'new', 'studio', 'compare', 'library', 'collection', 'dossier', 'connect']

export interface Location {
  route: Route
  params: URLSearchParams
}

function parse(hash: string): Location {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const route = (ROUTES as string[]).includes(path) ? (path as Route) : 'home'
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
