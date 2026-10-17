/**
 * Making the clip and previewing it (DECISIONS.md 88, 116–118). One runner for the path bar's step 04 and the
 * "סרטון" side tab, so both show the same progress and either can cancel.
 *
 * The clip: every frame is drawn and encoded in turn, so none is dropped. Bare frames inside the blend are
 * kept as JPEG between the two passes, and the level switches once, without a new build.
 * The preview: the same path, live in the window at real time; the level switches at the middle of the blend.
 */
import { create } from 'zustand'
import { CLIP, cameraTime, framesFor, mixAt, mixAtFrame, needsBare, needsRealistic } from '../capture/clip'
import { createEncoder } from '../capture/encode'
import { capture, frameName } from '../capture/frame'
import { buildPath, type Pose } from '../capture/path'
import { paint, settle } from '../capture/settle'
import { planKeys, planSeconds, SECONDS, type Shot } from '../capture/shots'
import { addItem } from '../data/collection'
import { cameraControl } from '../scene/BareScene'
import { download } from './download'
import { num } from './format'
import { anchorVersion } from './saveCurrent'
import { useShots } from './shots'
import { useStudio } from './store'

export type ClipState =
  | { status: 'idle'; message?: string }
  | { status: 'busy'; progress: number; step: string }
  | { status: 'previewing' }
  | { status: 'done'; blob: Blob; name: string; projectId: string | null; message: string }
  | { status: 'failed'; message: string }

export const useClip = create<{ state: ClipState }>(() => ({ state: { status: 'idle' } }))
const setState = (state: ClipState) => useClip.setState({ state })

class Cancelled extends Error {}
let cancel = false

/** The camera keys and level plan the clip follows now. */
export function currentPlan() {
  const s = useShots.getState()
  const keys = planKeys(s, cameraControl.get?.() ?? null)
  return { keys, levels: s.levels, seconds: planSeconds(keys), chosen: s.shots.length }
}

export function cancelClip() {
  cancel = true
}

export async function makeClip() {
  const session = capture.session
  const plan = currentPlan()
  if (!session || !plan.keys.length) return setState({ status: 'failed', message: 'חלון המודל עדיין לא מוכן. אפשר לנסות שוב בעוד רגע.' })
  if (plan.seconds <= 0) return setState({ status: 'failed', message: 'אורך הסרטון אפס שניות. אפשר לתת לאחד המבטים משך של שנייה או יותר.' })
  stopPreview()
  cancel = false
  setState({ status: 'busy', progress: 0, step: 'מכין' })
  const encoder = await createEncoder()
  if (!encoder) return setState({ status: 'failed', message: 'הדפדפן הזה לא יודע לקודד וידאו. ב-Chrome או ב-Edge עדכניים זה עובד.' })

  const st = useStudio.getState()
  const levelBefore = st.level
  const preset = st.camera
  const before = cameraControl.get?.() ?? null
  const path = buildPath(plan.keys)
  const lv = plan.levels
  const FRAMES = framesFor(plan.seconds)
  const poseAt = (f: number) => path.at(cameraTime(f, FRAMES, path.duration))
  const frames = [...Array(FRAMES).keys()]
  const total = frames.filter((f) => needsBare(f, lv)).length + frames.filter((f) => needsRealistic(f, lv)).length
  let done = 0
  const tick = (step: string) => {
    done++
    // Every few frames: each update re-renders the window around the canvas.
    if (done % 6 && done !== total) return
    const progress = Math.round((100 * done) / total)
    useStudio.setState({ recording: `מצלם סרטון, ${progress}%`, clipProgress: progress })
    setState({ status: 'busy', progress, step })
  }
  const check = () => {
    if (cancel) throw new Cancelled()
  }
  const bare = new Map<number, Blob>()
  const comp = document.createElement('canvas')
  comp.width = CLIP.width
  comp.height = CLIP.height
  const g = comp.getContext('2d')!
  const restore = () => {
    useStudio.setState({ recording: null, clipProgress: null })
    useStudio.getState().set('level', levelBefore)
    if (before) cameraControl.set?.(before)
  }

  try {
    useStudio.setState({ recording: 'מצלם סרטון, 0%', clipProgress: 0 })
    // First pass: the bare level. Frames before the blend go straight to the encoder.
    if (frames.some((f) => needsBare(f, lv))) {
      if (useStudio.getState().level !== 'bare') useStudio.getState().set('level', 'bare')
      await settle()
      await session(CLIP, async (draw) => {
        for (const f of frames) {
          if (!needsBare(f, lv)) continue
          check()
          const c = draw(poseAt(f))
          if (needsRealistic(f, lv)) bare.set(f, (await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.95)))!)
          else await encoder.add(c, f)
          tick('ערום')
          if (f % 6 === 0) await paint()
        }
      })
    }
    // Second pass: the realistic level, blended over the kept bare frames.
    if (frames.some((f) => needsRealistic(f, lv))) {
      useStudio.getState().set('level', 'realistic')
      await settle()
      await session(CLIP, async (draw) => {
        for (const f of frames) {
          if (!needsRealistic(f, lv)) continue
          check()
          const c = draw(poseAt(f))
          const kept = bare.get(f)
          if (kept) {
            const bmp = await createImageBitmap(kept)
            g.globalAlpha = 1
            g.drawImage(bmp, 0, 0, CLIP.width, CLIP.height)
            bmp.close()
            g.globalAlpha = mixAtFrame(f, lv)
            g.drawImage(c, 0, 0, CLIP.width, CLIP.height)
            await encoder.add(comp, f)
          } else await encoder.add(c, f)
          tick('ריאליסטי')
          if (f % 6 === 0) await paint()
        }
      })
    }
    setState({ status: 'busy', progress: 100, step: 'מסיים את הקובץ' })
    const blob = await encoder.finish()
    const id = ((useStudio.getState().validRecipe?.meta as { id?: string } | undefined)?.id ?? 'model').replace(/[^a-z0-9-]/g, '')
    const name = frameName(id, 'clip', new Date(), 'mp4')
    restore()

    const summary = `${num(plan.seconds, plan.seconds % 1 ? 1 : 0)} שניות, ${FRAMES} תמונות, ${(blob.size / 1e6).toLocaleString('he-IL', { maximumFractionDigits: 1 })} מגה-בייט`
    setState({ status: 'busy', progress: 100, step: 'שומר בקולקציה' })
    const anchor = await anchorVersion('נשמרה עם סרטון')
    if (!anchor.ok) {
      download(blob, 'video/mp4', name)
      return setState({ status: 'done', blob, name, projectId: null, message: `${anchor.message} הסרטון ירד למכשיר: ${summary}.` })
    }
    const first = plan.keys[0]!
    const endLevel = mixAt(plan.seconds, lv) >= 0.5 ? 'realistic' : 'bare'
    try {
      await addItem({ kind: 'clip', projectId: anchor.projectId, versionId: anchor.versionId, stage: endLevel, view: { level: endLevel, camera: { preset, position: first.position, target: first.target } }, blob, ext: 'mp4' })
      setState({ status: 'done', blob, name, projectId: anchor.projectId, message: `הסרטון נשמר בקולקציה: ${summary}.` })
    } catch (e) {
      download(blob, 'video/mp4', name)
      setState({ status: 'done', blob, name, projectId: null, message: `${e instanceof Error ? e.message : String(e)} הסרטון ירד למכשיר.` })
    }
  } catch (e) {
    encoder.close()
    restore()
    setState(e instanceof Cancelled ? { status: 'idle', message: 'הסרטון בוטל.' } : { status: 'failed', message: `הסרטון נכשל: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.` })
  }
}

