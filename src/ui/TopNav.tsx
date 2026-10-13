import { navigate, useRoute, type Route } from './router'

const LINKS: { route: Route; label: string }[] = [
  { route: 'projects', label: 'פרויקטים' },
  { route: 'new', label: 'מושג חדש' },
  { route: 'studio', label: 'סטודיו' },
]

export interface Crumb {
  label: string
  to?: Route
  params?: Record<string, string>
}

/**
 * One thin bar for the whole app: the brand, where you are (breadcrumbs, with the screen name last) and the
 * main screens. It stays on top, so navigation is always one click away. Text only; no icons.
 */
export function TopNav({ crumbs }: { crumbs: Crumb[] }) {
  const route = useRoute()
  return (
    <header className="topbar">
      <span className="brand">יוצר: מתמטיקה</span>
      <nav className="crumbs" aria-label="מיקום">
        <ol>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <li key={i} aria-current={last ? 'page' : undefined}>
                {c.to && !last ? (
                  <a href={`#/${c.to}`} onClick={(e) => (e.preventDefault(), navigate(c.to!, c.params))}>
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      <nav className="topnav" aria-label="ניווט ראשי">
        {LINKS.map((l) => (
          <a key={l.route} href={`#/${l.route}`} aria-current={route === l.route ? 'page' : undefined} onClick={(e) => (e.preventDefault(), navigate(l.route))}>
            {l.label}
          </a>
        ))}
      </nav>
    </header>
  )
}
