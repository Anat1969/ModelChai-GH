/**
 * Two steps of the path that keep one 3600 × 2400 image on the collection, with the camera that made it:
 * - "הקפאת מבט": the view on screen, at the level on screen (DECISIONS.md 84–86).
 * - "הדמיה": the same view drawn at the realistic level with deeper shadows and ambient occlusion
 *   (DECISIONS.md 91). The level switches for the draw and back, without a build.
 * A view belongs to a saved version, so an unsaved model is saved first. Without a connection the image still
 * reaches the device.
 */
import { useState } from 'react'
import { capture, frameName, STILL, STILL_QUALITY, STILL_TYPE, type Frame } from '../../capture/frame'
import { paint, settle } from '../../capture/settle'
import { addItem, stageOfView, type Stage } from '../../data/collection'
import { download } from '../download'
import { navigate } from '../router'
import { anchorVersion, currentView } from '../saveCurrent'
import { useStudio } from '../store'
import { PathStatus } from './pathSlot'

type State =
  | { status: 'idle' }
  | { status: 'busy'; step: string }
  | { status: 'done'; frame: Frame; name: string; projectId: string; savedVersion: boolean; stage: string }
  | { status: 'local'; frame: Frame; message: string }
  | { status: 'failed'; message: string }

const STAGE_LABEL: Record<string, string> = { bare: 'ערום', realistic: 'ריאליסטי', render: 'הדמיה' }

const MODES = {
  freeze: { label: 'הקפאת מבט', busy: 'מקפיא את המבט', note: 'נשמרה עם הקפאת מבט', what: 'המבט', title: 'שומר את המבט שעל המסך כתמונה של 3600 על 2400, בשלב שלו בקולקציה' },
  render: { label: 'הדמיה', busy: 'מרנדר הדמיה', note: 'נשמרה עם הדמיה', what: 'ההדמיה', title: 'רינדור מלא של המבט ברמה הריאליסטית: צל עמוק, חסימת אור והחלקת קצוות. 3600 על 2400' },
} as const

export function FreezeControl({ mode = 'freeze' }: { mode?: keyof typeof MODES }) {
  const m = MODES[mode]
  const id = mode === 'freeze' ? 'freeze' : 'render'
  const ready = useStudio((s) => !!s.result && !s.building && !s.recording)
  const [state, setState] = useState<State>({ status: 'idle' })

  const run = async () => {
    const draw = mode === 'freeze' ? capture.render : capture.beauty
    if (!draw) return setState({ status: 'failed', message: 'חלון המודל עדיין לא מוכן. אפשר לנסות שוב בעוד רגע.' })
    setState({ status: 'busy', step: m.busy })
    // The view first, before anything can move the camera; then one painted frame, so the button shows it is
    // working before the large draw holds the page.
    const onScreen = currentView()
    const levelBefore = useStudio.getState().level
    const view = mode === 'render' ? { ...onScreen, level: 'realistic' as const } : onScreen
    const stage: Stage = mode === 'render' ? 'render' : stageOfView(view)
    await paint()
    let frame: Frame
    try {
      if (mode === 'render' && levelBefore !== 'realistic') {
        useStudio.setState({ recording: 'מרנדר הדמיה' })
        useStudio.getState().set('level', 'realistic')
        await settle()
      }
      frame = await draw({ ...STILL, type: STILL_TYPE, quality: STILL_QUALITY })
    } catch (e) {
      return setState({ status: 'failed', message: `${mode === 'render' ? 'הרינדור' : 'הצילום'} נכשל: ${e instanceof Error ? e.message : String(e)}. אפשר לנסות שוב.` })
    } finally {
      if (mode === 'render') {
        useStudio.setState({ recording: null })
        if (levelBefore !== 'realistic') useStudio.getState().set('level', levelBefore)
      }
    }
    const recipeId = ((useStudio.getState().validRecipe?.meta as { id?: string } | undefined)?.id ?? 'model').replace(/[^a-z0-9-]/g, '')
    const name = frameName(recipeId, mode === 'render' ? 'render' : view.level, new Date(), 'jpg')
    const local = (message: string) => {
      download(frame.blob, STILL_TYPE, name)
      setState({ status: 'local', frame, message })
    }

    setState({ status: 'busy', step: 'שומר את הגרסה' })
    const anchor = await anchorVersion(m.note)
    if (!anchor.ok) return local(`${anchor.message} התמונה ירדה למכשיר.`)
    setState({ status: 'busy', step: 'מעלה לקולקציה' })
    try {
      await addItem({ kind: 'still', projectId: anchor.projectId, versionId: anchor.versionId, stage, view, blob: frame.blob, ext: 'jpg' })
      setState({ status: 'done', frame, name, projectId: anchor.projectId, savedVersion: anchor.savedVersion, stage: STAGE_LABEL[stage] ?? stage })
    } catch (e) {
      local(`${e instanceof Error ? e.message : String(e)} התמונה ירדה למכשיר.`)
    }
  }

  const busy = state.status === 'busy'
  return (
    <div className="step-control" data-testid={id} data-status={state.status}>
      <button type="button" onClick={run} disabled={!ready || busy} data-testid={`${id}-view`} title={m.title}>
        <span className="step-num">{mode === 'freeze' ? '03' : '05'}</span> {busy ? state.step : m.label}
      </button>
      {state.status !== 'idle' && !busy && (
        <PathStatus>
          <p className="path-message" role="status" data-testid={`${id}-status`}>
            {state.status === 'done' && (
              <>
                {m.what} נשמר{mode === 'render' ? 'ה' : ''} בקולקציה, בשלב {state.stage}, ‏{state.frame.width} × {state.frame.height}.
                {state.savedVersion ? ' נשמרה גם גרסה, כי התמונה שייכת לצורה שעל המסך.' : ''}{' '}
                <button type="button" onClick={() => download(state.frame.blob, STILL_TYPE, state.name)} data-testid={`${id}-download`}>
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
        </PathStatus>
      )}
    </div>
  )
}
