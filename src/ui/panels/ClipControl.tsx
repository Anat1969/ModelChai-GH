/**
 * "סרטון": four seconds in which the camera turns 90° and the model passes from bare to realistic
 * (DECISIONS.md 88). Every frame is drawn and encoded in turn, so none is dropped. The bare frames of the blend
 * are kept as JPEG between the two passes, and the level switches once, without a new build.
 */
import { useRef, useState } from 'react'
import { angleAt, CLIP, FRAMES, mixAt, needsBare, needsRealistic, orbit } from '../../capture/clip'
import { createEncoder } from '../../capture/encode'
import { paint, settle } from '../../capture/settle'
import { capture, frameName } from '../../capture/frame'
import { addItem } from '../../data/collection'
import { cameraControl } from '../../scene/BareScene'
import { download } from '../download'
import { navigate } from '../router'
import { anchorVersion } from '../saveCurrent'
import { useStudio } from '../store'
import { PathStatus } from './pathSlot'

type State =
  | { status: 'idle'; message?: string }
  | { status: 'busy'; progress: number; step: string }
  | { status: 'done'; blob: Blob; name: string; projectId: string | null; message: string }
  | { status: 'failed'; message: string }

class Cancelled extends Error {}


export function ClipControl() {
  const ready = useStudio((s) => !!s.result && !s.building && !s.recording)
  const [state, setState] = useState<State>({ status: 'idle' })
  const cancel = useRef(false)

  const make = async () => {
    const session = capture.session
    const start = cameraControl.get?.()
    if (!session || !start) return setState({ status: 'failed', message: 'חלון המודל עדיין לא מוכן. אפשר לנסות שוב בעוד רגע.' })
    cancel.current = false
    setState({ status: 'busy', progress: 0, step: 'מכין' })
    const encoder = await createEncoder()
    if (!encoder) return setState({ status: 'failed', message: 'הדפדפן הזה לא יודע לקודד וידאו. ב-Chrome או ב-Edge עדכניים זה עובד.' })

    const st = useStudio.getState()
    const levelBefore = st.level
    const preset = st.camera
    const total = [...Array(FRAMES).keys()].filter(needsBare).length + [...Array(FRAMES).keys()].filter(needsRealistic).length
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
      if (cancel.current) throw new Cancelled()
    }
    const bare = new Map<number, Blob>()
    const comp = document.createElement('canvas')
    comp.width = CLIP.width
    comp.height = CLIP.height
    const g = comp.getContext('2d')!

    try {
      useStudio.setState({ recording: 'מצלם סרטון, 0%', clipProgress: 0 })
      // First pass: the bare level. Frames before the blend go straight to the encoder.
      if (useStudio.getState().level !== 'bare') useStudio.getState().set('level', 'bare')
      await settle()
      await session(CLIP, async (draw) => {
        for (let f = 0; f < FRAMES; f++) {
          if (!needsBare(f)) continue
          check()
          const c = draw(orbit(start, angleAt(f)))
          if (needsRealistic(f)) bare.set(f, (await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.95)))!)
          else await encoder.add(c, f)
          tick('ערום')
          if (f % 6 === 0) await paint()
        }
      })
      // Second pass: the realistic level, blended over the kept bare frames.
      useStudio.getState().set('level', 'realistic')
      await settle()
      await session(CLIP, async (draw) => {
        for (let f = 0; f < FRAMES; f++) {
          if (!needsRealistic(f)) continue
          check()
          const c = draw(orbit(start, angleAt(f)))
          const kept = bare.get(f)
          if (kept) {
            const bmp = await createImageBitmap(kept)
            g.globalAlpha = 1
            g.drawImage(bmp, 0, 0, CLIP.width, CLIP.height)
            bmp.close()
            g.globalAlpha = mixAt(f)
            g.drawImage(c, 0, 0, CLIP.width, CLIP.height)
            await encoder.add(comp, f)
          } else await encoder.add(c, f)
          tick('ריאליסטי')
          if (f % 6 === 0) await paint()
        }
      })
      setState({ status: 'busy', progress: 100, step: 'מסיים את הקובץ' })
      const blob = await encoder.finish()
      const id = ((useStudio.getState().validRecipe?.meta as { id?: string } | undefined)?.id ?? 'model').replace(/[^a-z0-9-]/g, '')
      const name = frameName(id, 'clip', new Date(), 'mp4')
      restore()

      setState({ status: 'busy', progress: 100, step: 'שומר בקולקציה' })
      const anchor = await anchorVersion('נשמרה עם סרטון')
      if (!anchor.ok) {
        download(blob, 'video/mp4', name)
        return setState({ status: 'done', blob, name, projectId: null, message: `${anchor.message} הסרטון ירד למכשיר.` })
      }
      try {
        await addItem({ kind: 'clip', projectId: anchor.projectId, versionId: anchor.versionId, stage: 'realistic', view: { level: 'realistic', camera: { preset, ...start } }, blob, ext: 'mp4' })
        setState({ status: 'done', blob, name, projectId: anchor.projectId, message: `הסרטון נשמר בקולקציה: ${CLIP.seconds} שניות, ${FRAMES} תמונות, ${(blob.size / 1e6).toLocaleString('he-IL', { maximumFractionDigits: 1 })} מגה-בייט.` })
      } catch (e) {
        download(blob, 'video/mp4', name)
        setState({ status: 'done', blob, name, projectId: null, message: `${e instanceof Error ? e.message : String(e)} הסרטון ירד למכשיר.` })
      }
    } catch (e) {
      encoder.close()
      restore()
      setState(e instanceof Cancelled ? { status: 'idle', message: 'הסרטון בוטל.' } : { status: 'failed', message: `הסרטון נכשל: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.` })
    }

    function restore() {
      useStudio.setState({ recording: null, clipProgress: null })
      useStudio.getState().set('level', levelBefore)
      cameraControl.set?.(start!)
    }
  }

  const busy = state.status === 'busy'
  return (
    <div className="step-control clip-step" data-testid="clip" data-status={state.status}>
      <div className="clip-buttons">
        <button type="button" onClick={make} disabled={!ready || busy} data-testid="make-clip" title="ארבע שניות: המצלמה מסתובבת 90 מעלות, והמודל עובר מערום לריאליסטי">
          <span className="step-num">04</span> {busy ? `${state.step}, ${state.progress}%` : 'סרטון'}
        </button>
        {busy && (
          <button type="button" onClick={() => (cancel.current = true)} data-testid="cancel-clip">
            ביטול
          </button>
        )}
      </div>
      {!busy && 'message' in state && state.message && (
        <PathStatus>
          <p className="path-message" role="status" data-testid="clip-status">
            {state.message}{' '}
            {state.status === 'done' && (
              <>
                <button type="button" onClick={() => download(state.blob, 'video/mp4', state.name)} data-testid="clip-download">
                  הורדה
                </button>{' '}
                {state.projectId && (
                  <button type="button" onClick={() => navigate('collection', { p: state.projectId! })}>
                    לקולקציה
                  </button>
                )}
              </>
            )}
          </p>
        </PathStatus>
      )}
    </div>
  )
}
