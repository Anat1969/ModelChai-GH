import { useState } from 'react'
import { install, useInstall } from './install'
import { navigate, useRoute, type Route } from './router'

/** The development conversation this app is built in (DECISIONS.md 96). */
export const DEV_SESSION_URL = 'https://claude.ai/code/session_01NME4tEKTn9Q8JPNJLsjQWV'

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
 * One thin bar for the whole app (DECISIONS.md 96): the app's mark and name, which lead home; where you are
 * (breadcrumbs, with the screen name last); the main screens; and four tools: copy this page's link, the
 * development conversation, the research project, and installing the app. It stays on top. The mark is the
 * app's one image; the rest is words.
 */
export function TopNav({ crumbs }: { crumbs: Crumb[] }) {
  const route = useRoute()
  const installState = useInstall()
  const [said, setSaid] = useState<string | null>(null)
  const say = (text: string) => {
    setSaid(text)
    setTimeout(() => setSaid((s) => (s === text ? null : s)), 2500)
  }
  const copyLink = async () => {
    const ok = await navigator.clipboard?.writeText(location.href).then(
      () => true,
      () => false,
    )
    say(ok ? 'הקישור הועתק' : 'ההעתקה נכשלה. אפשר להעתיק משורת הכתובת.')
  }
  const onInstall = async () => {
    if (!(await install())) say('בתפריט הדפדפן: "התקנת האפליקציה" או "הוספה למסך הבית".')
  }
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
      <div className="topbar-tools" role="group" aria-label="כלים">
        <button type="button" className="quiet" onClick={copyLink} data-testid="copy-link">
          העתקת קישור
        </button>
        <a className="toollink" href={DEV_SESSION_URL} target="_blank" rel="noreferrer" data-testid="dev-session">
          שיחת הפיתוח
        </a>
        <a className="toollink" href={`${location.origin}/#/projects`} target="_blank" rel="noreferrer" data-testid="research-project">
          פרויקט המחקר
        </a>
        {installState !== 'installed' && (
          <button type="button" className="quiet" onClick={onInstall} data-testid="install-app">
            התקנה
          </button>
        )}
        {said && (
          <span className="topbar-said" role="status" data-testid="topbar-said">
            {said}
          </span>
        )}
      </div>
    </header>
  )
}
