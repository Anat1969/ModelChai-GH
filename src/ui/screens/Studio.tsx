/**
 * Studio (PRODUCT.md "מסכים" 3): the 1:1 model on the start side, the parameter panel with two tabs beside it,
 * metrics and the insight below the model.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadDraft, saveDraft } from '../../data/offline'
import { getVersion } from '../../data/projects'
import { cameraControl } from '../../scene/BareScene'
import { sectionCut } from '../../engine/sectionCut'
import { parseRecipe } from '../../recipe/schema'
import { Viewport } from '../../scene/Viewport'
import { meters, num } from '../format'
import { ExportPanel } from '../panels/ExportPanel'
import { MetricsPanel } from '../panels/MetricsPanel'
import { NoticeBox } from '../panels/NoticeBox'
import { ParamsPanel } from '../panels/ParamsPanel'
import { RealisticPanel } from '../panels/RealisticPanel'
import { FIXTURES, RecipeLoader } from '../panels/RecipeLoader'
import type { Sweep } from '../params'
import { useStudio, type CameraPreset } from '../store'
import { TopNav } from '../TopNav'
import { SavePanel } from '../panels/SavePanel'
import { navigate, useParam } from '../router'

const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: 'eye_level_oblique', label: 'גובה עיניים' },
  { id: 'aerial', label: 'מבט על' },
  { id: 'inside', label: 'בפנים' },
  { id: 'courtyard', label: 'מהחצר' },
]

function asSweep(raw: unknown): Sweep | null {
  if (!raw) return null
  const p = parseRecipe(raw)
  return p.ok && p.recipe.generator.type === 'sweep' ? (p.recipe as Sweep) : null
}

function SectionControl({ recipe }: { recipe: Sweep }) {
  const on = useStudio((s) => s.sectionOn)
  const t = useStudio((s) => s.sectionT)
  const set = useStudio((s) => s.set)
  const ring = recipe.generator.params.path.type === 'circle' || recipe.generator.params.path.type === 'ellipse'
  const cut = useMemo(() => (on ? sectionCut(recipe, recipe.generator.params, t) : null), [on, recipe, t])
  return (
    <div className="panel">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => set('sectionOn', e.currentTarget.checked)} data-testid="section-toggle" />
        חתך נע
      </label>
      {on && (
        <div className="ctl">
          <label htmlFor="section-t">מיקום החתך לאורך המסלול</label>
          <output htmlFor="section-t" className="num">
            {ring ? `${num(t * 360, 0)}°` : `${num(t * 100, 0)}%`}
          </output>
          <input id="section-t" type="range" min={0} max={1} step={1 / 360} value={t} onChange={(e) => set('sectionT', Number(e.currentTarget.value))} />
          <span className="why">מישור שחותך את המודל ומראה את החתך החיצוני, את הפנימי ואת קו הרצפה במקום הזה.</span>
        </div>
      )}
      {cut && (
        <p className="section-readout" data-testid="section-readout">
          {cut.floor ? `בחתך הזה: רוחב רצפה ${meters(cut.floor.width, 2)}` : 'בחתך הזה אין רצפה'}
          {cut.clearHeight !== null && `, גובה חופשי ${meters(cut.clearHeight, 2)}`}
        </p>
      )}
    </div>
  )
}

export function Studio() {
  const raw = useStudio((s) => s.recipe)
  const validRaw = useStudio((s) => s.validRecipe)
  const result = useStudio((s) => s.result)
  const camera = useStudio((s) => s.camera)
  const setCamera = useStudio((s) => s.setCamera)
  const showEdges = useStudio((s) => s.showEdges)
  const showPeople = useStudio((s) => s.showPeople)
  const tracing = useStudio((s) => s.tracing)
  const set = useStudio((s) => s.set)
  const load = useStudio((s) => s.loadRecipe)
  const level = useStudio((s) => s.level)
  const project = useStudio((s) => s.project)
  const bare = level === 'bare'
  const fileInput = useRef<HTMLDivElement>(null)

  const versionParam = useParam('v')
  const [opening, setOpening] = useState<string | null>(null)

  // Opening order: a version named in the address, then what is already open, then a local draft, then the reference model.
  useEffect(() => {
    const st = useStudio.getState()
    if (versionParam && versionParam !== st.versionId) {
      setOpening('פותח את הגרסה')
      getVersion(versionParam).then(
        (v) => {
          setOpening(null)
          load(v.recipe, v.project.title_he, undefined, { project: { id: v.project.id, concept: v.project.concept, title_he: v.project.title_he }, versionId: v.id, view: v.view, dirty: false })
        },
        (e: unknown) => {
          setOpening(null)
          st.set('notice', {
            tone: 'error',
            title: 'הגרסה לא נפתחה',
            lines: [{ text: e instanceof Error ? e.message : String(e) }],
            action: 'חזרה לפרויקטים',
          })
        },
      )
      return
    }
    if (st.recipe) return
    const draft = loadDraft()
    if (draft) {
      load(draft.recipe, draft.sourceName, undefined, { project: draft.project, versionId: draft.versionId, view: draft.view, dirty: true })
      st.set('notice', {
        tone: 'info',
        title: `שוחזרה טיוטה מקומית מ-${new Date(draft.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`,
        lines: [{ text: 'השינויים האלה עוד לא נשמרו כגרסה. "שמירת גרסה" שומרת אותם בשרת.' }],
        action: 'הבנתי',
      })
      return
    }
    load(structuredClone(FIXTURES[0].recipe), FIXTURES[0].id)
  }, [load, versionParam])

  // Every unsaved change is kept on the device, so closing the tab loses nothing.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = useStudio.subscribe((s, prev) => {
      if (!s.dirty || !s.recipe || (s.recipe === prev.recipe && s.dirty === prev.dirty)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const cur = useStudio.getState()
        if (!cur.dirty || !cur.recipe) return
        const pose = cameraControl.get?.()
        saveDraft({
          recipe: cur.recipe,
          sourceName: cur.sourceName,
          project: cur.project,
          versionId: cur.versionId,
          view: pose ? { level: cur.level, camera: { preset: cur.camera, ...pose } } : null,
          at: Date.now(),
        })
      }, 600)
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [])

  const recipe = useMemo(() => asSweep(raw), [raw])
  // The scene follows the last built recipe, so figures and the section plane always match the mesh on screen.
  const built = useMemo(() => asSweep(validRaw), [validRaw])
  const shown = built ?? recipe
  const edges = result?.metrics.edgeCount ?? 0

  return (
    <div className="wrap">
      <TopNav />
      <nav className="crumbs" aria-label="מיקום">
        <ol>
          <li>
            <a href="#/projects" onClick={(e) => (e.preventDefault(), navigate('projects'))}>
              פרויקטים
            </a>
          </li>
          <li>{project?.title_he ?? recipe?.concept.name_he ?? 'מתכון'}</li>
          <li aria-current="page">סטודיו</li>
        </ol>
      </nav>

      <header className="screen">
        <span className="eyebrow">
          סטודיו · {recipe ? [recipe.concept.name_he, recipe.concept.use].filter(Boolean).join(' · ') : 'טוען מתכון'}
        </span>
        <h1>{recipe?.narrative.name_he ?? 'יוצר: מתמטיקה'}</h1>
        {recipe && <p className="lead">{recipe.narrative.insight}</p>}
      </header>

      <div className="grid">
        <div className="col">
          <Viewport recipe={recipe ?? shown} built={shown} />
          <div className="toolbar" role="group" aria-label="נקודות מבט">
            {CAMERAS.map((c) => (
              <button key={c.id} type="button" aria-pressed={camera === c.id} onClick={() => setCamera(c.id)} data-testid={`camera-${c.id}`}>
                {c.label}
              </button>
            ))}
            {bare && (
            <button
              type="button"
              className="primary"
              disabled={!edges}
              title={edges ? undefined : 'לחתך הזה אין קצוות חדים'}
              onClick={() => {
                set('showEdges', true)
                set('traceStatus', null)
                set('tracing', !tracing)
              }}
            >
              {tracing ? 'עצירת המעקב' : 'מעקב אחרי הקצה'}
            </button>
            )}
          </div>
          <div className="toolbar">
            {bare && (
            <label className="check">
              <input type="checkbox" checked={showEdges} onChange={(e) => set('showEdges', e.currentTarget.checked)} />
              הדגשת הקצה הרציף
            </label>
            )}
            <label className="check">
              <input type="checkbox" checked={showPeople} onChange={(e) => set('showPeople', e.currentTarget.checked)} />
              אנשים לקנה מידה, 1.75 מ'
            </label>
          </div>
          {shown && bare && <SectionControl recipe={shown} />}
          {result && built && <MetricsPanel metrics={result.metrics} issues={result.issues} recipe={built} />}
          {recipe && (
            <section className="insight" aria-label="תובנה">
              {recipe.narrative.maxim && <p className="maxim">{recipe.narrative.maxim}</p>}
              {recipe.narrative.fit_note && <p className="fit">מה אבד בתרגום: {recipe.narrative.fit_note}</p>}
            </section>
          )}
        </div>

        <aside className="col" aria-label="פרמטרים">
          <div className="panel">
            <div className="tabs" role="tablist" aria-label="רמת המחשה">
              <button type="button" role="tab" aria-selected={bare} data-testid="level-bare" onClick={() => set('level', 'bare')}>
                ערום
              </button>
              <button type="button" role="tab" aria-selected={!bare} data-testid="level-realistic" onClick={() => set('level', 'realistic')}>
                ריאליסטי
              </button>
            </div>
            <p className="hint">
              {bare
                ? 'ברמה הערומה קובעים את הצורה. הרמה הריאליסטית מלבישה אותה בחומר, שמש, עונה וסביבה, בלי לשנות אותה.'
                : 'אותה רשת בדיוק, עם חומר, שמש, עונה וסביבה. שום שינוי כאן לא בונה את המודל מחדש.'}
            </p>
            <div ref={fileInput}>
              <RecipeLoader />
            </div>
            <NoticeBox
              onAction={() =>
                useStudio.getState().notice?.action === 'חזרה לפרויקטים'
                  ? navigate('projects')
                  : fileInput.current?.querySelector<HTMLInputElement>('input[type=file]')?.focus()
              }
            />
            {recipe && bare && <ParamsPanel recipe={recipe} />}
            {recipe && shown && !bare && <RealisticPanel recipe={recipe} built={shown} />}
          </div>
          {opening && (
            <p className="notice info" role="status">
              {opening}
            </p>
          )}
          <SavePanel />
          <ExportPanel />
        </aside>
      </div>
    </div>
  )
}
