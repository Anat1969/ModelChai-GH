/**
 * Step 04 "סרטון" on the path (DECISIONS.md 88, 116–118): makes the clip along the chosen views, or the quarter
 * turn when none is chosen. "מבטים" opens the side tab where the views are chosen, ordered and previewed.
 */
import { navigate } from '../router'
import { download } from '../download'
import { cancelClip, makeClip, useClip } from '../clipRun'
import { useStudio } from '../store'
import { PathStatus } from './pathSlot'

export function ClipControl({ onViews }: { onViews?: () => void }) {
  const ready = useStudio((s) => !!s.result && !s.building && !s.recording)
  const state = useClip((s) => s.state)
  const busy = state.status === 'busy'

  return (
    <div className="step-control clip-step" data-testid="clip" data-status={state.status}>
      <div className="clip-buttons">
        <button type="button" onClick={() => void makeClip()} disabled={!ready || busy} data-testid="make-clip" title="סרטון לאורך המבטים שנבחרו, ובלי מבטים: סיבוב רבע של ארבע שניות. המודל עובר מערום לריאליסטי">
          <span className="step-num">04</span> {busy ? `${state.step}, ${state.progress}%` : 'סרטון'}
        </button>
        {busy && (
          <button type="button" onClick={cancelClip} data-testid="cancel-clip">
            ביטול
          </button>
        )}
        {!busy && onViews && (
          <button type="button" className="quiet" onClick={onViews} data-testid="open-video">
            מבטים
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
