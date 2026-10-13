/**
 * New concept (PRODUCT.md "מסכים" 2): concept, use and context; while Claude works, a skeleton of the model
 * and a line that says what is happening. Every failure explains itself and offers a way out.
 */
import { useEffect, useRef, useState } from 'react'
import { requestRecipe, type ConceptOutcome, type ConceptProgress } from '../../data/concept'
import { ensureSession, sendMagicLink, type SessionState } from '../../data/supabase'
import { validateRecipe } from '../../recipe/rules'
import { num } from '../format'
import { navigate } from '../router'
import { useStudio } from '../store'
import { TopNav } from '../TopNav'

type Failure = Extract<ConceptOutcome, { ok: false }>

type Phase =
  | { name: 'form' }
  | { name: 'creating'; startedAt: number; progress: ConceptProgress | null }
  | { name: 'failed'; failure: Failure }
  | { name: 'editing'; text: string; problems: string[] }

const EXAMPLES = [
  { concept: 'Umbilic torus', use: 'ביתן ציבורי', context: 'חוף ים' },
  { concept: 'Möbius strip', use: 'גשר הולכי רגל', context: 'פארק עירוני' },
  { concept: 'Logarithmic spiral', use: 'מגדל תצפית', context: 'גבעות לס' },
  { concept: 'Hyperboloid', use: 'מגדל מים', context: 'כיכר עירונית' },
  { concept: "Pascal's triangle", use: 'פביליון', context: 'חזית מים' },
]

function stageLine(p: ConceptProgress | null): string {
  if (!p || (p.stage === 'calling' && p.attempt === 1)) return 'Claude מזקק את המושג: מה התכונה שעושה אותו לעצמו, ואיזה מחולל מבטא אותה'
  if (p.stage === 'calling') return `Claude מתקן את המתכון, סבב ${num(p.attempt - 1, 0)} מתוך 2`
  if (p.stage === 'repairing') return `המתכון נכשל בבדיקה (${p.problems.join(', ')}), ונשלח לתיקון`
  return 'בודק את המתכון מול הסכמה והכללים הסמנטיים'
}

function problemsOf(f: { schemaErrors: { path: string; message: string }[]; issues: { rule: number; message: string; severity: string; path: string }[] }) {
  return [
    ...f.schemaErrors.map((e) => `${e.path}: ${e.message}`),
    ...f.issues.filter((i) => i.severity === 'error').map((i) => `כלל ${i.rule}, ${i.path}: ${i.message}`),
  ]
}

