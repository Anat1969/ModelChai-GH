import { navigate, useRoute } from './router'

/** Text-only navigation; no icons. */
export function TopNav() {
  const route = useRoute()
  return (
    <nav className="topnav" aria-label="ניווט ראשי">
      <span className="brand">יוצר: מתמטיקה</span>
      <a href="#/new" aria-current={route === 'new' ? 'page' : undefined} onClick={(e) => (e.preventDefault(), navigate('new'))}>
        מושג חדש
      </a>
      <a href="#/studio" aria-current={route === 'studio' ? 'page' : undefined} onClick={(e) => (e.preventDefault(), navigate('studio'))}>
        סטודיו
      </a>
    </nav>
  )
}
