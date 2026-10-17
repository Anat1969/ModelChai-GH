/**
 * Projects (PRODUCT.md "מסכים" 1): the concepts with their latest snapshot, and one primary button, "מושג חדש".
 * Each project lists its versions; two of them can be opened side by side.
 */
import { useCallback, useEffect, useState } from 'react'
import { loadDraft, pendingSaves } from '../../data/offline'
import { listProjects, type ProjectSummary } from '../../data/projects'
import { ensureSession, type SessionState } from '../../data/supabase'
import { EmailLogin } from '../panels/EmailLogin'
import { navigate } from '../router'
import { TopNav } from '../TopNav'
import { ExamplesGallery } from '../panels/ExamplesGallery'

type Load = { status: 'loading' } | { status: 'ready'; projects: ProjectSummary[] } | { status: 'error'; message: string }

const when = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })

function ProjectCard({ p }: { p: ProjectSummary }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const latest = p.versions[0]
  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs.slice(-1), id]))
  // Versions are numbered from the first, so "גרסה 3" means the same thing everywhere.
  const number = (id: string) => p.versions.length - p.versions.findIndex((v) => v.id === id)

  return (
    <article className="project panel" data-testid="project" data-project={p.id}>
      <div className="project-thumb">
        {p.thumbnail ? <img className="snapshot" src={p.thumbnail} alt={`צילום של ${p.title_he}`} /> : <span className="hint">אין צילום</span>}
      </div>
      <div className="project-body">
        <h2>{p.title_he}</h2>
        <p className="hint">
          {p.concept} · {p.versions.length === 1 ? 'גרסה אחת' : `${p.versions.length} גרסאות`} · עודכן {when(p.updated_at)}
        </p>
        <div className="toolbar">
          {latest && (
            <button type="button" className="primary" onClick={() => navigate('studio', { v: latest.id })} data-testid="open-latest">
              פתיחה בסטודיו
            </button>
          )}
          <button type="button" onClick={() => navigate('project', { p: p.id })} data-testid="open-work">
            מסלול העבודה
          </button>
          <button type="button" onClick={() => navigate('collection', { p: p.id })} data-testid="open-collection">
            קולקציה
          </button>
          <button type="button" onClick={() => navigate('dossier', { p: p.id })} data-testid="open-dossier">
            מסמך
          </button>
          <button type="button" onClick={() => navigate('library', { p: p.id })} data-testid="open-library">
            ספרייה
          </button>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="toggle-versions">
            {open ? 'הסתרת הגרסאות' : 'גרסאות והשוואה'}
          </button>
        </div>
        {open && (
          <div className="versions">
            <ol reversed>
              {p.versions.map((v) => (
                <li key={v.id} data-testid="version" data-version={v.id}>
                  <label className="check">
                    <input type="checkbox" checked={picked.includes(v.id)} onChange={() => toggle(v.id)} data-testid="pick-version" />
                    גרסה {number(v.id)}
                    {v.note ? `: ${v.note}` : ''}
                  </label>
                  <span className="hint">
                    {when(v.created_at)}
                    {v.parent_id ? ` · נגזרה מגרסה ${number(v.parent_id)}` : ' · הגרסה הראשונה'}
                  </span>
                  <button type="button" onClick={() => navigate('studio', { v: v.id })}>
                    פתיחה
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="primary"
              disabled={picked.length !== 2}
              onClick={() => {
                // The older version on the start side, the newer one beside it.
                const [a, b] = [...picked].sort((x, y) => number(x) - number(y))
                navigate('compare', { a: a!, b: b! })
              }}
              data-testid="compare"
            >
              {picked.length === 2 ? 'השוואה זו לצד זו' : 'בוחרים שתי גרסאות להשוואה'}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export function Projects() {
  const [session, setSession] = useState<SessionState | null>(null)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const draft = loadDraft()
  const pending = pendingSaves().length

  const refresh = useCallback(async () => {
    setLoad({ status: 'loading' })
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') {
      setLoad({ status: 'ready', projects: [] })
      return
    }
    try {
      setLoad({ status: 'ready', projects: await listProjects() })
    } catch (e) {
      setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'פרויקטים' }]} />
      <header className="screen">
        <span className="eyebrow">מתמטיקה הפוכה</span>
        <h1>פרויקטים</h1>
        <p className="lead">כל מושג שנשמר, עם הצילום האחרון שלו. כל שמירה היא גרסה שלא משתנה, ואפשר להעמיד שתיים זו לצד זו.</p>
        <div className="toolbar">
          <button type="button" className="primary" onClick={() => navigate('new')} data-testid="new-concept">
            מושג חדש
          </button>
        </div>
      </header>

      {pending > 0 && (
        <p className="notice info" role="status" data-testid="pending">
          {pending === 1 ? 'גרסה אחת נשמרה במכשיר' : `${pending} גרסאות נשמרו במכשיר`} ותישלח כשהחיבור לשרת יחזור.
        </p>
      )}
      {draft && (
        <div className="notice info" data-testid="draft">
          <p>
            <strong>טיוטה שלא נשמרה</strong>, מ-{new Date(draft.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
            {draft.project ? `, בפרויקט ${draft.project.title_he}` : ''}.
          </p>
          <button type="button" onClick={() => navigate('studio')}>
            המשך עבודה על הטיוטה
          </button>
        </div>
      )}

      {session?.status === 'needs-email' && <EmailLogin why="הפרויקטים נשמרים בחשבון." />}
      {session?.status === 'error' && (
        <div className="notice error" role="alert">
          <p>החיבור נכשל: {session.message}</p>
          <button type="button" onClick={refresh}>
            ניסיון חוזר
          </button>
        </div>
      )}

      {load.status === 'loading' && (
        <p className="hint" role="status">
          טוען פרויקטים
        </p>
      )}
      {load.status === 'error' && (
        <div className="notice error" role="alert" data-testid="projects-error">
          <p>{load.message}</p>
          <button type="button" onClick={refresh}>
            ניסיון חוזר
          </button>
        </div>
      )}
      {load.status === 'ready' && session?.status === 'signed-in' && load.projects.length === 0 && (
        <p className="hint" data-testid="empty">
          עוד אין פרויקטים. מתחילים במושג חדש, או פותחים את הסטודיו עם מודל הייחוס ושומרים גרסה.
        </p>
      )}
      {load.status === 'ready' && load.projects.length > 0 && (
        <div className="projects">
          {load.projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <ExamplesGallery />
    </div>
  )
}
