import { ClaudeKey } from './claude/ClaudeKey'
import { navigate, useRoute, type Route } from './router'

/** The development conversation this app is built in (DECISIONS.md 96). */
export const DEV_SESSION_URL = 'https://claude.ai/code/session_01NME4tEKTn9Q8JPNJLsjQWV'

// Two doors only (DECISIONS.md 103): the concepts to learn from, and the projects to work on. The studio, the
// collection and the article are reached from inside a project, on its path.
const LINKS: { route: Route; label: string }[] = [
  { route: 'learn', label: 'מושגים' },
  { route: 'projects', label: 'פרויקטים' },
]

export interface Crumb {
  label: string
  to?: Route
  params?: Record<string, string>
}

/**
 * One thin bar for the whole app (DECISIONS.md 96): the app's mark and name, which lead home; where you are
 * (breadcrumbs, with the screen name last); the main screens; and the A&I logo button (`<ai-menu>` from
 * https://appofapp-gh.vercel.app/ai-menu.js), which holds copy link, the development conversation and
 * installing the app. It stays on top. The mark is the app's one image; the rest is words.
 */
export function TopNav({ crumbs }: { crumbs: Crumb[] }) {
  const route = useRoute()
  return (
    <header className="topbar">
      <a className="brand" href="#/home" onClick={(e) => (e.preventDefault(), navigate('home'))} data-testid="brand" aria-label="יוצר: מתמטיקה, לדף הבית">
        <img className="brand-mark" src="/icon.svg" alt="" width="26" height="26" />
        <span>יוצר: מתמטיקה</span>
      </a>
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
      <ClaudeKey />
      <ai-menu chat={DEV_SESSION_URL} />
    </header>
  )
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'ai-menu': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { chat?: string; research?: string }
    }
  }
}
