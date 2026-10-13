/**
 * Studio (PRODUCT.md "מסכים" 3): a workspace that fits the screen. The 3:2 model on the start side, the tools beside it,
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
import { DevicePanel } from '../panels/DevicePanel'
import { ReadingPanel } from '../panels/ReadingPanel'
import { LibraryPanel } from '../panels/LibraryPanel'
import { navigate, useParam } from '../router'

const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: 'eye_level_oblique', label: 'גובה עיניים' },
  { id: 'aerial', label: 'מבט על' },
  { id: 'inside', label: 'בפנים' },
  { id: 'courtyard', label: 'מהחצר' },
]

type SideTab = 'shape' | 'scene' | 'reading' | 'save' | 'library'
const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: 'shape', label: 'צורה' },
  { id: 'scene', label: 'סביבה' },
  { id: 'reading', label: 'פרשנות' },
  { id: 'save', label: 'שמירה' },
  { id: 'library', label: 'ספרייה' },
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
    <div className={on ? 'sectionctl on' : 'sectionctl'}>
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
  const [tab, setTab] = useState<SideTab>(() => (useStudio.getState().level === 'realistic' ? 'scene' : 'shape'))
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
      load(draft.recipe, draft.sourceName, undefined, { project: draft.project, versionId: draft.versionId, view: draft.view, dirty: true, baseline: draft.baseline })
      st.set('notice', {
        tone: 'info',
        title: `שוחזרה טיוטה מקומית מ-${new Date(draft.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`,
        lines: [{ text: 'השינויים האלה עוד לא נשמרו כגרסה. "שמירת גרסה" שומרת אותם בשרת.' }],
        action: 'הבנתי',
      })
      return
    }
    load(structuredClone(FIXTURES[0]!.recipe), FIXTURES[0]!.id)
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
          baseline: cur.baseline,
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

  // The level and the side panel follow each other: the realistic level brings its tools, the bare one the shape.
  useEffect(() => {
    setTab((t) => (level === 'realistic' && t === 'shape' ? 'scene' : level === 'bare' && t === 'scene' ? 'shape' : t))
  }, [level])

  // Each side tab shows one task. "סביבה" dresses the model, so it also shows the realistic level.
  const openTab = (t: SideTab) => {
    setTab(t)
    if (t === 'scene') set('level', 'realistic')
  }
  const title = recipe?.narrative.name_he ?? 'יוצר: מתמטיקה'

  const baseline = useStudio((s) => s.baseline)
  const reset = useStudio((s) => s.reset)
  const changed = (keys: string[]) => !!raw && !!baseline && keys.some((k) => JSON.stringify(raw[k]) !== JSON.stringify(baseline[k]))
  const anyChange = changed(['generator', 'bare', 'realistic'])

  return (
    <div className="studio">
      <TopNav
        crumbs={[
          { label: 'פרויקטים', to: 'projects' },
          { label: project?.title_he ?? recipe?.concept.name_he ?? 'מתכון' },
          { label: 'סטודיו' },
        ]}
      />

      <section className="titleband" aria-label="המושג">
        <div className="titleband-main">
          <span className="eyebrow">{recipe ? [recipe.concept.name_he, recipe.concept.name, recipe.concept.use].filter(Boolean).join(' · ') : 'טוען מתכון'}</span>
          <h1>{title}</h1>
        </div>
        {recipe?.narrative.maxim && <p className="titleband-maxim">{recipe.narrative.maxim}</p>}
        <button
          type="button"
          className="reset"
          disabled={!anyChange}
          title={anyChange ? 'מחזיר את הצורה ואת הסביבה למצב שבו המושג הגיע: המאוזן, בקנה מידה אנושי' : 'אין שינויים מהמצב המקורי'}
          onClick={() => reset('all')}
          data-testid="reset-all"
        >
          איפוס למצב המקורי
        </button>
      </section>

      <main className="work">
        <div className="work-left">
          <div className="work-left-inner">
            <div className="work-stage">
              <Viewport recipe={recipe ?? shown} built={shown} />
              <div className="viewbar" role="toolbar" aria-label="תצוגה">
                <div className="seg level" role="tablist" aria-label="רמת המחשה">
                  <button type="button" role="tab" aria-selected={bare} aria-pressed={bare} data-testid="level-bare" onClick={() => set('level', 'bare')}>
                    ערום
                  </button>
                  <button type="button" role="tab" aria-selected={!bare} aria-pressed={!bare} data-testid="level-realistic" onClick={() => set('level', 'realistic')}>
                    ריאליסטי
                  </button>
                </div>
                <div className="seg cams" role="group" aria-label="נקודות מבט">
                  {CAMERAS.map((c) => (
                    <button key={c.id} type="button" aria-pressed={camera === c.id} onClick={() => setCamera(c.id)} data-testid={`camera-${c.id}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="viewbar-checks">
                  {bare && (
                    <button
                      type="button"
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
                  {bare && (
                    <label className="check">
                      <input type="checkbox" checked={showEdges} onChange={(e) => set('showEdges', e.currentTarget.checked)} />
                      הקצה
                    </label>
                  )}
                  <label className="check">
                    <input type="checkbox" checked={showPeople} onChange={(e) => set('showPeople', e.currentTarget.checked)} />
                    אנשים
                  </label>
                </div>
              </div>
            </div>
            <div className="work-metrics">{result && built && <MetricsPanel metrics={result.metrics} issues={result.issues} recipe={built} />}</div>
          </div>
        </div>

        <aside className="work-side" aria-label="כלים">
          <div className="sidetabs" role="tablist" aria-label="כלים">
            {SIDE_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => openTab(t.id)} data-testid={`tab-${t.id}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="side-scroll">
            <NoticeBox
              onAction={() =>
                useStudio.getState().notice?.action === 'חזרה לפרויקטים'
                  ? navigate('projects')
                  : (setTab('save'), setTimeout(() => fileInput.current?.querySelector<HTMLInputElement>('input[type=file]')?.focus()))
              }
            />
            {opening && (
              <p className="notice info" role="status">
                {opening}
              </p>
            )}
            {tab === 'shape' && recipe && (
              <>
                <div className="tabhead">
                  <button type="button" className="reset" disabled={!changed(['generator', 'bare'])} onClick={() => reset('shape')} data-testid="reset-shape">
                    איפוס הצורה
                  </button>
                  {shown && bare && <SectionControl recipe={shown} />}
                </div>
                <ParamsPanel recipe={recipe} />
              </>
            )}
            {tab === 'scene' && recipe && shown && (
              <>
                <div className="tabhead">
                  <button type="button" className="reset" disabled={!changed(['realistic'])} onClick={() => reset('scene')} data-testid="reset-scene">
                    איפוס הסביבה
                  </button>
                </div>
                <RealisticPanel recipe={recipe} built={shown} />
              </>
            )}
            {tab === 'reading' && recipe && <ReadingPanel recipe={recipe} />}
            {tab === 'save' && (
              <>
                <SavePanel />
                <ExportPanel />
                <DevicePanel />
                <section className="panel" aria-label="מתכון מקובץ">
                  <h2>מתכון מקובץ</h2>
                  <div ref={fileInput}>
                    <RecipeLoader />
                  </div>
                </section>
              </>
            )}
            {tab === 'library' && <LibraryPanel onNeedSave={() => setTab('save')} />}
          </div>
        </aside>
      </main>
    </div>
  )
}
