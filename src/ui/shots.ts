/**
 * The views chosen for the clip (DECISIONS.md 116), kept per project on this device: the plan under
 * `mathcreator-shots:<project id or draft>` as small JSON, and the thumbnails apart under
 * `mathcreator-shot-thumbs:<…>`. The plan of a saved project also goes to the server (DECISIONS.md 128), and a
 * device that has none takes it from there.
 */
import { create } from 'zustand'
import { loadShots, saveShots } from '../data/shots'
import { EMPTY_PLAN, parsePlan, serializePlan, shotsKey, shotsReducer, thumbsKey, type ShotAction, type ShotPlan } from '../capture/shots'

interface ShotsState extends ShotPlan {
  /** The project the list belongs to; null for a model not saved yet. */
  projectId: string | null
  thumbs: Record<string, string>
  dispatch(action: ShotAction): void
  setThumb(id: string, dataUrl: string): void
  /** Switch to another project's list. A draft's views move to the project it is first saved as. */
  switchProject(projectId: string | null): void
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage full or blocked: the list still works for this visit.
  }
}
const readThumbs = (projectId: string | null): Record<string, string> => {
  try {
    const o = JSON.parse(read(thumbsKey(projectId)) ?? '{}') as unknown
    return o && typeof o === 'object' ? (o as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** The views saved for a project, as small JSON-ready data; null when none were saved. */
export function getShots(projectId: string | null): ShotPlan | null {
  return parsePlan(read(shotsKey(projectId)))
}

let upload: ReturnType<typeof setTimeout> | null = null
/** Sends the plan a moment after the last change; a failure leaves the device copy, sent with the next change. */
function send(s: ShotsState) {
  if (!s.projectId) return
  const id = s.projectId
  const plan = { shots: s.shots, levels: s.levels }
  if (upload) clearTimeout(upload)
  upload = setTimeout(() => void saveShots(id, plan).catch(() => {}), 800)
}

function persist(s: ShotsState, toServer = true) {
  if (toServer) send(s)
  write(shotsKey(s.projectId), s.shots.length || s.levels !== EMPTY_PLAN.levels ? serializePlan(s) : null)
  const kept = Object.fromEntries(s.shots.filter((x) => s.thumbs[x.id]).map((x) => [x.id, s.thumbs[x.id]!]))
  write(thumbsKey(s.projectId), Object.keys(kept).length ? JSON.stringify(kept) : null)
}

export const useShots = create<ShotsState>((set, get) => ({
  ...(getShots(null) ?? EMPTY_PLAN),
  projectId: null,
  thumbs: readThumbs(null),
  dispatch(action) {
    const cur = get()
    const next = shotsReducer({ shots: cur.shots, levels: cur.levels }, action)
    set(next)
    persist(get())
  },
  setThumb(id, dataUrl) {
    set({ thumbs: { ...get().thumbs, [id]: dataUrl } })
    persist(get())
  },
  switchProject(projectId) {
    const cur = get()
    if (cur.projectId === projectId) return
    let plan = getShots(projectId)
    let thumbs = readThumbs(projectId)
    // The model was just saved for the first time: its views come along.
    if (!plan && cur.projectId === null && cur.shots.length) {
      plan = { shots: cur.shots, levels: cur.levels }
      thumbs = cur.thumbs
      write(shotsKey(null), null)
      write(thumbsKey(null), null)
    }
    set({ ...(plan ?? EMPTY_PLAN), projectId, thumbs })
    persist(get(), !!plan)
    // Nothing on this device: the views chosen on another one.
    if (!plan && projectId)
      void loadShots(projectId).then((remote) => {
        const now = get()
        if (!remote || now.projectId !== projectId || now.shots.length) return
        set({ ...remote })
        persist(get(), false)
      })
  },
}))
