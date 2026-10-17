/**
 * Saves what is on screen as a new version (PRODUCT.md "מודל נתונים"): the full recipe, a short note, the view,
 * a 3:2 snapshot and the visual prompt. Used by the save panel, and by a frozen view whose model is not saved yet.
 * Assumes a signed-in session.
 */
import { clearDraft, saveOrQueue, type SaveOutcome } from '../data/offline'
import { ensureSession } from '../data/supabase'
import type { SaveInput, View } from '../data/projects'
import { visualPrompt } from '../prompt/visualPrompt'
import { parseRecipe } from '../recipe/schema'
import { cameraControl } from '../scene/BareScene'
import { viewport } from '../scene/Viewport'
import { useStudio } from './store'

/** The window's 3:2 frame, at a size that keeps a PNG well under the 2 MB bucket limit. */
const SNAPSHOT_W = 1200
const SNAPSHOT_H = 800

/**
 * The model window as a 3:2 PNG data URL, scaled down for storage. Read asynchronously (toBlob, then an
 * ImageBitmap): a synchronous drawImage of a WebGL canvas waits for the GPU and freezes the page meanwhile.
 */
async function snapshot(): Promise<string | null> {
  const src = viewport.canvas
  if (!src) return null
  const blob = await new Promise<Blob | null>((res) => src.toBlob(res, 'image/png'))
  if (!blob) return null
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = SNAPSHOT_W
  c.height = SNAPSHOT_H
  const g = c.getContext('2d')
  if (!g) return null
  // Crop to 3:2 from the center, in case the canvas is a pixel off.
  const w = Math.min(bmp.width, (bmp.height * 3) / 2), h = (w * 2) / 3
  g.drawImage(bmp, (bmp.width - w) / 2, (bmp.height - h) / 2, w, h, 0, 0, SNAPSHOT_W, SNAPSHOT_H)
  bmp.close()
  return c.toDataURL('image/png')
}

/** The view on screen now: level, camera preset and the exact pose. */
export function currentView(): View {
  const st = useStudio.getState()
  const pose = cameraControl.get?.() ?? { position: [0, 0, 0] as View['camera']['position'], target: [0, 0, 0] as View['camera']['target'] }
  return { level: st.level, camera: { preset: st.camera, ...pose } }
}

export async function saveCurrent(note: string | null): Promise<SaveOutcome | { status: 'no-recipe' }> {
  const st = useStudio.getState()
  const recipe = st.validRecipe
  if (!recipe) return { status: 'no-recipe' }
  useStudio.setState({ save: { status: 'saving' } })

  const parsed = parseRecipe(recipe)
  const r = parsed.ok ? parsed.recipe : null
  const nextProject = st.project ?? {
    id: crypto.randomUUID(),
    concept: st.origin?.concept ?? r?.concept.name_he ?? st.sourceName,
    title_he: r?.narrative.name_he ?? r?.concept.name_he ?? 'פרויקט',
  }
  const input: SaveInput = {
    project: nextProject,
    versionId: crypto.randomUUID(),
    parentId: st.versionId,
    recipe,
    view: currentView(),
    note: note?.trim() || null,
    snapshot: await snapshot().catch(() => null),
    visualPrompt: r && r.generator.type === 'sweep' ? visualPrompt(r as never).prompt : null,
  }
  const out = await saveOrQueue(input)
  if (out.status === 'failed') {
    useStudio.setState({ save: { status: 'failed', message: out.message } })
    return out
  }
  useStudio.setState({
    project: nextProject,
    versionId: input.versionId,
    dirty: false,
    save: out.status === 'saved' ? { status: 'saved', at: Date.now() } : { status: 'queued', at: Date.now() },
  })
  // The address now names the saved version, so a reload reopens it.
  history.replaceState(null, '', `#/studio?v=${input.versionId}`)
  clearDraft()
  return out
}

export type Anchor =
  | { ok: true; projectId: string; versionId: string; savedVersion: boolean }
  | { ok: false; message: string }

/**
 * The saved version that something made from the screen belongs to (DECISIONS.md 86): the open one, or a new
 * one when the model was never saved or has changed since.
 */
export async function anchorVersion(note: string): Promise<Anchor> {
  const session = await ensureSession()
  if (session.status !== 'signed-in') return { ok: false, message: 'אין חיבור לחשבון.' }
  const st = useStudio.getState()
  const savedVersion = !st.versionId || st.dirty
  if (savedVersion) {
    const out = await saveCurrent(note)
    if (out.status === 'queued') return { ok: false, message: 'אין חיבור לשרת. הגרסה תישלח כשהחיבור יחזור.' }
    if (out.status !== 'saved') return { ok: false, message: `שמירת הגרסה נכשלה${'message' in out ? `: ${out.message}` : ''}.` }
  }
  const cur = useStudio.getState()
  return { ok: true, projectId: cur.project!.id, versionId: cur.versionId!, savedVersion }
}

/**
 * The first version of a project that started on the work path (DECISIONS.md 97): saved as soon as the engine
 * has built the recipe once, so the project holds its recipe without waiting for a manual save.
 */
export async function saveWhenBuilt(note: string, timeoutMs = 60000): Promise<boolean> {
  const t0 = Date.now()
  while (!useStudio.getState().validRecipe) {
    if (Date.now() - t0 > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 200))
  }
  // One frame on screen, so the version keeps a picture.
  await new Promise((r) => setTimeout(r, 400))
  const out = await saveCurrent(note)
  return out.status === 'saved' || out.status === 'queued'
}
