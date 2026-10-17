/**
 * The project on its work path (DECISIONS.md 103): nine steps, from learning about a mathematical idea to the
 * exhibition article. Each step says what is done, what is learned, what it leans on (with what the earlier
 * steps already hold), what to fill in, what it yields and what is missing, and what comes next. Nothing blocks:
 * any step opens at any time, and nothing written is lost when going back. Claude helps on the steps where a
 * partner helps: choosing a concept, and forming the concept from the inspiration.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addPrompt, imageProblem, removeItem, uploadImage } from '../../data/library'
import { suggestConcepts, type SuggestResult } from '../../data/partner'
import { ensureSession, type SessionState } from '../../data/supabase'
import { loadWork, saveJourney, uploadWorkImage, type Work } from '../../data/work'
import { loadImage } from '../../dossier/images'
import { useOnReturn } from '../freshness'
import { buildArticle } from '../../journey/article'
import { chosenConcept, doneCount, fieldValue, nextStage, projectName, STAGES, stageById, stageStatus, withField, type Journey, type StageDef, type StageId, type WorkImage } from '../../journey/stages'
import { FIT_WORD, modelById, modelsForUse } from '../../learn/atlas'
import { fitUse, USES } from '../../learn/traits'
import { visualPrompt } from '../../prompt/visualPrompt'
import { ModelFigure } from '../learn/ModelFigure'
import { DropZone } from '../panels/DropZone'
import { EmailLogin } from '../panels/EmailLogin'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'
import { SuggestView } from './Learn'

const STATE_WORD = { done: 'הושלם', partial: 'חלקי', empty: 'ריק' } as const
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const clip = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n).trim()}…` : s)

function Gallery({ images, onRemove }: { images: (WorkImage & { remove?: () => void })[]; onRemove?: boolean }) {
  if (!images.length) return null
  return (
    <div className="gallery wide">
      {images.map((i) => (
        <figure key={i.id} className="gallery-item frame">
          {i.src ? <img className="snapshot" src={i.src} alt={i.caption} loading="lazy" /> : <span className="hint">התמונה לא נטענה</span>}
          <figcaption className="hint">{i.caption}</figcaption>
          {onRemove && i.remove && (
            <button type="button" className="quiet" onClick={() => confirm('למחוק את התמונה?') && i.remove!()}>
              מחיקה
            </button>
          )}
        </figure>
      ))}
    </div>
  )
}

export function Workspace() {
  const projectId = useParam('p')
  const stageParam = useParam('s')
  const [session, setSession] = useState<SessionState | null>(null)
  const [work, setWork] = useState<Work | null>(null)
  const [journey, setJourney] = useState<Journey>({})
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [promptDraft, setPromptDraft] = useState({ distill: '', body: '' })
  const [caption, setCaption] = useState('')
  const [suggest, setSuggest] = useState<SuggestResult | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Journey | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return setError('חסר פרויקט בכתובת.')
    setError(null)
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') return
    try {
      const w = await loadWork(projectId)
      setWork(w)
      // An edit that is still waiting to be written wins over what the server sent.
      setJourney(pending.current ?? w.row.journey)
    } catch (e) {
      setError(errText(e))
    }
  }, [projectId])
  useEffect(() => void refresh(), [refresh])
  useOnReturn(refresh)
  // Another project: nothing of the previous one stays on screen.
  useEffect(() => {
    setWork(null)
    setJourney({})
    setSuggest(null)
    pending.current = null
  }, [projectId])
  useEffect(() => setSuggest(null), [stageParam])

  const flush = useCallback(async () => {
    if (!projectId || !pending.current) return
    const j = pending.current
    setSaveState('saving')
    try {
      await saveJourney(projectId, j)
      if (pending.current === j) pending.current = null
      setSaveState('saved')
    } catch {
      setSaveState('failed')
    }
  }, [projectId])
  useEffect(() => () => void flush(), [flush])

  const update = (next: (j: Journey) => Journey, now = false) => {
    setJourney((j) => {
      const n = next(j)
      pending.current = n
      return n
    })
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), now ? 0 : 700)
  }
  const setField = (path: string, value: string) => update((j) => withField(j, path, value))

  const state = useMemo(() => (work ? { ...work.state, journey } : null), [work, journey])
  const stage: StageDef = (stageParam && stageById(stageParam)) || (state ? nextStage(state) : STAGES[0]!)
  const index = STAGES.indexOf(stage)
  const go = (id: StageId) => (void flush(), navigate('project', { p: projectId!, s: id }))
  const latest = work?.collection.latest ?? null
  const toStudio = (tab?: string) => latest && (void flush(), navigate('studio', { v: latest.id, ...(tab ? { tab } : {}) }))
  const toLearn = (params: Record<string, string> = {}) => (void flush(), navigate('learn', { p: projectId!, ...params }))

  const run = async (what: string, job: () => Promise<string>) => {
    setBusy(what)
    setStatus('')
    try {
      setStatus(await job())
      await refresh()
    } catch (e) {
      setStatus(`${errText(e)} אפשר לנסות שוב.`)
    } finally {
      setBusy(null)
    }
  }

  const uploadTo = (kind: 'reference' | 'photo') => async (file: File) => {
    await uploadWorkImage({ kind, projectId: projectId!, file, caption })
    void refresh()
  }

  const promptFromModel = () =>
    run('model-prompt', async () => {
      const vp = visualPrompt(state!.recipe!)
      await addPrompt({ projectId: projectId!, versionId: latest?.id ?? null, distill: vp.distill, prompt: vp.prompt })
      return 'הפרומפט נגזר מהמודל ונשמר.'
    })

  const addOwnPrompt = (files: File[] = []) =>
    run('own-prompt', async () => {
      const body = promptDraft.body.trim()
      const distill = promptDraft.distill.trim() || (body ? clip(body, 120) : 'תמונה שהועלתה בלי פרומפט')
      const bad = files.map(imageProblem).filter(Boolean)
      if (bad.length) throw new Error(bad.join(' '))
      const p = await addPrompt({ projectId: projectId!, versionId: latest?.id ?? null, distill, prompt: body })
      for (const file of files) await uploadImage({ projectId: projectId!, promptId: p.id, versionId: latest?.id ?? null, file })
      setPromptDraft({ distill: '', body: '' })
      return files.length ? 'הפרומפט והתמונה נשמרו.' : 'הפרומפט נשמר.'
    })

  const removeLib = (id: string) =>
    run('remove', async () => {
      const all = [...(work?.references ?? []), ...(work?.photos ?? []), ...(work?.library.prompts.flatMap((p) => p.images) ?? [])]
      const item = all.find((i) => i.id === id)
      if (item) await removeItem(item)
      return 'נמחק.'
    })

  /** Claude reads the need (and the inspiration, with up to two images) and suggests concepts. */
  const askClaude = async (withChosen: boolean) => {
    setBusy('suggest')
    setStatus('')
    const j = journey
    const images: string[] = []
    if (withChosen)
      for (const r of (state?.references ?? []).slice(0, 2))
        if (r.src)
          try {
            images.push((await loadImage(r.src, 768)).dataUrl)
          } catch {
            // an image that does not load is left out
          }
    const chosen = state ? chosenConcept(state) : null
    const out = await suggestConcepts(
      { use: j.context?.use, place: j.context?.place, idea: j.idea?.idea, intent: j.idea?.intent, inspiration: j.context?.inspiration, images },
      withChosen && chosen ? { name: chosen.name, name_he: chosen.name_he } : null,
    )
    setBusy(null)
    if (out.ok) setSuggest(out)
    else setStatus(out.error)
  }

  const name = state ? projectName(state) : 'פרויקט'
  const st = state ? stageStatus(stage.id, state) : null
  const gaps = state ? buildArticle(state, work!.row.article).gaps.length : 0
  const chosen = state ? chosenConcept(state) : null
  const model = chosen?.modelId ? modelById(chosen.modelId) : undefined
  const useDef = Object.values(USES).find((u) => journey.context?.use && (journey.context.use.includes(u.label) || u.label.includes(journey.context.use)))

  // ---------- what the steps before this one hold ----------
  const before = state
    ? STAGES.slice(0, index)
        .map((s) => {
          const text = s.fields
            .filter((f) => f.path !== 'idea.title')
            .map((f) => fieldValue(journey, f.path).trim())
            .find(Boolean)
          const extra = s.id === 'concept' && chosen ? chosen.name_he : s.id === 'discover' && journey.discover?.saved?.length ? `${journey.discover.saved.length} מודלים נבחנו` : s.id === 'illustration' && state.prompts[0] ? state.prompts[0].distill : null
          const line = s.id === 'concept' && chosen ? `${chosen.name_he}${text ? `: ${text}` : ''}` : (text ?? extra)
          return line ? { s, line: clip(line) } : null
        })
        .filter((x): x is { s: StageDef; line: string } => !!x)
    : []

  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'פרויקטים', to: 'projects' }, { label: name, to: 'project', params: projectId ? { p: projectId } : undefined }, { label: stage.title }]} />
      <header className="screen jw-head">
        <span className="eyebrow">פרויקט · {state ? `${doneCount(state)} מתוך 9 שלבים הושלמו` : ''}</span>
        <h1>{name}</h1>
        {work && (
          <div className="toolbar compact">
            <button type="button" className="primary" onClick={() => (void flush(), navigate('article', { p: projectId! }))} data-testid="open-article">
              המאמר{gaps ? ` (${gaps} חסרים)` : ''}
            </button>
            {latest && (
              <button type="button" onClick={() => toStudio()}>
                סטודיו
              </button>
            )}
            <button type="button" className="quiet" onClick={() => navigate('collection', { p: projectId! })}>
              קולקציה
            </button>
            <button type="button" onClick={() => (void flush(), navigate('poster', { p: projectId! }))} data-testid="open-poster">
              פלייר לתערוכה
            </button>
            {latest && (
              <button type="button" className="quiet" onClick={() => navigate('dossier', { p: projectId! })}>
                מסמך הפרויקט
              </button>
            )}
          </div>
        )}
      </header>

      {session?.status === 'needs-email' && <EmailLogin why="הפרויקט שמור בחשבון." />}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <div className="toolbar compact">
            <button type="button" onClick={refresh}>
              ניסיון חוזר
            </button>
            <button type="button" onClick={() => navigate('home')}>
              לדף הבית
            </button>
          </div>
        </div>
      )}
      {!work && !error && session?.status !== 'needs-email' && (
        <p className="hint" role="status">
          טוען את הפרויקט
        </p>
      )}

      {state && st && (
        <div className="jw">
          <nav className="jw-rail" aria-label="שלבי העבודה">
            <ol>
              {STAGES.map((s) => {
                const ss = stageStatus(s.id, state)
                return (
                  <li key={s.id} data-state={ss.state} aria-current={s.id === stage.id ? 'step' : undefined}>
                    <a href={`#/project?p=${projectId}&s=${s.id}`} onClick={(e) => (e.preventDefault(), go(s.id))} data-testid={`rail-${s.id}`}>
                      <span className="num">{s.num}</span>
                      <span className="jw-rail-title">{s.title}</span>
                      <span className="jw-rail-state">{STATE_WORD[ss.state]}</span>
                    </a>
                  </li>
                )
              })}
            </ol>
          </nav>

          <section className="jw-stage" aria-labelledby="stage-title" data-testid="step" data-stage={stage.id} data-state={st.state}>
            <header className="jw-stage-head">
              <span className="jw-num num">{stage.num}</span>
              <div>
                <h2 id="stage-title">{stage.title}</h2>
                <p className="lead">{stage.doing}</p>
              </div>
            </header>

            <div className="jw-cards">
              <div className="jw-leans">
                <h3>לומדים</h3>
                <p>{stage.learning}</p>
              </div>
              <div className="jw-leans">
                <h3>נשען על</h3>
                <p>{stage.leans}</p>
              </div>
            </div>
            {before.length > 0 && (
              <ul className="jw-before">
                {before.map(({ s, line }) => (
                  <li key={s.id}>
                    <a href={`#/project?p=${projectId}&s=${s.id}`} onClick={(e) => (e.preventDefault(), go(s.id))}>
                      <span className="num">{s.num}</span> {s.title}
                    </a>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* ---------- the step's own tools, before its fields ---------- */}
            {stage.id === 'discover' && (
              <div className="jw-materials">
                <h3>מודלים שנבחנו</h3>
                {(journey.discover?.saved ?? []).length === 0 && <p className="hint">עוד לא נשמר מודל. באטלס, "שמירה ברשימת הלמידה" מוסיפה מודל לכאן.</p>}
                <div className="jw-models">
                  {(journey.discover?.saved ?? []).map((id) => {
                    const m = modelById(id)
                    return m ? (
                      <button key={id} type="button" className="jw-model" onClick={() => toLearn({ m: id })}>
                        <ModelFigure id={id} moving={false} />
                        <span>{m.name_he}</span>
                      </button>
                    ) : null
                  })}
                </div>
                <div className="toolbar compact">
                  <button type="button" className="primary" onClick={() => toLearn()} data-testid="open-atlas">
                    לגלות מושגים
                  </button>
                  <button type="button" onClick={() => toLearn({ mode: 'need' })}>
                    להתחיל מצורך
                  </button>
                </div>
              </div>
            )}

            {stage.id === 'concept' && (
              <div className="jw-materials">
                <h3>המושג</h3>
                {model ? (
                  <div className="jw-chosen" data-testid="chosen-concept">
                    <ModelFigure id={model.id} />
                    <div>
                      <p className="journey-name">
                        {model.name_he} <span lang="en">({model.name})</span>
                      </p>
                      <p>{model.plain}</p>
                      <ol className="model-dna">
                        {model.dna.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ol>
                      <p className="hint">
                        <span className="atlas-fit" data-fit={model.fit.level}>
                          {FIT_WORD[model.fit.level]}
                        </span>{' '}
                        {model.fit.note}
                      </p>
                      <button type="button" onClick={() => toLearn({ m: model.id })}>
                        לדף המודל
                      </button>
                    </div>
                  </div>
                ) : chosen ? (
                  <p className="journey-name" data-testid="chosen-concept">
                    {chosen.name_he}
                  </p>
                ) : (
                  <p className="hint">עוד לא נבחר מושג. בוחרים מהאטלס, מקבלים הצעות מ-Claude, או כותבים בשדה למטה.</p>
                )}
                <div className="toolbar compact">
                  <button type="button" onClick={() => toLearn()}>
                    בחירה מהאטלס
                  </button>
                  <button type="button" onClick={() => askClaude(false)} disabled={!!busy} data-testid="suggest-concepts">
                    {busy === 'suggest' ? 'Claude חושב' : 'הצעות מושגים מ-Claude'}
                  </button>
                </div>
                {suggest && (
                  <SuggestView
                    r={suggest}
                    projectId={projectId}
                    onPick={(s) => {
                      update((j) => ({ ...j, concept: { ...j.concept, model: s.atlas_id ?? undefined, math: s.name, why: j.concept?.why || s.why }, discover: { ...j.discover, saved: [...new Set([...(j.discover?.saved ?? []), ...(s.atlas_id ? [s.atlas_id] : [])])] } }), true)
                      setSuggest(null)
                      setStatus(`${s.name_he} נבחר, וההסבר של Claude הועתק לשדה "למה המושג הזה". אפשר לערוך אותו.`)
                    }}
                  />
                )}
              </div>
            )}

            {stage.id === 'context' && model && useDef && (
              <div className="jw-materials" data-testid="use-fit">
                <h3>
                  {model.name_he} ו{useDef.label}
                </h3>
                {(() => {
                  const f = fitUse(model.traits, useDef)
                  return (
                    <>
                      {f.reasons.length ? (
                        <ul>
                          {f.reasons.map((r) => (
                            <li key={r.trait.id}>
                              <strong>{r.trait.label}: </strong>
                              {r.why}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>אין למושג תכונה שמשרתת את השימוש הזה במיוחד. כדאי לבדוק מושגים אחרים.</p>
                      )}
                      {f.against.map((r) => (
                        <p key={r.trait.id} className="model-against">
                          <strong>נגד, {r.trait.label}: </strong>
                          {r.why}
                        </p>
                      ))}
                    </>
                  )
                })()}
                <p className="hint">
                  מושגים שמתאימים ל{useDef.label}: {modelsForUse(useDef.id, 4).map((x) => x.model.name_he).join(', ')}.{' '}
                  <button type="button" className="quiet" onClick={() => toLearn({ mode: 'need', use: useDef.id })}>
                    להשוואה
                  </button>
                </p>
              </div>
            )}

            {stage.id === 'inspiration' && (
              <div className="jw-materials">
                <h3>תמונות השראה</h3>
                <Gallery images={state.references.map((i) => ({ ...i, remove: () => removeLib(i.id) }))} onRemove />
                <div className="field">
                  <label htmlFor="ref-caption">מה רואים בתמונה (לא חובה)</label>
                  <input id="ref-caption" value={caption} onChange={(e) => setCaption(e.currentTarget.value)} dir="auto" />
                </div>
                <DropZone label="תמונות השראה" hint="מקום, חומר, אור, יצירה: כל מה שמעורר את הרעיון." onUpload={uploadTo('reference')} testid="upload-reference" />
                <h3>קונספט עם Claude</h3>
                <p className="hint">
                  Claude קורא את המושג{chosen ? ` (${chosen.name_he})` : ''}, ההקשר, השימוש, טקסט ההשראה ועד שתי תמונות, ומציע קונספט שמחבר ביניהם, ומושגים אחרים אם הם מתאימים יותר.
                </p>
                <button type="button" onClick={() => askClaude(true)} disabled={!!busy} data-testid="suggest-statement">
                  {busy === 'suggest' ? 'Claude קורא את ההשראה' : 'הצעת קונספט'}
                </button>
                {suggest && (
                  <>
                    {suggest.statement && (
                      <div className="jw-statement" data-testid="statement">
                        <p>{suggest.statement}</p>
                        <button type="button" className="primary" onClick={() => (setField('concept.statement', suggest.statement), setStatus('הנוסח הועתק לשדה "הקונספט". אפשר לערוך אותו.'))}>
                          שימוש בנוסח
                        </button>
                      </div>
                    )}
                    <SuggestView r={suggest} projectId={projectId} />
                  </>
                )}
              </div>
            )}

            {stage.id === 'model' && (
              <div className="jw-materials">
                <h3>המתכון והמודל</h3>
                {state.recipe ? (
                  <div className="jw-recipe">
                    <p className="journey-name">
                      {state.recipe.narrative.name_he} · {state.recipe.concept.name_he} <span lang="en">({state.recipe.concept.name})</span>
                    </p>
                    {state.recipe.narrative.maxim && <p className="lead">{state.recipe.narrative.maxim}</p>}
                    <p>{state.recipe.narrative.insight}</p>
                    {state.recipe.narrative.fit_note && <p className="hint">מה אבד בתרגום: {state.recipe.narrative.fit_note}</p>}
                    <p className="hint">{state.versions.length === 1 ? 'גרסה אחת' : `${state.versions.length} גרסאות`} בפרויקט. בסטודיו, כל מדד מוסבר: מה הוא מודד ומה הוא אומר להחלטה.</p>
                  </div>
                ) : (
                  <p className="hint">עוד אין מתכון. "יצירת מתכון" שולחת את המושג, השימוש והמקום אל Claude, והמתכון נשמר כאן כגרסה הראשונה.</p>
                )}
                <Gallery images={state.stills.bare} />
                <div className="toolbar compact">
                  <button type="button" className={state.recipe ? '' : 'primary'} onClick={() => (void flush(), navigate('new', { p: projectId! }))} data-testid="make-recipe">
                    {state.recipe ? 'מתכון חדש מהמושג' : 'יצירת מתכון'}
                  </button>
                  {latest && (
                    <button type="button" className="primary" onClick={() => toStudio('shape')}>
                      פיתוח בסטודיו
                    </button>
                  )}
                </div>
              </div>
            )}

            {stage.id === 'environment' && (
              <div className="jw-materials">
                <h3>מבטים ריאליסטיים</h3>
                <Gallery images={state.stills.realistic} />
                {state.stills.realistic.length === 0 && <p className="hint">בסטודיו, בלשונית "סביבה", "הקפאת מבט" שומרת את מה שעל המסך בשלב הזה.</p>}
                <p className="hint">מחושב: מיקום השמש והצל לפי תאריך ומקום, ומשקל לפי צפיפות החומר. מומחש בלבד: מרקם, מזג אוויר ורוח.</p>
                {latest ? (
                  <button type="button" className="primary" onClick={() => toStudio('scene')}>
                    חומרים וסביבה בסטודיו
                  </button>
                ) : (
                  <button type="button" onClick={() => go('model')}>
                    קודם מתכון, בשלב 05
                  </button>
                )}
              </div>
            )}

            {stage.id === 'illustration' && (
              <div className="jw-materials">
                <h3>פרומפטים ותמונות</h3>
                {state.prompts.length === 0 && <p className="hint">עוד אין פרומפט. אפשר לגזור אחד מהמודל, או לכתוב אחד משלך עם התמונה שנוצרה ממנו.</p>}
                {state.prompts.map((p) => (
                  <article key={p.id} className="prompt-card" data-testid="work-prompt">
                    <p className="distill">{p.distill}</p>
                    {p.body ? (
                      <details>
                        <summary>הפרומפט</summary>
                        <p className="prompt">{p.body}</p>
                      </details>
                    ) : (
                      <p className="hint">חסר נוסח הפרומפט שממנו נוצרה התמונה.</p>
                    )}
                    <Gallery images={p.images.map((i) => ({ ...i, remove: () => removeLib(i.id) }))} onRemove />
                    <DropZone
                      label="תמונה מהפרומפט הזה"
                      hint="התמונה שנוצרה, במידג'רני או בכלי אחר."
                      onUpload={async (file) => {
                        await uploadImage({ projectId: projectId!, promptId: p.id, versionId: latest?.id ?? null, file })
                        void refresh()
                      }}
                      testid="upload-to-prompt"
                    />
                    <button type="button" className="quiet" onClick={() => navigator.clipboard?.writeText(`${p.distill}\n\n${p.body}`).then(() => setStatus('הפרומפט הועתק.'))}>
                      העתקת הפרומפט
                    </button>
                  </article>
                ))}
                <div className="toolbar compact">
                  {state.recipe && (
                    <button type="button" onClick={promptFromModel} disabled={!!busy} data-testid="prompt-from-model">
                      {busy === 'model-prompt' ? 'גוזר' : 'פרומפט מהמודל'}
                    </button>
                  )}
                </div>
                <h3>פרומפט משלך, עם התמונה שלו</h3>
                <div className="field">
                  <label htmlFor="own-distill">משפט זיקוק</label>
                  <input
                    id="own-distill"
                    value={promptDraft.distill}
                    onChange={(e) => {
                      const v = e.currentTarget.value
                      setPromptDraft((d) => ({ ...d, distill: v }))
                    }}
                    dir="auto"
                    data-testid="own-distill"
                  />
                </div>
                <div className="field">
                  <label htmlFor="own-body">הפרומפט</label>
                  <textarea
                    id="own-body"
                    rows={4}
                    value={promptDraft.body}
                    onChange={(e) => {
                      const v = e.currentTarget.value
                      setPromptDraft((d) => ({ ...d, body: v }))
                    }}
                    dir="auto"
                    data-testid="own-body"
                  />
                </div>
                <div className="toolbar compact">
                  <button type="button" onClick={() => addOwnPrompt()} disabled={!!busy || !promptDraft.body.trim()} data-testid="save-own-prompt">
                    שמירת הפרומפט
                  </button>
                  <label className="filebtn">
                    {busy === 'own-prompt' ? 'מעלה' : 'שמירה עם תמונה'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!!busy} onChange={(e) => (void addOwnPrompt([...(e.currentTarget.files ?? [])]), (e.currentTarget.value = ''))} data-testid="upload-with-prompt" />
                  </label>
                </div>
              </div>
            )}

            {stage.id === 'production' && (
              <div className="jw-materials">
                <h3>הדפסה</h3>
                <p>{state.print ?? 'עוד אין קובץ הדפסה. בסטודיו, הלשונית "הדפסה" מציגה את גודל הדגם בסנטימטרים ואת קנה המידה, חותכת את מה שמתחת לקרקע, ומראה את הדגם שיודפס.'}</p>
                <h3>סרטון</h3>
                <p>{state.hasClip ? 'יש סרטון בקולקציה.' : 'עוד אין סרטון. בסטודיו, הלשונית "סרטון" בונה אותו ממבטים שבוחרים ומסדרים, עם מעבר מערום לריאליסטי.'}</p>
                {latest && (
                  <div className="toolbar compact">
                    <button type="button" className="primary" onClick={() => toStudio('print')}>
                      הדפסה בסטודיו
                    </button>
                    <button type="button" onClick={() => toStudio('video')}>
                      סרטון בסטודיו
                    </button>
                  </div>
                )}
              </div>
            )}

            {stage.id === 'exhibition' && (
              <div className="jw-materials">
                <h3>צילומים של התוצאה</h3>
                <Gallery images={state.photos.map((i) => ({ ...i, remove: () => removeLib(i.id) }))} onRemove />
                <div className="field">
                  <label htmlFor="photo-caption">מה רואים בצילום (לא חובה)</label>
                  <input id="photo-caption" value={caption} onChange={(e) => setCaption(e.currentTarget.value)} dir="auto" />
                </div>
                <DropZone label="צילומי התוצאה" hint="הדגם המודפס, או ההצבה." onUpload={uploadTo('photo')} testid="upload-photo" />
                {state.stills.render.length > 0 && (
                  <>
                    <h3>הדמיות מהסטודיו</h3>
                    <Gallery images={state.stills.render} />
                  </>
                )}
                <h3>המאמר</h3>
                <p>המאמר נבנה מכל השלבים, ו-Claude יכול לנסח ממנו טיוטה רציפה, רק מהחומרים. {gaps ? `${gaps} חלקים עוד חסרים, וכל אחד מוביל לשלב שבו משלימים אותו.` : 'כל החלקים מלאים.'}</p>
                <div className="toolbar compact">
                  <button type="button" className="primary" onClick={() => (void flush(), navigate('article', { p: projectId! }))}>
                    פתיחת המאמר
                  </button>
                  <button type="button" onClick={() => (void flush(), navigate('poster', { p: projectId! }))}>
                    פלייר לתערוכה
                  </button>
                </div>
                <p className="hint">הפלייר הוא עמוד אחד: התמונה, הקו של המודל עליה, הרעיון וארבע תכונות של המודל. PDF ב-A4 או A3, ו-PNG לשיתוף. קישור לסרטון בשלב 8 הופך בו לקוד QR.</p>
              </div>
            )}

            <div className="jw-fields">
              <h3>למלא</h3>
              {stage.fields.map((f) => {
                const value = fieldValue(journey, f.path)
                const id = `f-${f.path.replace('.', '-')}`
                return (
                  <div className="field" key={f.path}>
                    <label htmlFor={id}>{f.label}</label>
                    {f.long ? (
                      <textarea id={id} rows={4} value={value} onChange={(e) => setField(f.path, e.currentTarget.value)} onBlur={() => void flush()} data-testid={id} dir="auto" />
                    ) : (
                      <input id={id} value={value} onChange={(e) => setField(f.path, e.currentTarget.value)} onBlur={() => void flush()} data-testid={id} dir="auto" />
                    )}
                    <span className="why">{f.hint}</span>
                  </div>
                )
              })}
              <p className="hint" role="status" data-testid="save-state">
                {saveState === 'saving' ? 'שומר' : saveState === 'saved' ? 'נשמר בפרויקט' : saveState === 'failed' ? 'השמירה נכשלה. השינוי נשאר כאן, ונשלח שוב בשינוי הבא.' : 'כל שינוי נשמר מעצמו'}
              </p>
            </div>

            <div className="jw-yield" data-testid="step-status">
              <h3>מה התקבל</h3>
              <p>{stage.yields}</p>
              <p className="jw-state" data-state={st.state}>
                {STATE_WORD[st.state]}
              </p>
              {st.have.length > 0 && <p>יש: {st.have.join(', ')}.</p>}
              {st.missing.length > 0 && (
                <p data-testid="step-missing">
                  <strong>חסר: </strong>
                  {st.missing.join(', ')}. אפשר להמשיך בלי זה ולחזור לכאן.
                </p>
              )}
              {index < STAGES.length - 1 && (
                <p>
                  <strong>הצעד הבא: </strong>
                  {STAGES[index + 1]!.title}. {STAGES[index + 1]!.doing}
                </p>
              )}
            </div>

            <p className="hint" role="status" data-testid="work-status">
              {status}
            </p>

            <nav className="jw-steps toolbar" aria-label="מעבר בין שלבים">
              {index > 0 && (
                <button type="button" onClick={() => go(STAGES[index - 1]!.id)} data-testid="prev-stage">
                  הקודם: {STAGES[index - 1]!.title}
                </button>
              )}
              {index < STAGES.length - 1 ? (
                <button type="button" className="primary" onClick={() => go(STAGES[index + 1]!.id)} data-testid="next-stage">
                  הבא: {STAGES[index + 1]!.title}
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => (void flush(), navigate('article', { p: projectId! }))}>
                  למאמר
                </button>
              )}
            </nav>
          </section>
        </div>
      )}
    </div>
  )
}
