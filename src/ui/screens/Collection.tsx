/**
 * The collection (DECISIONS.md 84): one concept's way from an abstract idea to a figure, in six fixed steps.
 * Each step shows what was kept on it: the versions, the frozen views, the images. A frozen view opens again in
 * the studio exactly as it was looked at.
 */
import { useCallback, useEffect, useState } from 'react'
import { loadCollection, STAGES, type Collection, type Stage } from '../../data/collection'
import { removeItem, type LibraryItem } from '../../data/library'
import { ensureSession, type SessionState } from '../../data/supabase'
import { parseRecipe } from '../../recipe/schema'
import { download } from '../download'
import { EmailLogin } from '../panels/EmailLogin'
import type { Sweep } from '../params'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'

const when = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
const CAMERA_LABEL: Record<string, string> = { eye_level_oblique: 'גובה עיניים', aerial: 'מבט על', inside: 'בפנים', courtyard: 'מהחצר' }
const pad = (n: number) => String(n).padStart(2, '0')

function StillCard({ item, number, onRemove, setStatus }: { item: LibraryItem; number: number | null; onRemove: () => void; setStatus: (s: string) => void }) {
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!item.url) return
    setBusy(true)
    try {
      const blob = await (await fetch(item.url)).blob()
      download(blob, blob.type || 'image/jpeg', item.image_path!.split('/').pop()!)
    } catch (e) {
      setStatus(`ההורדה נכשלה: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <figure className="gallery-item frame" data-testid="still" data-stage={item.stage ?? ''}>
      {item.url ? <img className="snapshot" src={item.url} alt={`מבט קפוא, ${when(item.created_at)}`} loading="lazy" /> : <span className="hint">התמונה לא נטענה</span>}
      <figcaption className="hint">
        {[number ? `גרסה ${number}` : null, item.view ? CAMERA_LABEL[item.view.camera.preset] : null, when(item.created_at)].filter(Boolean).join(' · ')}
      </figcaption>
      <div className="toolbar compact">
        {item.version_id && item.view && (
          <button type="button" onClick={() => navigate('studio', { v: item.version_id!, view: JSON.stringify(item.view) })} data-testid="open-view">
            פתיחה במבט הזה
          </button>
        )}
        <button type="button" onClick={save} disabled={busy || !item.url}>
          {busy ? 'מוריד' : 'הורדה'}
        </button>
        <button type="button" className="quiet" onClick={() => confirm('למחוק את המבט מהקולקציה?') && onRemove()} data-testid="remove-still">
          מחיקה
        </button>
      </div>
    </figure>
  )
}

export function CollectionScreen() {
  const projectId = useParam('p')
  const [session, setSession] = useState<SessionState | null>(null)
  const [data, setData] = useState<Collection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  const refresh = useCallback(async () => {
    if (!projectId) return setError('חסר פרויקט בכתובת.')
    setError(null)
    const s = await ensureSession()
    setSession(s)
    if (s.status !== 'signed-in') return
    try {
      setData(await loadCollection(projectId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [projectId])
  useEffect(() => void refresh(), [refresh])

  const parsed = data?.latest ? parseRecipe(data.latest.recipe) : null
  const recipe = parsed?.ok && parsed.recipe.generator.type === 'sweep' ? (parsed.recipe as Sweep) : null
  const numberOf = (versionId: string | null) => data?.versions.find((v) => v.id === versionId)?.number ?? null
  const stillsOn = (stage: Stage) => data?.stills.filter((s) => s.stage === stage) ?? []
  const count = (stage: Stage) =>
    stage === 'concept' ? (recipe ? 1 : 0) : stage === 'recipe' ? (data?.versions.length ?? 0) : stage === 'render' ? stillsOn(stage).length + (data?.images.length ?? 0) : stillsOn(stage).length
  const remove = async (item: LibraryItem) => {
    try {
      await removeItem(item)
      setStatus('המבט נמחק.')
      await refresh()
    } catch (e) {
      setStatus(`${e instanceof Error ? e.message : String(e)} אפשר לנסות שוב.`)
    }
  }
  const toStudio = () => data?.latest && navigate('studio', { v: data.latest.id })

  const title = recipe?.narrative.name_he ?? data?.project.title_he ?? 'קולקציה'
  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'פרויקטים', to: 'projects' }, { label: data?.project.title_he ?? 'פרויקט' }, { label: 'קולקציה' }]} />
      <header className="screen">
        <span className="eyebrow">קולקציה · {recipe ? [recipe.concept.name_he, recipe.concept.name].join(' · ') : (data?.project.concept ?? '')}</span>
        <h1>{title}</h1>
        <p className="lead">הדרך של המושג ממופשט לפיגורטיבי, בשישה שלבים. כל מבט קפוא נשמר בשלב שלו, עם הגרסה ונקודת המבט שיצרו אותו.</p>
        {data && (
          <div className="toolbar compact">
            {data.latest && (
              <button type="button" className="primary" onClick={() => toStudio()}>
                פתיחה בסטודיו
              </button>
            )}
            <button type="button" onClick={() => navigate('library', { p: data.project.id })}>
              ספרייה
            </button>
          </div>
        )}
      </header>

      {session?.status === 'needs-email' && <EmailLogin why="הקולקציה שמורה בחשבון." />}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <div className="toolbar compact">
            <button type="button" onClick={refresh}>
              ניסיון חוזר
            </button>
            <button type="button" onClick={() => navigate('projects')}>
              חזרה לפרויקטים
            </button>
          </div>
        </div>
      )}
      {!data && !error && session?.status !== 'needs-email' && (
        <p className="hint" role="status">
          טוען את הקולקציה
        </p>
      )}

      {data && (
        <>
          <nav className="journey-steps" aria-label="שלבי התהליך">
            <ol>
              {STAGES.map((s, i) => (
                <li key={s.id} data-filled={count(s.id) > 0}>
                  <a
                    href={`#/collection?p=${data.project.id}`}
                    onClick={(e) => (e.preventDefault(), document.getElementById(`stage-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }))}
                  >
                    <span className="num">{pad(i + 1)}</span> {s.label} <span className="num">({count(s.id)})</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <p className="hint" role="status" data-testid="collection-status">
            {status}
          </p>

          <ol className="journey" data-testid="collection">
            {STAGES.map((s, i) => (
              <li key={s.id} id={`stage-${s.id}`} className="journey-stage" data-testid={`stage-${s.id}`} data-count={count(s.id)}>
                <header>
                  <span className="journey-num">{pad(i + 1)}</span>
                  <h2>{s.label}</h2>
                  <p className="hint">{s.why}</p>
                </header>

                {s.id === 'concept' && recipe && (
                  <div className="journey-concept">
                    <p className="journey-name">
                      {recipe.concept.name_he} <span lang="en">({recipe.concept.name})</span>
                    </p>
                    {recipe.narrative.maxim && <p className="lead">{recipe.narrative.maxim}</p>}
                    {data.reading && <p className="reading-synthesis">{data.reading.synthesis}</p>}
                  </div>
                )}

                {s.id === 'recipe' && (
                  <div className="gallery wide">
                    {data.versions.map((v) => (
                      <figure key={v.id} className="gallery-item frame" data-testid="collection-version">
                        {v.thumbnail ? <img className="snapshot" src={v.thumbnail} alt={`צילום של גרסה ${v.number}`} loading="lazy" /> : <span className="hint">אין צילום</span>}
                        <figcaption className="hint">
                          גרסה {v.number}
                          {v.note ? `: ${v.note}` : ''} · {when(v.created_at)}
                        </figcaption>
                        <div className="toolbar compact">
                          <button type="button" onClick={() => navigate('studio', { v: v.id })}>
                            פתיחה
                          </button>
                        </div>
                      </figure>
                    ))}
                  </div>
                )}

                {(s.id === 'bare' || s.id === 'realistic' || s.id === 'render') && stillsOn(s.id).length > 0 && (
                  <div className="gallery wide">
                    {stillsOn(s.id).map((item) => (
                      <StillCard key={item.id} item={item} number={numberOf(item.version_id)} onRemove={() => remove(item)} setStatus={setStatus} />
                    ))}
                  </div>
                )}

                {s.id === 'render' && data.images.length > 0 && (
                  <>
                    <h3>תמונות שנוצרו מהפרומפט</h3>
                    <div className="gallery wide">
                      {data.images.map((img) => (
                        <figure key={img.id} className="gallery-item frame">
                          {img.url && <img className="snapshot" src={img.url} alt="תמונה שהועלתה מפרומפט" loading="lazy" />}
                          <figcaption className="hint">{when(img.created_at)}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </>
                )}

                {(s.id === 'bare' || s.id === 'realistic') && stillsOn(s.id).length === 0 && (
                  <p className="hint">
                    עוד אין מבט בשלב הזה. בסטודיו, ברמה ה{s.label === 'ערום' ? 'ערומה' : 'ריאליסטית'}, הכפתור "הקפאת מבט" שומר את מה שעל המסך.{' '}
                    {data.latest && (
                      <button type="button" onClick={() => toStudio()}>
                        לסטודיו
                      </button>
                    )}
                  </p>
                )}
                {s.id === 'render' && count('render') === 0 && <p className="hint">עוד אין הדמיה. רינדור מלא של מבט נבחר מגיע בשלב הבא, ובינתיים אפשר להעלות תמונות מהפרומפט בספרייה.</p>}
                {s.id === 'print' && <p className="hint">בדיקת הדפסה (קנה מידה, עובי דופן במ"מ ואטימות) מגיעה בשלב מאוחר יותר. בינתיים, STL נמצא בסטודיו, בלשונית "שמירה".</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
