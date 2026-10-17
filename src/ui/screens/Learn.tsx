/**
 * Concepts (DECISIONS.md 100): where the work starts, in knowledge and discovery. Two doors that meet in one
 * place: browse the models and see what each one opens up, or start from a need and see which models serve it
 * and why. Every recommendation is read back from a trait of the model. Claude adds concepts outside the atlas,
 * alternatives and background. A model page leads straight into a project or the studio.
 * `p` in the address ties the screen to a project: the chosen concept and the learning list are saved there.
 */
import { useEffect, useMemo, useState } from 'react'
import { EXAMPLES } from '../../data/examples'
import { exploreConcept, suggestConcepts, type ExploreResult, type SuggestResult } from '../../data/partner'
import { ensureSession } from '../../data/supabase'
import { createProject, loadWork, saveJourney } from '../../data/work'
import { FIT_WORD, MODELS, modelById, modelsForUse, withUses, type Model } from '../../learn/atlas'
import { TRAITS, USES, type UseId } from '../../learn/traits'
import type { Journey } from '../../journey/stages'
import { ModelFigure } from '../learn/ModelFigure'
import { navigate, useParam } from '../router'
import { useStudio } from '../store'
import { TopNav } from '../TopNav'

const FAMILIES = [...new Set(MODELS.map((m) => m.family))]

function ModelCard({ m, onOpen, reason }: { m: Model; onOpen: () => void; reason?: string }) {
  const uses = withUses(m, 3).uses
  return (
    <article className="atlas-card" data-testid="atlas-card" data-model={m.id}>
      <button type="button" className="atlas-card-open" onClick={onOpen} aria-label={`${m.name_he}: פתיחה`}>
        <ModelFigure id={m.id} moving={false} />
      </button>
      <div className="atlas-card-text">
        <h3>
          <a href={`#/learn?m=${m.id}`} onClick={(e) => (e.preventDefault(), onOpen())}>
            {m.name_he}
          </a>
        </h3>
        <p className="atlas-latin" lang="en">
          {m.name}
        </p>
        {reason ? <p className="atlas-reason">{reason}</p> : <p className="atlas-plain">{m.plain.split(/(?<=\.)\s/)[0]}</p>}
        <p className="hint">
          {uses.map((u) => u.use.label).join(' · ')} <span className="atlas-fit" data-fit={m.fit.level}>{FIT_WORD[m.fit.level]}</span>
        </p>
      </div>
    </article>
  )
}

