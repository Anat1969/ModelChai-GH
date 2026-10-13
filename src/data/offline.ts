/**
 * Local draft and offline queue (ARCHITECTURE.md 4): an unsaved recipe lives in localStorage, and a save that
 * could not reach the server waits there until the connection returns. Storage can be missing or full
 * (private windows, quotas), so every access is guarded and the app works without it.
 */
import type { RawRecipe } from '../ui/store'
import { DataError, saveVersion, type SaveInput, type View } from './projects'

const DRAFT_KEY = 'mathcreator-draft'
const QUEUE_KEY = 'mathcreator-pending'

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key)
    return s ? (JSON.parse(s) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export interface Draft {
  recipe: RawRecipe
  sourceName: string
  project: SaveInput['project'] | null
  versionId: string | null
  view: View | null
  /** ms since epoch */
  at: number
}

export const loadDraft = () => read<Draft>(DRAFT_KEY)
export const saveDraft = (d: Draft) => write(DRAFT_KEY, d)
export const clearDraft = () => write(DRAFT_KEY, null)

export const pendingSaves = () => read<SaveInput[]>(QUEUE_KEY) ?? []

export type SaveOutcome = { status: 'saved' } | { status: 'queued' } | { status: 'failed'; message: string }

/**
 * Saves now, or queues the save when the server cannot be reached. A queued save keeps its snapshot when
 * there is room for it, and drops only the image when storage is full.
 */
export async function saveOrQueue(input: SaveInput): Promise<SaveOutcome> {
  try {
    await saveVersion(input)
    return { status: 'saved' }
  } catch (e) {
    if (e instanceof DataError && e.offline) {
      const queue = pendingSaves().filter((q) => q.versionId !== input.versionId)
      if (write(QUEUE_KEY, [...queue, input]) || write(QUEUE_KEY, [...queue, { ...input, snapshot: null }])) return { status: 'queued' }
      return { status: 'failed', message: 'אין חיבור לשרת, וגם אין מקום לשמור את הגרסה במכשיר.' }
    }
    return { status: 'failed', message: e instanceof Error ? e.message : String(e) }
  }
}

export interface FlushResult {
  sent: number
  /** Saves the server refused, with its reason. They leave the queue so later ones can pass. */
  rejected: { note: string | null; message: string }[]
}

let flushing: Promise<FlushResult> | null = null

/** Sends queued saves in order. Stops at the first one that still cannot reach the server. */
export function flushPending(): Promise<FlushResult> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    const rejected: FlushResult['rejected'] = []
    for (const item of pendingSaves()) {
      try {
        await saveVersion(item)
        write(
          QUEUE_KEY,
          pendingSaves().filter((q) => q.versionId !== item.versionId),
        )
        sent++
      } catch (e) {
        if (e instanceof DataError && e.offline) break
        rejected.push({ note: item.note, message: e instanceof Error ? e.message : String(e) })
        write(
          QUEUE_KEY,
          pendingSaves().filter((q) => q.versionId !== item.versionId),
        )
      }
    }
    return { sent, rejected }
  })().finally(() => (flushing = null))
  return flushing
}
