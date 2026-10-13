/**
 * Studio state. The recipe is the only source of truth; the model on screen is the last successful build and
 * stays there until a newer one is ready, so the viewport is never empty.
 */
import { create } from 'zustand'
import type { BuildSuccess } from '../engine/build'
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
  sectionOn: boolean
  sectionT: number

  loadRecipe(raw: unknown, sourceName: string): void
  setParam(path: string, value: unknown): void
  /** Several fields in one step and one build, e.g. switching to shell together with a wall thickness. */
  setParams(entries: [path: string, value: unknown][]): void
  dismissNotice(): void
  setCamera(c: CameraPreset): void
  set<K extends keyof StudioState>(key: K, value: StudioState[K]): void
}

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
        } else if (latest) {
          // The slider returns to the last valid value (PRODUCT.md, "גאומטריה לא תקפה").
          const errors = r.issues.filter((i) => i.severity === 'error')
          set({
            recipe: get().validRecipe,
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
    sectionOn: false,
    sectionT: 0.05,

    loadRecipe(raw, sourceName) {
      const p = parseRecipe(raw)
      if (!p.ok) {
        // The current model stays; the user sees which field failed and why.
        set({ notice: schemaNotice(p.errors, `הקובץ "${sourceName}" לא עומד בסכמה של המתכון`) })
        return
      }
      set({ recipe: raw as RawRecipe, sourceName, notice: null, tracing: false, traceStatus: null, cameraNonce: get().cameraNonce + 1 })
      requestBuild(raw as RawRecipe)
    },

    setParam(path, value) {
      get().setParams([[path, value]])
    },

    setParams(entries) {
      const r = get().recipe
      if (!r) return
      const next = entries.reduce((acc, [path, value]) => setAt(acc, path, value), r)
      set({ recipe: next, notice: get().notice?.tone === 'error' ? null : get().notice })
      if (entries.some(([path]) => changesGeometry(path))) requestBuild(next)
    },

    dismissNotice() {
      set({ notice: null })
    },

    setCamera(c) {
      set({ camera: c, cameraNonce: get().cameraNonce + 1 })
    },

    set(key, value) {
      set({ [key]: value } as Partial<StudioState>)
    },
  }
})
