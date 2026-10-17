/**
 * The landing page (DECISIONS.md 97): what the app is for, what it makes, and the nine steps from an idea to a
 * built model and an article for the exhibition. Two ways in: a new project, which can start from one
 * sentence, or one of the projects already under way.
 */
import { useEffect, useState } from 'react'
import { listProjects, type ProjectSummary } from '../../data/projects'
import { ensureSession, type SessionState } from '../../data/supabase'
import { createProject } from '../../data/work'
import { STAGES } from '../../journey/stages'
import { MODELS } from '../../learn/atlas'
import { EmailLogin } from '../panels/EmailLogin'
import { navigate } from '../router'
import { TopNav } from '../TopNav'

const when = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })

const OUTCOMES = [
  { title: 'מודל שאפשר למדוד', text: 'מבנה שהמושג המתמטי הוא הלוגיקה שלו, עם קנה מידה, גובה חופשי, משקל, ואור של מקום ושעה.' },
  { title: 'המחשה', text: 'פרומפט שנגזר מהמודל, והתמונה שנוצרה ממנו, עם הסבר איך היא מבטאת את הרעיון ואיך היא חוזרת אל המבנה.' },
  { title: 'מבנה פיזי', text: 'קובץ הדפסה סגור, בקנה מידה ובעובי דופן שעומדים במדפסת, ותיעוד של המודל המודפס.' },
  { title: 'סרטון', text: 'מבטים שבוחרים ומסדרים, ממצב ערום שמבהיר את הגאומטריה אל המבנה בחומר ובמקום.' },
  { title: 'מאמר לתערוכה', text: 'כל הטקסטים והתמונות של הפרויקט, ערוכים לסיפור אחד מהרעיון ועד התוצאה. PDF להצגה ו-Word לעריכה.' },
]

export function Home() {
  const [session, setSession] = useState<SessionState | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [title, setTitle] = useState('')
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    void ensureSession().then(async (s) => {
      setSession(s)
      if (s.status !== 'signed-in') return
      try {
        setProjects(await listProjects())
      } catch {
        setProjects([])
      }
    })
  }, [])

  const start = async () => {
    setBusy(true)
    setStatus('')
    try {
      const s = session?.status === 'signed-in' ? session : await ensureSession()
      if (s.status !== 'signed-in') throw new Error('אין חיבור לחשבון')
      const id = await createProject({ title, idea })
      navigate('project', { p: id, s: 'discover' })
    } catch (e) {
      setStatus(`הפרויקט לא נוצר: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.`)
      setBusy(false)
    }
  }

  return (
    <div className="wrap home">
      <TopNav crumbs={[{ label: 'בית' }]} />

      <section className="home-hero" aria-labelledby="home-title">
        <span className="eyebrow">מתמטיקה הפוכה · מרחב ללמידה וליצירה</span>
        <h1 id="home-title">מושגים מתמטיים שפותחים אפשרויות אדריכליות</h1>
        <p className="lead">
          מכירים מודל מתמטי, מבינים את ה־DNA שלו ומה הוא עושה לתנועה ולשימוש, מחברים אותו למקום ולהשראה, ובונים ממנו מודל, המחשה, דגם מודפס, סרטון ומאמר לתערוכה. Claude שותף לחקירה: מציע מושגים, מסביר את הבחירה, מציג חלופות ופותח ידע.
        </p>
        <div className="home-doors">
          <button type="button" className="home-door" onClick={() => navigate('learn')} data-testid="door-learn">
            <strong>לגלות מושג</strong>
            <span>{MODELS.length} מודלים: מה כל אחד פותח, ולמה</span>
          </button>
          <button type="button" className="home-door" onClick={() => navigate('learn', { mode: 'need' })} data-testid="door-need">
            <strong>יש לי צורך</strong>
            <span>כניסה לעיר, גשר, הצללה: אילו מושגים משרתים אותו</span>
          </button>
        </div>
        <p className="hint">אפשר להתחיל מחומרים חלקיים ולהשלים תוך כדי. מה שחסר מסומן בכל שלב, ולא עוצר את ההתקדמות.</p>
      </section>

      {session?.status === 'needs-email' && <EmailLogin why="הפרויקטים שמורים בחשבון." />}

      <div className="home-start">
        <form
          className="home-card home-new"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
          aria-labelledby="new-title"
        >
          <h2 id="new-title">פרויקט חדש</h2>
          <p className="hint">מספיק שם או משפט אחד. הפרויקט נפתח בשלב הלמידה, וכל השאר אפשר להוסיף אחר כך.</p>
          <div className="field">
            <label htmlFor="new-name">שם הפרויקט</label>
            <input id="new-name" value={title} maxLength={80} onChange={(e) => setTitle(e.currentTarget.value)} placeholder="למשל: שער הים" data-testid="home-title" />
          </div>
          <div className="field">
            <label htmlFor="new-idea">הרעיון</label>
            <textarea id="new-idea" rows={3} value={idea} onChange={(e) => setIdea(e.currentTarget.value)} placeholder="מה רוצים ליצור, במשפט אחד" data-testid="home-idea" />
          </div>
          <div className="toolbar compact">
            <button type="submit" className="primary" disabled={busy || (!title.trim() && !idea.trim())} data-testid="home-start">
              {busy ? 'פותח' : 'התחלת פרויקט'}
            </button>
          </div>
          {status && (
            <p className="hint" role="alert">
              {status}
            </p>
          )}
        </form>

        <section className="home-card home-continue" aria-labelledby="continue-title">
          <h2 id="continue-title">המשך פרויקט</h2>
          {projects === null && session?.status !== 'needs-email' && <p className="hint">טוען את הפרויקטים</p>}
          {projects?.length === 0 && <p className="hint">עוד אין פרויקטים. מתחילים בטופס "פרויקט חדש".</p>}
          {projects && projects.length > 0 && (
            <ul className="home-projects" data-testid="home-projects">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <a href={`#/project?p=${p.id}`} onClick={(e) => (e.preventDefault(), navigate('project', { p: p.id }))} data-testid="home-project">
                    {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" /> : <span className="home-thumb-empty">עוד אין מודל</span>}
                    <span className="home-project-text">
                      <strong>{p.title_he}</strong>
                      <span className="hint">
                        {p.versions.length ? `${p.versions.length === 1 ? 'גרסה אחת' : `${p.versions.length} גרסאות`}` : 'בלי מתכון'} · {when(p.updated_at)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {projects && projects.length > 6 && (
            <button type="button" onClick={() => navigate('projects')}>
              כל הפרויקטים ({projects.length})
            </button>
          )}
        </section>
      </div>

      <section className="home-path" aria-labelledby="path-title">
        <h2 id="path-title">הדרך: תשעה שלבים</h2>
        <p className="hint">כל שלב נשען על הקודמים לו, וכל אחד מהם נפתח בכל רגע. התוצר של כל שלב נכנס למאמר.</p>
        <ol className="home-steps">
          {STAGES.map((s) => (
            <li key={s.id}>
              <span className="num">{s.num}</span>
              <strong>{s.title}</strong>
              <span>{s.doing}</span>
              <small>{s.yields}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-outcomes" aria-labelledby="out-title">
        <h2 id="out-title">מה יוצא בסוף</h2>
        <div className="home-outcome-grid">
          {OUTCOMES.map((o) => (
            <article key={o.title} className="home-card">
              <h3>{o.title}</h3>
              <p>{o.text}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
