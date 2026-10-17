/**
 * The project on its work path (DECISIONS.md 97): nine steps, from an idea to the exhibition article. Each step
 * shows what it is for, what it leans on from the steps before it, what to fill in, what it yields, and what is
 * still missing. Nothing blocks: any step opens at any time, and a project made before the path existed shows
 * what it already holds. What is written here is saved on the project and flows into the article.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addPrompt, imageProblem, removeItem, uploadImage } from '../../data/library'
import { ensureSession, type SessionState } from '../../data/supabase'
import { loadWork, saveJourney, uploadWorkImage, type Work } from '../../data/work'
import { buildArticle } from '../../journey/article'
import { doneCount, nextStage, projectName, STAGES, stageById, stageStatus, type Journey, type StageDef, type StageId, type WorkImage } from '../../journey/stages'
import { visualPrompt } from '../../prompt/visualPrompt'
import { EmailLogin } from '../panels/EmailLogin'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'

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

function FileButton({ label, busy, onFiles, testid }: { label: string; busy: boolean; onFiles: (files: File[]) => void; testid: string }) {
  return (
    <label className="filebtn">
      {busy ? 'מעלה' : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        disabled={busy}
        onChange={(e) => (onFiles([...(e.currentTarget.files ?? [])]), (e.currentTarget.value = ''))}
        data-testid={testid}
      />
    </label>
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
  // Another project: nothing of the previous one stays on screen.
  useEffect(() => {
    setWork(null)
    setJourney({})
    pending.current = null
  }, [projectId])

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
  // Leaving the screen writes what is waiting.
  useEffect(() => () => void flush(), [flush])

  const setField = (stage: StageId, key: string, value: string) => {
    setJourney((j) => {
      const next = { ...j, [stage]: { ...(j[stage] as Record<string, string> | undefined), [key]: value } } as Journey
      pending.current = next
      return next
    })
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 700)
  }

  const state = useMemo(() => (work ? { ...work.state, journey } : null), [work, journey])
  const stage: StageDef = (stageParam && stageById(stageParam)) || (state ? nextStage(state) : STAGES[0]!)
  const index = STAGES.indexOf(stage)
  const go = (id: StageId) => (void flush(), navigate('project', { p: projectId!, s: id }))
  const latest = work?.collection.latest ?? null
  const toStudio = () => latest && (void flush(), navigate('studio', { v: latest.id }))

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

  const uploadRefs = (kind: 'reference' | 'photo') => (files: File[]) =>
    run(kind, async () => {
      const bad = files.map(imageProblem).filter(Boolean)
      if (bad.length) throw new Error(bad.join(' '))
      for (const file of files) await uploadWorkImage({ kind, projectId: projectId!, file, caption })
      setCaption('')
      return files.length === 1 ? 'התמונה נוספה.' : `${files.length} תמונות נוספו.`
    })

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

  const uploadToPrompt = (promptId: string) => (files: File[]) =>
    run(`img-${promptId}`, async () => {
      const bad = files.map(imageProblem).filter(Boolean)
      if (bad.length) throw new Error(bad.join(' '))
      for (const file of files) await uploadImage({ projectId: projectId!, promptId, versionId: latest?.id ?? null, file })
      return files.length === 1 ? 'התמונה נוספה לפרומפט.' : `${files.length} תמונות נוספו לפרומפט.`
    })

  const removeLib = (id: string) =>
    run('remove', async () => {
      const all = [...(work?.references ?? []), ...(work?.photos ?? []), ...(work?.library.prompts.flatMap((p) => p.images) ?? [])]
      const item = all.find((i) => i.id === id)
      if (item) await removeItem(item)
      return 'נמחק.'
    })

  const name = state ? projectName(state) : 'פרויקט'
  const st = state ? stageStatus(stage.id, state) : null
  const gaps = state ? buildArticle(state, work!.row.article).gaps.length : 0

  // ---------- what the steps before this one hold ----------
  const before = state
    ? STAGES.slice(0, index)
        .map((s) => {
          const j = (journey[s.id] ?? {}) as Record<string, string | undefined>
          // The name is already in the header; the summary is the first thing written after it.
          const text = s.fields
            .filter((f) => f.key !== 'title')
            .map((f) => j[f.key]?.trim())
            .find(Boolean)
          const extra =
            s.id === 'concept' && state.recipe
              ? `${state.recipe.concept.name_he}: ${state.recipe.narrative.maxim ?? state.recipe.narrative.insight}`
              : s.id === 'prompt' && state.prompts[0]
                ? state.prompts[0].distill
                : null
          const line = text ?? extra
          return line ? { s, line: clip(line) } : null
        })
        .filter((x): x is { s: StageDef; line: string } => !!x)
    : []

  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'בית', to: 'home' }, { label: name, to: 'project', params: projectId ? { p: projectId } : undefined }, { label: stage.title }]} />
      <header className="screen jw-head">
        <span className="eyebrow">פרויקט · {state ? `${doneCount(state)} מתוך 9 שלבים הושלמו` : ''}</span>
        <h1>{name}</h1>
        {work && (
          <div className="toolbar compact">
            <button type="button" className="primary" onClick={() => (void flush(), navigate('article', { p: projectId! }))} data-testid="open-article">
              המאמר{gaps ? ` (${gaps} חסרים)` : ''}
            </button>
            {latest && (
              <button type="button" onClick={toStudio}>
                סטודיו
              </button>
            )}
            <button type="button" onClick={() => navigate('collection', { p: projectId! })}>
              קולקציה
            </button>
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
                <p className="lead">{stage.goal}</p>
              </div>
            </header>

            <div className="jw-leans">
              <h3>נשען על</h3>
              <p>{stage.leans}</p>
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
            </div>

            <div className="jw-fields">
              <h3>למלא</h3>
              {stage.fields.map((f) => {
                const value = ((journey[stage.id] ?? {}) as Record<string, string | undefined>)[f.key] ?? ''
                const id = `f-${stage.id}-${f.key}`
                return (
                  <div className="field" key={f.key}>
                    <label htmlFor={id}>{f.label}</label>
                    {f.long ? (
                      <textarea id={id} rows={4} value={value} onChange={(e) => setField(stage.id, f.key, e.currentTarget.value)} onBlur={() => void flush()} data-testid={id} dir="auto" />
                    ) : (
                      <input id={id} value={value} onChange={(e) => setField(stage.id, f.key, e.currentTarget.value)} onBlur={() => void flush()} data-testid={id} dir="auto" />
                    )}
                    <span className="why">{f.hint}</span>
                  </div>
                )
              })}
              <p className="hint" role="status" data-testid="save-state">
                {saveState === 'saving' ? 'שומר' : saveState === 'saved' ? 'נשמר בפרויקט' : saveState === 'failed' ? 'השמירה נכשלה. השינוי נשאר כאן, ונשלח שוב בשינוי הבא.' : 'כל שינוי נשמר מעצמו'}
              </p>
            </div>

            {/* ---------- materials of the step ---------- */}
            {stage.id === 'context' && (
              <div className="jw-materials">
                <h3>תמונות השראה</h3>
                <Gallery images={state.references.map((i) => ({ ...i, remove: () => removeLib(i.id) }))} onRemove />
                <div className="field">
                  <label htmlFor="ref-caption">מה רואים בתמונה (לא חובה)</label>
                  <input id="ref-caption" value={caption} onChange={(e) => setCaption(e.currentTarget.value)} dir="auto" />
                </div>
                <FileButton label="העלאת תמונות השראה" busy={busy === 'reference'} onFiles={uploadRefs('reference')} testid="upload-reference" />
              </div>
            )}

            {stage.id === 'concept' && (
              <div className="jw-materials">
                <h3>המתכון</h3>
                {state.recipe ? (
                  <div className="jw-recipe">
                    <p className="journey-name">
                      {state.recipe.narrative.name_he} · {state.recipe.concept.name_he} <span lang="en">({state.recipe.concept.name})</span>
                    </p>
                    {state.recipe.narrative.maxim && <p className="lead">{state.recipe.narrative.maxim}</p>}
                    <p>{state.recipe.narrative.insight}</p>
                    {state.reading ? <p className="reading-synthesis">{state.reading.synthesis}</p> : <p className="hint">עוד אין פרשנות. בסטודיו, הלשונית "פרשנות" כותבת אותה מהמספרים של המודל.</p>}
                    <p className="hint">{state.versions.length === 1 ? 'גרסה אחת' : `${state.versions.length} גרסאות`} בפרויקט.</p>
                  </div>
                ) : (
                  <p className="hint">עוד אין מתכון. "יצירת מתכון" שולחת את המושג, השימוש והמקום אל Claude, והמתכון נשמר כאן כגרסה הראשונה.</p>
                )}
                <div className="toolbar compact">
                  <button type="button" className={state.recipe ? '' : 'primary'} onClick={() => (void flush(), navigate('new', { p: projectId! }))} data-testid="make-recipe">
                    {state.recipe ? 'מתכון חדש מהמושג' : 'יצירת מתכון'}
                  </button>
                  {latest && (
                    <button type="button" className="primary" onClick={toStudio}>
                      פתיחה בסטודיו
                    </button>
                  )}
                </div>
              </div>
            )}

            {stage.id === 'prompt' && (
              <div className="jw-materials">
                <h3>פרומפטים</h3>
                {state.prompts.length === 0 && <p className="hint">עוד אין פרומפט. אפשר לגזור אחד מהמודל, או לכתוב אחד משלך.</p>}
                {state.prompts.map((p) => (
                  <article key={p.id} className="prompt-card" data-testid="work-prompt">
                    <p className="distill">{p.distill}</p>
                    {p.body && (
                      <details>
                        <summary>הפרומפט</summary>
                        <p className="prompt">{p.body}</p>
                      </details>
                    )}
                    <div className="toolbar compact">
                      <button type="button" onClick={() => navigator.clipboard?.writeText(`${p.distill}\n\n${p.body}`).then(() => setStatus('הפרומפט הועתק.'))}>
                        העתקה
                      </button>
                      <span className="hint">{p.images.length ? `${p.images.length} תמונות` : 'בלי תמונה עדיין'}</span>
                    </div>
                  </article>
                ))}
                <div className="toolbar compact">
                  {state.recipe && (
                    <button type="button" onClick={promptFromModel} disabled={!!busy} data-testid="prompt-from-model">
                      {busy === 'model-prompt' ? 'גוזר' : 'פרומפט מהמודל'}
                    </button>
                  )}
                </div>
                <h3>פרומפט משלך</h3>
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
                <button type="button" onClick={() => addOwnPrompt()} disabled={!!busy || !promptDraft.body.trim()} data-testid="save-own-prompt">
                  שמירת הפרומפט
                </button>
              </div>
            )}

            {stage.id === 'illustration' && (
              <div className="jw-materials">
                <h3>תמונות מהפרומפטים</h3>
                {state.prompts.map((p) => (
                  <article key={p.id} className="prompt-card">
                    <p className="distill">{p.distill}</p>
                    <Gallery images={p.images.map((i) => ({ ...i, remove: () => removeLib(i.id) }))} onRemove />
                    <FileButton label="העלאת תמונה מהפרומפט הזה" busy={busy === `img-${p.id}`} onFiles={uploadToPrompt(p.id)} testid="upload-to-prompt" />
                  </article>
                ))}
                <h3>תמונה עם הפרומפט שלה</h3>
                <p className="hint">לתמונה שנוצרה מחוץ לאפליקציה: מדביקים את הפרומפט שממנו נוצרה ומעלים אותה. בלי פרומפט היא נשמרת, והפרומפט מסומן כחסר.</p>
                <div className="field">
                  <label htmlFor="ill-body">הפרומפט</label>
                  <textarea
                    id="ill-body"
                    rows={3}
                    value={promptDraft.body}
                    onChange={(e) => {
                      const v = e.currentTarget.value
                      setPromptDraft((d) => ({ ...d, body: v }))
                    }}
                    dir="auto"
                    data-testid="ill-body"
                  />
                </div>
                <FileButton label="העלאת התמונה" busy={busy === 'own-prompt'} onFiles={(files) => addOwnPrompt(files)} testid="upload-with-prompt" />
              </div>
            )}

            {stage.id === 'form' && (
              <div className="jw-materials">
                <h3>מבטים מהסטודיו</h3>
                <Gallery images={[...state.stills.bare, ...state.stills.realistic]} />
                {state.stills.bare.length + state.stills.realistic.length === 0 && <p className="hint">בסטודיו, "הקפאת מבט" שומרת את מה שעל המסך בשלב שלו. מבט ערום ומבט ריאליסטי נכנסים למאמר.</p>}
                <div className="toolbar compact">
                  {latest ? (
                    <button type="button" className="primary" onClick={toStudio}>
                      פתיחה בסטודיו
                    </button>
                  ) : (
                    <button type="button" onClick={() => go('concept')}>
                      קודם מתכון, בשלב 03
                    </button>
                  )}
                </div>
              </div>
            )}

            {stage.id === 'physical' && (
              <div className="jw-materials">
                <h3>קובץ ההדפסה</h3>
                <p>{state.print ?? 'עוד אין קובץ הדפסה. בסטודיו, הלשונית "הדפסה" מכינה קובץ סגור בגודל במילימטרים ובודקת את עובי הדופן.'}</p>
                {latest && (
                  <button type="button" onClick={toStudio}>
                    לסטודיו
                  </button>
                )}
              </div>
            )}

            {stage.id === 'documentation' && (
              <div className="jw-materials">
                <h3>צילומים של התוצאה</h3>
                <Gallery images={state.photos.map((i) => ({ ...i, remove: () => removeLib(i.id) }))} onRemove />
                <div className="field">
                  <label htmlFor="photo-caption">מה רואים בצילום (לא חובה)</label>
                  <input id="photo-caption" value={caption} onChange={(e) => setCaption(e.currentTarget.value)} dir="auto" />
                </div>
                <FileButton label="העלאת צילומים" busy={busy === 'photo'} onFiles={uploadRefs('photo')} testid="upload-photo" />
                {state.stills.render.length > 0 && (
                  <>
                    <h3>הדמיות מהסטודיו</h3>
                    <Gallery images={state.stills.render} />
                  </>
                )}
                {state.hasClip && <p className="hint">יש סרטון בקולקציה.</p>}
              </div>
            )}

            {stage.id === 'exhibition' && (
              <div className="jw-materials">
                <h3>המאמר</h3>
                <p>המאמר נבנה מכל השלבים, ואפשר לערוך בו כל פסקה. {gaps ? `${gaps} חלקים עוד חסרים, וכל אחד מהם מוביל לשלב שבו משלימים אותו.` : 'כל החלקים מלאים.'}</p>
                <button type="button" className="primary" onClick={() => (void flush(), navigate('article', { p: projectId! }))}>
                  פתיחת המאמר
                </button>
              </div>
            )}

            <div className="jw-yield" data-testid="step-status">
              <h3>התוצר</h3>
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