// ---------- preview ----------

let previewFrame = 0
let previewRestore: (() => void) | null = null

/** Plays the path in the window at real time. A slow machine skips frames; the clock does not wait. */
export function startPreview() {
  const plan = currentPlan()
  const before = cameraControl.get?.()
  if (!plan.keys.length || !before || !cameraControl.set) return setState({ status: 'failed', message: 'חלון המודל עדיין לא מוכן. אפשר לנסות שוב בעוד רגע.' })
  if (plan.seconds <= 0) return setState({ status: 'failed', message: 'אורך הסרטון אפס שניות. אפשר לתת לאחד המבטים משך של שנייה או יותר.' })
  stopPreview()
  const path = buildPath(plan.keys)
  const levelBefore = useStudio.getState().level
  const t0 = performance.now()
  let lastLabel = ''
  previewRestore = () => {
    cancelAnimationFrame(previewFrame)
    previewRestore = null
    useStudio.setState({ recording: null, clipProgress: null })
    if (useStudio.getState().level !== levelBefore) useStudio.getState().set('level', levelBefore)
    cameraControl.set?.(before)
  }
  setState({ status: 'previewing' })
  const step = () => {
    const t = (performance.now() - t0) / 1000
    if (t > path.duration) return stopPreview('התצוגה המקדימה הסתיימה, והמצלמה חזרה למקומה.')
    cameraControl.set?.(path.at(t))
    const level = mixAt(t, plan.levels) >= 0.5 ? 'realistic' : 'bare'
    if (useStudio.getState().level !== level) useStudio.getState().set('level', level)
    const label = `תצוגה מקדימה, ${num(t, 1)} מתוך ${num(path.duration, 1)} שניות`
    useStudio.setState({ clipProgress: (100 * t) / path.duration, ...(label !== lastLabel ? { recording: label } : {}) })
    lastLabel = label
    previewFrame = requestAnimationFrame(step)
  }
  previewFrame = requestAnimationFrame(step)
}

export function stopPreview(message?: string) {
  if (!previewRestore) return
  previewRestore()
  setState({ status: 'idle', message })
}

// ---------- adding views ----------

const THUMB = { width: 150, height: 100 }

/** Small 3:2 pictures of poses, drawn in one session at the level on screen. */
async function thumbnails(poses: Pose[]): Promise<(string | null)[]> {
  const session = capture.session
  if (!session) return poses.map(() => null)
  const c = document.createElement('canvas')
  c.width = THUMB.width
  c.height = THUMB.height
  const g = c.getContext('2d')
  if (!g) return poses.map(() => null)
  return session(THUMB, async (draw) =>
    poses.map((p) => {
      g.drawImage(draw(p), 0, 0, THUMB.width, THUMB.height)
      return c.toDataURL('image/jpeg', 0.7)
    }),
  )
}

/** Adds views to the end of the list, with their thumbnails. */
export async function addShots(views: (Pose & { seconds?: number })[]) {
  const level = useStudio.getState().level
  const shots: Shot[] = views.map((v) => ({ id: crypto.randomUUID().slice(0, 8), position: v.position, target: v.target, level, seconds: v.seconds ?? SECONDS.initial }))
  useShots.getState().dispatch({ type: 'add', shots })
  const pics = await thumbnails(shots).catch(() => shots.map(() => null))
  pics.forEach((p, i) => p && useShots.getState().setThumb(shots[i]!.id, p))
}

/** "הוספת המבט הנוכחי": the camera as it is now. */
export function addCurrentShot() {
  const pose = cameraControl.get?.()
  if (!pose) return
  return addShots([pose])
}
