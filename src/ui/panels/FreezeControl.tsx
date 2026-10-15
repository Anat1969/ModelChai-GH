/**
 * "הקפאת מבט": the view on screen becomes a 3600 × 2400 image on its step of the collection, with the camera
 * that made it. A view belongs to a saved version, so an unsaved model is saved first (DECISIONS.md 86).
 * Without a connection the image still reaches the device.
 */
import { useState } from 'react'
import { capture, frameName, STILL, STILL_QUALITY, STILL_TYPE, type Frame } from '../../capture/frame'
import { addItem, stageOfView } from '../../data/collection'
import { download } from '../download'
import { navigate } from '../router'
import { anchorVersion, currentView } from '../saveCurrent'
import { useStudio } from '../store'

type State =
  | { status: 'idle' }
  | { status: 'busy'; step: string }
  | { status: 'done'; frame: Frame; name: string; projectId: string; savedVersion: boolean; stage: string }
  | { status: 'local'; frame: Frame; message: string }
  | { status: 'failed'; message: string }

const STAGE_LABEL: Record<string, string> = { bare: 'ערום', realistic: 'ריאליסטי' }

export function FreezeControl() {
  const ready = useStudio((s) => !!s.result && !s.building)
  const [state, setState] = useState<State>({ status: 'idle' })

  const freeze = async () => {
    const render = capture.render
    if (!render) return setState({ status: 'failed', message: 'חלון המודל עדיין לא מוכן. אפשר לנסות שוב בעוד רגע.' })
    setState({ status: 'busy', step: 'מקפיא את המבט' })
    // The view first, before anything can move the camera; then one painted frame, so the button shows it is
    // working before the large draw holds the page.
    const view = currentView()
    await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))
    let frame: Frame
    try {
      frame = await render({ ...STILL, type: STILL_TYPE, quality: STILL_QUALITY })
    } catch (e) {
      return setState({ status: 'failed', message: `הצילום נכשל: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.` })
    }
    const recipeId = ((useStudio.getState().validRecipe?.meta as { id?: string } | undefined)?.id ?? 'model').replace(/[^a-z0-9-]/g, '')
    const name = frameName(recipeId, view.level, new Date(), 'jpg')
    const local = (message: string) => {
      download(frame.blob, STILL_TYPE, name)
      setState({ status: 'local', frame, message })
    }

    setState({ status: 'busy', step: 'שומר את הגרסה של המבט' })
    const anchor = await anchorVersion('נשמרה עם הקפאת מבט')
    if (!anchor.ok) return local(`${anchor.message} התמונה ירדה למכשיר.`)
    setState({ status: 'busy', step: 'מעלה לקולקציה' })
    try {
      await addItem({ kind: 'still', projectId: anchor.projectId, versionId: anchor.versionId, stage: stageOfView(view), view, blob: frame.blob, ext: 'jpg' })
      setState({ status: 'done', frame, name, projectId: anchor.projectId, savedVersion: anchor.savedVersion, stage: STAGE_LABEL[view.level] ?? view.level })
    } catch (e) {
      local(`${e instanceof Error ? e.message : String(e)} התמונה ירדה למכשיר.`)
    }
  }

  const busy = state.status === 'busy'
  return (
    <div className="freeze" data-testid="freeze" data-status={state.status}>
      <button type="button" className="primary" onClick={freeze} disabled={!ready || busy} data-testid="freeze-view" title="שומר את המבט שעל המסך כתמונה של 3600 על 2400, בשלב שלו בקולקציה">
        {busy ? state.step : 'הקפאת מבט'}
      </button>
      {state.status !== 'idle' && !busy && (
        <p className="freeze-status" role="status" data-testid="freeze-status">
          {state.status === 'done' && (
            <>
              המבט נשמר בקולקציה, בשלב {state.stage}, ‏{state.frame.width} × {state.frame.height}.{state.savedVersion ? ' נשמרה גם גרסה, כי המבט שייך לצורה שעל המסך.' : ''}{' '}
              <button type="button" onClick={() => download(state.frame.blob, STILL_TYPE, state.name)} data-testid="freeze-download">
                הורדה
              </button>{' '}
              <button type="button" onClick={() => navigate('collection', { p: state.projectId })} data-testid="open-collection">
                לקולקציה
              </button>
            </>
          )}
          {state.status === 'local' && state.message}
          {state.status === 'failed' && state.message}
        </p>
      )}
    </div>
  )
}
