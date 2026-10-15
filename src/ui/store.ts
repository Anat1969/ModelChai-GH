/**
 * Studio state. The recipe is the only source of truth; the model on screen is the last successful build and
 * stays there until a newer one is ready, so the viewport is never empty.
 */
import { create } from 'zustand'
import type { BuildSuccess } from '../engine/build'
import type { View } from '../data/projects'
import { parseRecipe, type SchemaError } from '../recipe/schema'
import { engine } from './engine'
import { changesGeometry, setAt } from './recipePath'

export type CameraPreset = 'eye_level_oblique' | 'aerial' | 'inside' | 'courtyard'
export type Level = 'bare' | 'realistic'

export interface Notice {
  tone: 'error' | 'warning' | 'info'
  title: string
  lines: { field?: string; text: string }[]
  /** Label of the way out; the notice always offers one. */
  action: string
}

// Raw recipe as loaded or edited (before schema defaults).
export type RawRecipe = Record<string, unknown>

/** Where the current recipe came from, when it came from a concept: for the time-to-model measure. */
/** Hebrew counts the singular differently: "סבב תיקון אחד", "2 סבבי תיקון". */
const repairLabel = (n: number) => (n <= 0 ? '' : n === 1 ? ', אחרי סבב תיקון אחד' : `, אחרי ${n} סבבי תיקון`)

export interface ConceptOrigin {
  concept: string
  startedAt: number
  attempts: number
  warnings: string[]
  /** Set once the first model of this recipe is on screen. */
  totalMs?: number
}

interface StudioState {
  recipe: RawRecipe | null
  sourceName: string
  /** The recipe that produced `result`: the last valid state. */
  validRecipe: RawRecipe | null
  result: BuildSuccess | null
  /** Increments with every new result, for tests and for the scene. */
  modelVersion: number
  building: boolean
  notice: Notice | null
  level: Level
  camera: CameraPreset
  cameraNonce: number
  showEdges: boolean
  showPeople: boolean
  tracing: boolean
  traceStatus: string | null
  origin: ConceptOrigin | null
  sectionOn: boolean
  sectionT: number
  /** The project and the saved version the current recipe continues from. */
  project: ProjectRef | null
  versionId: string | null
  /** The recipe changed since it was opened or saved. */
  dirty: boolean
  /** A saved camera, applied once when the model is on screen. */
  pendingView: View | null
  /** The recipe as it arrived: its ideal, balanced state. "איפוס" returns to it. */
  baseline: RawRecipe | null
  save: SaveState
  /** While a clip is drawn: what is happening, shown on the model window, which takes no input meanwhile. */
  recording: string | null
  /** The clip being drawn, 0–100, for the path's timeline marker; null when no clip is being made. */
  clipProgress: number | null

  loadRecipe(raw: unknown, sourceName: string, origin?: ConceptOrigin, from?: { project: ProjectRef | null; versionId: string | null; view: View | null; dirty?: boolean; baseline?: RawRecipe | null }): void
  setParam(path: string, value: unknown): void
  /** Several fields in one step and one build, e.g. switching to shell together with a wall thickness. */
  setParams(entries: [path: string, value: unknown][]): void
  dismissNotice(): void
  setCamera(c: CameraPreset): void
  /** Back to the baseline: the shape (generator and bare), the scene (realistic), or both. */
  reset(part: 'shape' | 'scene' | 'all'): void
  set<K extends keyof StudioState>(key: K, value: StudioState[K]): void
}

export interface ProjectRef {
  id: string
  concept: string
  title_he: string
}

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'queued'; at: number }
  | { status: 'failed'; message: string }

let seq = 0

const schemaNotice = (errors: SchemaError[], title: string): Notice => ({
  tone: 'error',
  title,
  lines: errors.slice(0, 8).map((e) => ({ field: e.path || '(root)', text: e.message })),
  action: 'בחירת קובץ אחר',
})