/** The page of one model: what it is, its DNA, what it does in space, what it suits and why, and where it fails. */
function ModelPage({ m, projectId }: { m: Model; projectId: string | null }) {
  const full = withUses(m, 6)
  const [explore, setExplore] = useState<ExploreResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const load = useStudio((s) => s.loadRecipe)
  const example = m.fit.example ? EXAMPLES.find((e) => e.id === m.fit.example) : undefined

  const deeper = async () => {
    setBusy('explore')
    const out = await exploreConcept({ name: m.name, name_he: m.name_he, plain: m.plain, dna: m.dna })
    setBusy(null)
    if (out.ok) setExplore(out)
    else setStatus(out.error)
  }

  const start = async () => {
    setBusy('start')
    try {
      const s = await ensureSession()
      if (s.status !== 'signed-in') throw new Error('אין חיבור לחשבון')
      const id = await createProject({ title: m.name_he, concept: { model: m.id, math: m.ask } })
      navigate('project', { p: id, s: 'concept' })
    } catch (e) {
      setStatus(`הפרויקט לא נפתח: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(null)
    }
  }

  const choose = async () => {
    if (!projectId) return
    setBusy('choose')
    try {
      const w = await loadWork(projectId)
      const j: Journey = w.row.journey
      const saved = [...new Set([...(j.discover?.saved ?? []), m.id])]
      await saveJourney(projectId, { ...j, discover: { ...j.discover, saved }, concept: { ...j.concept, model: m.id, math: m.ask } })
      navigate('project', { p: projectId, s: 'concept' })
    } catch (e) {
      setStatus(`השמירה בפרויקט נכשלה: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(null)
    }
  }

  const keep = async () => {
    if (!projectId) return
    setBusy('keep')
    try {
      const w = await loadWork(projectId)
      const j: Journey = w.row.journey
      await saveJourney(projectId, { ...j, discover: { ...j.discover, saved: [...new Set([...(j.discover?.saved ?? []), m.id])] } })
      setStatus(`${m.name_he} נשמר ברשימת הלמידה של הפרויקט.`)
    } catch (e) {
      setStatus(`השמירה נכשלה: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBusy(null)
  }

  return (
    <article className="model-page" data-testid="model-page" data-model={m.id}>
      <header className="model-head">
        <div>
          <span className="eyebrow">{m.family}</span>
          <h1>{m.name_he}</h1>
          <p className="atlas-latin" lang="en">
            {m.name}
          </p>
          <p className="lead">{m.plain}</p>
        </div>
        <figure className="model-hero">
          <ModelFigure id={m.id} size="large" />
          <figcaption className="hint">המחשה: הקו מחושב מהמשוואה, והנקודה הולכת לאורכו כמו אדם שעובר במבנה.</figcaption>
        </figure>
      </header>

      <div className="toolbar compact model-actions">
        {projectId ? (
          <>
            <button type="button" className="primary" onClick={choose} disabled={!!busy} data-testid="choose-for-project">
              בחירה כמושג של הפרויקט
            </button>
            <button type="button" onClick={keep} disabled={!!busy} data-testid="keep-for-project">
              שמירה ברשימת הלמידה
            </button>
          </>
        ) : (
          <button type="button" className="primary" onClick={start} disabled={!!busy} data-testid="start-from-model">
            {busy === 'start' ? 'פותח' : 'פרויקט חדש מהמושג'}
          </button>
        )}
        {example && (
          <button type="button" onClick={() => (load(structuredClone(example.recipe), example.id), navigate('studio'))} data-testid="open-example">
            פתיחת דוגמה בסטודיו
          </button>
        )}
        <button type="button" onClick={deeper} disabled={!!busy} data-testid="explore-claude">
          {busy === 'explore' ? 'Claude חוקר' : 'להעמיק עם Claude'}
        </button>
      </div>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}

      <div className="model-grid">
        <section>
          <h2>ה־DNA</h2>
          <p className="hint">העקרונות, היחסים וההתנהגות שעושים את המודל לעצמו.</p>
          <ol className="model-dna">
            {m.dna.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ol>
          <h3>התכונות שעוברות למרחב</h3>
          <TraitList m={m} />
        </section>
        <section>
          <h2>תנועה וזרימה</h2>
          <p>{m.flow}</p>
          <h2>ייעוד ופונקציה</h2>
          <p>{m.program}</p>
        </section>
        <section className="model-uses">
          <h2>שימושים שמתאימים, ולמה</h2>
          <p className="hint">כל שימוש נגזר מתכונה של המודל. אפשר לבדוק כל נימוק.</p>
          {full.uses.map((u) => (
            <div key={u.use.id} className="model-use" data-testid="model-use">
              <h3>{u.use.label}</h3>
              <p className="hint">{u.use.needs}</p>
              <ul>
                {u.reasons.map((r) => (
                  <li key={r.trait.id}>
                    <strong>{r.trait.label}: </strong>
                    {r.why}
                  </li>
                ))}
                {u.against.map((r) => (
                  <li key={r.trait.id} className="model-against">
                    <strong>נגד, {r.trait.label}: </strong>
                    {r.why}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section>
          <h2>מגבלות, ומתי פחות מתאים</h2>
          <ul>
            {m.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <h2>מה המנוע בונה היום</h2>
          <p>
            <span className="atlas-fit" data-fit={m.fit.level}>
              {FIT_WORD[m.fit.level]}
            </span>{' '}
            {m.fit.note}
          </p>
        </section>
      </div>

      {explore && (
        <section className="model-claude" data-testid="explore-result">
          <h2>מה Claude מוסיף</h2>
          <p className="lead">{explore.summary}</p>
          {explore.dna.length > 0 && (
            <>
              <h3>עוד על ה־DNA</h3>
              <ul>
                {explore.dna.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </>
          )}
          <h3>שימושים</h3>
          {explore.uses.map((u) => (
            <p key={u.use}>
              <strong>{u.use}: </strong>
              {u.why} {u.how}
            </p>
          ))}
          {explore.connections.length > 0 && <h3>קשרים וידע</h3>}
          {explore.connections.map((c) => (
            <p key={c.title}>
              <strong>{c.title}: </strong>
              {c.text}
            </p>
          ))}
          {explore.limits.length > 0 && <h3>מגבלות</h3>}
          <ul>
            {explore.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {explore.questions.length > 0 && <h3>שאלות להמשך</h3>}
          <ul>
            {explore.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="hint">התשובה של Claude היא נקודת מבט, לא עובדה מאומתת. כדאי לבדוק תקדימים לפני שמצטטים אותם.</p>
        </section>
      )}
    </article>
  )
}

function TraitList({ m }: { m: Model }) {
  return (
    <dl className="model-traits">
      {withUses(m).traits.map((t) => {
        const trait = TRAIT_OF(t)
        return (
          <div key={t}>
            <dt>{trait.label}</dt>
            <dd>
              {trait.math} <span className="hint">{trait.space}</span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

const TRAIT_OF = (t: keyof typeof TRAITS) => TRAITS[t]

/** From a need to concepts: the atlas ranks, Claude widens. */
function NeedFinder({ projectId, initialUse }: { projectId: string | null; initialUse: UseId | null }) {
  const [use, setUse] = useState<UseId | null>(initialUse)
  const [idea, setIdea] = useState('')
  const [place, setPlace] = useState('')
  const [ai, setAi] = useState<SuggestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const ranked = useMemo(() => (use ? modelsForUse(use, 8) : []), [use])

  useEffect(() => {
    if (!projectId) return
    void loadWork(projectId).then(
      (w) => {
        const j = w.row.journey
        setIdea((v) => v || j.idea?.idea || '')
        setPlace((v) => v || j.context?.place || '')
      },
      () => undefined,
    )
  }, [projectId])

  const ask = async () => {
    setBusy(true)
    setStatus('')
    const out = await suggestConcepts({ use: use ? USES[use].label : undefined, idea, place })
    setBusy(false)
    if (out.ok) setAi(out)
    else setStatus(out.error)
  }

  return (
    <section className="need" aria-labelledby="need-title">
      <h2 id="need-title">מה צריך המקום?</h2>
      <p className="hint">בוחרים שימוש. המודלים מסודרים לפי כמה התכונות שלהם משרתות אותו, וכל נימוק כתוב.</p>
      <div className="need-uses" role="group" aria-label="שימושים">
        {Object.values(USES).map((u) => (
          <button key={u.id} type="button" aria-pressed={use === u.id} onClick={() => setUse(u.id)} data-testid={`use-${u.id}`}>
            {u.label}
          </button>
        ))}
      </div>
      {use && <p className="need-needs">{USES[use].needs}</p>}
      {ranked.length > 0 && (
        <ol className="need-ranked" data-testid="need-ranked">
          {ranked.map(({ model, fit }) => (
            <li key={model.id}>
              <ModelCard m={model} onOpen={() => navigate('learn', { m: model.id, ...(projectId ? { p: projectId } : {}) })} reason={fit.reasons.map((r) => `${r.trait.label}: ${r.why}`).join(' ')} />
              {fit.against.length > 0 && <p className="hint model-against">נגד: {fit.against.map((r) => r.why).join(' ')}</p>}
            </li>
          ))}
        </ol>
      )}
      <div className="need-claude">
        <h3>לשאול את Claude</h3>
        <p className="hint">Claude מציע גם מושגים שאינם באטלס, חלופות שונות באמת, וידע רקע.</p>
        <div className="field">
          <label htmlFor="need-idea">הרעיון או הצורך</label>
          <textarea id="need-idea" rows={3} value={idea} onChange={(e) => setIdea(e.currentTarget.value)} dir="auto" placeholder="למשל: כניסה לעיר מהים, שמרגישים בה את המעבר" data-testid="need-idea" />
        </div>
        <div className="field">
          <label htmlFor="need-place">מקום</label>
          <input id="need-place" value={place} onChange={(e) => setPlace(e.currentTarget.value)} dir="auto" placeholder="למשל: אשדוד (Ashdod, Israel)" />
        </div>
        <button type="button" className="primary" onClick={ask} disabled={busy || (!idea.trim() && !use)} data-testid="ask-suggest">
          {busy ? 'Claude חושב' : 'הצעות מושגים'}
        </button>
        {status && (
          <p className="hint" role="alert">
            {status}
          </p>
        )}
        {ai && <SuggestView r={ai} projectId={projectId} />}
      </div>
    </section>
  )
}

export function SuggestView({ r, projectId, onPick }: { r: SuggestResult; projectId: string | null; onPick?: (s: SuggestResult['suggestions'][number]) => void }) {
  return (
    <div className="suggest" data-testid="suggest-result">
      <p className="lead">{r.understanding}</p>
      <ol className="suggest-list">
        {r.suggestions.map((s) => {
          const atlas = s.atlas_id ? modelById(s.atlas_id) : undefined
          return (
            <li key={s.name} data-testid="suggestion">
              {atlas && <ModelFigure id={atlas.id} moving={false} />}
              <div>
                <h4>
                  {s.name_he} <span lang="en">({s.name})</span>
                </h4>
                <p>{s.why}</p>
                {s.experience && <p className="hint">החוויה: {s.experience}</p>}
                {s.limits && <p className="hint">מגבלה: {s.limits}</p>}
                <p className="hint">{atlas ? `באטלס · ${FIT_WORD[atlas.fit.level]}` : `מחוץ לאטלס · ${s.buildable === 'full' ? 'נבנה במלואו' : s.buildable === 'partial' ? 'נבנה בקירוב' : 'עוד לא נבנה'}`}</p>
                <div className="toolbar compact">
                  {atlas && (
                    <button type="button" onClick={() => navigate('learn', { m: atlas.id, ...(projectId ? { p: projectId } : {}) })}>
                      לדף המודל
                    </button>
                  )}
                  {onPick && (
                    <button type="button" className="primary" onClick={() => onPick(s)} data-testid="pick-suggestion">
                      בחירה
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      {r.alternatives.length > 0 && (
        <>
          <h4>כיוונים אחרים</h4>
          <ul>
            {r.alternatives.map((a) => (
              <li key={a.name}>
                <strong>
                  {a.name_he} ({a.name}):{' '}
                </strong>
                {a.why}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.knowledge.length > 0 && (
        <>
          <h4>ידע שכדאי להכיר</h4>
          {r.knowledge.map((k) => (
            <p key={k.title}>
              <strong>{k.title}: </strong>
              {k.text}
            </p>
          ))}
        </>
      )}
      <p className="hint">ההצעות של Claude הן נקודת פתיחה לחקירה. כדאי לבדוק תקדימים לפני שמצטטים אותם.</p>
    </div>
  )
}

export function LearnScreen() {
  const modelId = useParam('m')
  const projectId = useParam('p')
  const mode = useParam('mode')
  const useParamId = useParam('use') as UseId | null
  const [family, setFamily] = useState<string | null>(null)
  const m = modelId ? modelById(modelId) : undefined
  const go = (params: Record<string, string>) => navigate('learn', { ...params, ...(projectId ? { p: projectId } : {}) })

  useEffect(() => window.scrollTo(0, 0), [modelId])

  const crumbs = [{ label: 'בית', to: 'home' as const }, { label: 'מושגים', to: 'learn' as const, params: projectId ? { p: projectId } : undefined }, ...(m ? [{ label: m.name_he }] : [])]
  return (
    <div className="wrap learn">
      <TopNav crumbs={crumbs} />
      {projectId && (
        <p className="notice info">
          המושגים נפתחו מתוך פרויקט. "בחירה כמושג של הפרויקט" שומרת את הבחירה וחוזרת לשלב 02.{' '}
          <button type="button" onClick={() => navigate('project', { p: projectId })}>
            חזרה לפרויקט
          </button>
        </p>
      )}
      {m ? (
        <ModelPage m={m} projectId={projectId} />
      ) : (
        <>
          <header className="screen">
            <span className="eyebrow">למידה וגילוי</span>
            <h1>מה המתמטיקה פותחת באדריכלות</h1>
            <p className="lead">
              {MODELS.length} מודלים מתמטיים. לכל אחד: מהו, ה־DNA שלו, איך הוא משפיע על תנועה וייעוד, אילו שימושים מתאימים לו ולמה, ומתי הוא פחות מתאים. אפשר להתחיל ממודל, או מצורך.
            </p>
          </header>
          <div className="seg learn-modes" role="tablist" aria-label="דרך התחלה">
            <button type="button" role="tab" aria-selected={mode !== 'need'} onClick={() => go({})} data-testid="mode-browse">
              לגלות מושג
            </button>
            <button type="button" role="tab" aria-selected={mode === 'need'} onClick={() => go({ mode: 'need' })} data-testid="mode-need">
              יש לי צורך
            </button>
          </div>
          {mode === 'need' ? (
            <NeedFinder projectId={projectId} initialUse={useParamId} />
          ) : (
            <>
              <div className="need-uses" role="group" aria-label="משפחות">
                <button type="button" aria-pressed={!family} onClick={() => setFamily(null)}>
                  הכול
                </button>
                {FAMILIES.map((f) => (
                  <button key={f} type="button" aria-pressed={family === f} onClick={() => setFamily(f)}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="atlas-grid" data-testid="atlas">
                {MODELS.filter((x) => !family || x.family === family).map((x) => (
                  <ModelCard key={x.id} m={x} onOpen={() => go({ m: x.id })} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
