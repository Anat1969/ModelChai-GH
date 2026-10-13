import { navigate, useRoute, type Route } from './router'

const LINKS: { route: Route; label: string }[] = [
  { route: 'projects', label: 'פרויקטים' },
  { route: 'new', label: 'מושג חדש' },
  { route: 'studio', label: 'סטודיו' },
]

/** Text-only navigation; no icons. */
export function TopNav() {
  const route = useRoute()
  return (
    <nav className="topnav" aria-label="ניווט ראשי">
      <span className="brand">יוצר: מתמטיקה</span>
      {LINKS.map((l) => (
        <a key={l.route} href={`#/${l.route}`} aria-current={route === l.route ? 'page' : undefined} onClick={(e) => (e.preventDefault(), navigate(l.route))}>
          {l.label}
        </a>
      ))}
    </nav>
  )
}