export function NewConcept() {
  const [concept, setConcept] = useState('')
  const [use, setUse] = useState('')
  const [context, setContext] = useState('')
  const [phase, setPhase] = useState<Phase>({ name: 'form' })
  const [session, setSession] = useState<SessionState | null>(null)
  const [email, setEmail] = useState('')
  const [mailNote, setMailNote] = useState('')
  const [now, setNow] = useState(() => performance.now())
  const abort = useRef<AbortController | null>(null)
  const load = useStudio((s) => s.loadRecipe)

  useEffect(() => {
    ensureSession().then(setSession, (e) => setSession({ status: 'error', message: String(e) }))
  }, [])

  useEffect(() => {
    if (phase.name !== 'creating') return
    const t = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(t)
  }, [phase.name])

  const openInStudio = (recipe: unknown, startedAt: number, attempts: number, warnings: string[]) => {
    load(recipe, `concept:${concept}`, { concept, startedAt, attempts, warnings })
    navigate('studio')
  }

  const submit = async () => {
    if (!concept.trim()) return
    let s = session
    if (!s || s.status !== 'signed-in') {
      s = await ensureSession()
      setSession(s)
      if (s.status !== 'signed-in') return
    }
    const startedAt = performance.now()
    const ctrl = new AbortController()
    abort.current = ctrl
    setPhase({ name: 'creating', startedAt, progress: null })
    try {
      const out = await requestRecipe(
        { concept: concept.trim(), use: use.trim() || undefined, context: context.trim() || undefined },
        s.token,
        { signal: ctrl.signal, onProgress: (p) => setPhase({ name: 'creating', startedAt, progress: p }) },
      )
      if (out.ok) {
        openInStudio(out.recipe, startedAt, out.attempts, out.issues.map((i) => `כלל ${i.rule}: ${i.message}`))
      } else {
        if (out.kind === 'http' && out.status === 401) setSession(await ensureSession())
        setPhase({ name: 'failed', failure: out })
      }
    } catch (e) {
      if (ctrl.signal.aborted) setPhase({ name: 'form' })
      else
        setPhase({
          name: 'failed',
          failure: { type: 'result', ok: false, kind: 'upstream', error: `לא הצלחנו להגיע לשרת (${String(e)}). כדאי לבדוק את החיבור ולנסות שוב.`, schemaErrors: [], issues: [], attempts: 0 },
        })
    }
  }

  const tryManual = (text: string) => {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      setPhase({ name: 'editing', text, problems: ['הטקסט אינו JSON תקין'] })
      return
    }
    const v = validateRecipe(raw)
    if (!v.ok) {
      setPhase({ name: 'editing', text, problems: problemsOf(v) })
      return
    }
    openInStudio(raw, performance.now(), 0, [])
  }

  const creating = phase.name === 'creating'

  return (
    <div className="wrap">
      <TopNav />
      <nav className="crumbs" aria-label="מיקום">
        <ol>
          <li>פרויקטים</li>
          <li aria-current="page">מושג חדש</li>
        </ol>
      </nav>
      <header className="screen">
        <span className="eyebrow">מתמטיקה הפוכה</span>
        <h1>מושג חדש</h1>
        <p className="lead">
          מקלידים מושג מתמטי. Claude מתרגם אותו למתכון גאומטרי, המנוע בונה ממנו מודל ערום, והסטודיו נפתח לכיול. המבנה לא מצייר את
          המושג, הוא בונה אותו.
        </p>
      </header>

      <div className="grid">
        <div className="col">
          {creating ? (
            <div className="stage skeleton" role="status" aria-live="polite" data-testid="creating">
              <span className="badge">1:1</span>
              <div className="skeleton-ring" aria-hidden="true" />
              <div className="stage-empty">
                <p>
                  <strong>{stageLine(phase.progress)}</strong>
                </p>
                <p className="num">{num((now - phase.startedAt) / 1000, 0)} שניות</p>
              </div>
            </div>
          ) : (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <div className="field">
                <label htmlFor="concept">מושג</label>
                <input
                  id="concept"
                  data-testid="concept"
                  required
                  maxLength={120}
                  value={concept}
                  onChange={(e) => setConcept(e.currentTarget.value)}
                  placeholder="למשל: Umbilic torus"
                  dir="auto"
                />
                <span className="why">שם המושג בעברית או באנגלית. Claude מחפש את התכונה המבנית שלו.</span>
              </div>
              <div className="field">
                <label htmlFor="use">שימוש</label>
                <input id="use" data-testid="use" maxLength={80} value={use} onChange={(e) => setUse(e.currentTarget.value)} placeholder="למשל: ביתן ציבורי" dir="auto" />
                <span className="why">קובע את קנה המידה: ביתן שנכנסים אליו צריך גובה חופשי של 2.4 מ' לפחות.</span>
              </div>
              <div className="field">
                <label htmlFor="context">הקשר</label>
                <input id="context" data-testid="context" maxLength={120} value={context} onChange={(e) => setContext(e.currentTarget.value)} placeholder="למשל: חוף ים" dir="auto" />
                <span className="why">בוחר את הסביבה ברמה הריאליסטית. לא משנה את הצורה.</span>
              </div>
              <div className="toolbar" role="group" aria-label="דוגמאות">
                {EXAMPLES.map((ex) => (
                  <button key={ex.concept} type="button" onClick={() => (setConcept(ex.concept), setUse(ex.use), setContext(ex.context))}>
                    {ex.concept}
                  </button>
                ))}
              </div>
              <button type="submit" className="primary" data-testid="submit" disabled={!concept.trim() || session?.status === 'needs-email'}>
                יצירת מתכון
              </button>
              {session?.status === 'error' && (
                <div className="notice error" role="alert">
                  <p>
                    <strong>החיבור לשרת נכשל</strong>
                  </p>
                  <p>{session.message}</p>
                  <div>
                    <button type="button" onClick={() => ensureSession().then(setSession)}>
                      ניסיון חוזר
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        <aside className="col" aria-label="מצב">
          {creating && (
            <div className="panel">
              <h2>מה קורה עכשיו</h2>
              <ol className="steps">
                <li aria-current={!phase.progress || phase.progress.stage === 'calling' ? 'step' : undefined}>Claude מתרגם את המושג למתכון</li>
                <li aria-current={phase.progress?.stage === 'validating' ? 'step' : undefined}>בדיקה מול הסכמה והכללים</li>
                <li aria-current={phase.progress?.stage === 'repairing' ? 'step' : undefined}>תיקון, עד פעמיים, אם משהו נכשל</li>
                <li>בניית המודל הערום בסטודיו</li>
              </ol>
              <p className="hint">בדרך כלל זה לוקח פחות מדקה.</p>
              <div>
                <button type="button" onClick={() => abort.current?.abort()} data-testid="cancel">
                  ביטול
                </button>
              </div>
            </div>
          )}

          {session?.status === 'needs-email' && !creating && (
            <div className="panel" data-testid="email-login">
              <h2>כניסה</h2>
              <p className="hint">כדי ליצור מתכון צריך להיות מחוברים. נשלח קישור כניסה למייל, בלי סיסמה.</p>
              <div className="field">
                <label htmlFor="email">מייל</label>
                <input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              </div>
              <div>
                <button type="button" className="primary" disabled={!email.includes('@')} onClick={async () => {
                  const r = await sendMagicLink(email)
                  setMailNote(r.ok ? `נשלח קישור ל-${email}. פותחים אותו באותו דפדפן.` : `השליחה נכשלה: ${r.message}`)
                }}>
                  שליחת קישור כניסה
                </button>
              </div>
              <p className="hint" role="status">{mailNote}</p>
            </div>
          )}

          {phase.name === 'failed' && (
            <div className="notice error" role="alert" data-testid="concept-error">
              <p>
                <strong>{phase.failure.error}</strong>
              </p>
              {problemsOf(phase.failure).length > 0 && (
                <ul>
                  {problemsOf(phase.failure).map((p) => (
                    <li key={p} className="field">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
              <div className="toolbar">
                <button type="button" className="primary" onClick={submit}>
                  ניסיון חוזר
                </button>
                {phase.failure.lastRecipe != null && (
                  <button
                    type="button"
                    onClick={() =>
                      phase.name === 'failed' &&
                      setPhase({ name: 'editing', text: JSON.stringify(phase.failure.lastRecipe, null, 2), problems: problemsOf(phase.failure) })
                    }
                  >
                    עריכה ידנית של המתכון
                  </button>
                )}
                <button type="button" onClick={() => setPhase({ name: 'form' })}>
                  חזרה לטופס
                </button>
              </div>
            </div>
          )}

          {phase.name === 'editing' && (
            <div className="panel" data-testid="manual-edit">
              <h2>עריכה ידנית</h2>
              {phase.problems.length > 0 && (
                <div className="notice warning">
                  <p>
                    <strong>השדות שצריך לתקן</strong>
                  </p>
                  <ul>
                    {phase.problems.map((p) => (
                      <li key={p} className="field">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <label htmlFor="recipe-json" className="visually-hidden">
                המתכון בפורמט JSON
              </label>
              <textarea
                id="recipe-json"
                className="code"
                dir="ltr"
                spellCheck={false}
                value={phase.text}
                onChange={(e) => setPhase({ ...phase, text: e.currentTarget.value })}
              />
              <div className="toolbar">
                <button type="button" className="primary" onClick={() => tryManual(phase.text)}>
                  בדיקה ופתיחה בסטודיו
                </button>
                <button type="button" onClick={() => setPhase({ name: 'form' })}>
                  חזרה לטופס
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