export const useStudio = create<StudioState>((set, get) => {
  function requestBuild(recipe: RawRecipe) {
    const mine = ++seq
    set({ building: true })
    engine.build(recipe).then(
      (outcome) => {
        if (outcome.status === 'superseded') return
        const r = outcome.result
        const latest = mine === seq
        if (r.ok) {
          set((s) => ({ result: r, validRecipe: recipe, modelVersion: s.modelVersion + 1 }))
          const origin = get().origin
          if (origin && origin.totalMs === undefined) {
            const totalMs = performance.now() - origin.startedAt
            set({
              origin: { ...origin, totalMs },
              notice: {
                tone: 'info',
                title: `המודל נבנה מהמושג "${origin.concept}" תוך ${Math.round(totalMs / 1000)} שניות${repairLabel(origin.attempts - 1)}`,
                lines: origin.warnings.map((text) => ({ text })),
                action: 'הבנתי',
              },
            })
          }
        } else if (latest) {
          // The slider returns to the last valid value (PRODUCT.md, "גאומטריה לא תקפה").
          const errors = r.issues.filter((i) => i.severity === 'error')
          // Realistic fields edited meanwhile are kept: only geometry goes back.
          const current = get().recipe
          const valid = get().validRecipe
          set({
            recipe: valid && current ? { ...valid, realistic: current.realistic } : valid,
            notice:
              r.stage === 'schema'
                ? schemaNotice(r.schemaErrors, 'המתכון לא עומד בסכמה')
                : {
                    tone: 'error',
                    title: 'הערך האחרון לא נבנה, והמודל חזר לערך התקין האחרון',
                    lines: errors.map((i) => ({ text: `כלל ${i.rule}: ${i.message}` })),
                    action: 'הבנתי',
                  },
          })
        }
        if (latest) set({ building: false })
      },
      (e: unknown) => {
        if (mine === seq) {
          set({
            building: false,
            notice: { tone: 'error', title: 'שגיאה במנוע הגאומטריה', lines: [{ text: String(e) }], action: 'הבנתי' },
          })
        }
      },
    )
  }

  return {
    recipe: null,
    sourceName: '',
    validRecipe: null,
    result: null,
    modelVersion: 0,
    building: false,
    notice: null,
    level: 'bare',
    camera: 'eye_level_oblique',
    cameraNonce: 0,
    showEdges: true,
    showPeople: true,
    tracing: false,
    traceStatus: null,
    origin: null,
    sectionOn: false,
    sectionT: 0.05,
    project: null,
    versionId: null,
    dirty: false,
    pendingView: null,
    baseline: null,
    save: { status: 'idle' },
    recording: null,
    clipProgress: null,

    loadRecipe(raw, sourceName, origin, from) {
      const p = parseRecipe(raw)
      if (!p.ok) {
        // The current model stays; the user sees which field failed and why.
        set({ notice: schemaNotice(p.errors, `הקובץ "${sourceName}" לא עומד בסכמה של המתכון`) })
        return
      }
      set({
        recipe: raw as RawRecipe,
        sourceName,
        notice: null,
        tracing: false,
        traceStatus: null,
        origin: origin ?? null,
        cameraNonce: get().cameraNonce + 1,
        project: from?.project ?? null,
        versionId: from?.versionId ?? null,
        // A recipe that did not come from a saved version has not been saved yet.
        dirty: from?.dirty ?? !from?.versionId,
        pendingView: from?.view ?? null,
        baseline: structuredClone(from?.baseline ?? raw) as RawRecipe,
        save: { status: 'idle' },
        ...(from?.view ? { level: from.view.level, camera: from.view.camera.preset } : {}),
      })
      requestBuild(raw as RawRecipe)
    },

    setParam(path, value) {
      get().setParams([[path, value]])
    },

    setParams(entries) {
      const r = get().recipe
      if (!r) return
      const next = entries.reduce((acc, [path, value]) => setAt(acc, path, value), r)
      const geometry = entries.some(([path]) => changesGeometry(path))
      const valid = get().validRecipe
      set({
        recipe: next,
        // A realistic change is valid as soon as the schema accepts it, so the built recipe takes it too.
        validRecipe: !geometry && valid ? { ...valid, realistic: next.realistic } : valid,
        dirty: true,
        notice: get().notice?.tone === 'error' ? null : get().notice,
      })
      if (geometry) requestBuild(next)
    },

    dismissNotice() {
      set({ notice: null })
    },

    reset(part) {
      const base = get().baseline
      if (!base) return
      const keys = part === 'shape' ? ['generator', 'bare'] : part === 'scene' ? ['realistic'] : ['generator', 'bare', 'realistic']
      get().setParams(keys.map((k) => [k, structuredClone(base[k])]))
      set({ notice: null, tracing: false })
    },

    setCamera(c) {
      set({ camera: c, cameraNonce: get().cameraNonce + 1 })
    },

    set(key, value) {
      set({ [key]: value } as Partial<StudioState>)
    },
  }
})
