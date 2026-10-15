/**
 * The path under the model (DECISIONS.md 90): the work's steps in the collection's order, numbered, from the
 * abstract to the object. 01 and 02 are the two levels; the clip passes from one to the other; then the
 * visualization and the print. One status line under the steps carries every outcome.
 */
import { useState } from 'react'
import { navigate } from '../router'
import { useStudio } from '../store'
import { ClipControl } from './ClipControl'
import { FreezeControl } from './FreezeControl'
import { PathSlot } from './pathSlot'
import { CLIP, clipPhases } from '../../capture/clip'
import { num } from '../format'

const PHASES = clipPhases()

/** Step 04 in time: what each second of the clip shows. The marker follows the frames being drawn. */
function ClipTimeline() {
  const progress = useStudio((s) => s.clipProgress)
  return (
    <div className="cliptime" data-testid="cliptime">
      <span className="cliptime-title">
        <span className="step-num">04</span> מסלול הסרטון, {CLIP.seconds} שניות:
      </span>
      <div className="cliptime-bar" role="img" aria-label={`${PHASES.map((p) => `${p.label} ${num(p.seconds, 0)} שניות`).join(', ')}, והמצלמה מסתובבת ${CLIP.turnDeg} מעלות`}>
        {PHASES.map((p) => (
          <span key={p.id} className={`cliptime-part ${p.id}`} style={{ flexGrow: p.seconds }} data-seconds={p.seconds}>
            {p.label} <span className="num">{num(p.seconds, 0)} ש'</span>
          </span>
        ))}
        {progress !== null && <i className="cliptime-marker" style={{ insetInlineStart: `${progress}%` }} />}
      </div>
      <span className="cliptime-turn">המצלמה מסתובבת {CLIP.turnDeg}° סביב המודל</span>
    </div>
  )
}

export function PathBar({ onPrint }: { onPrint: () => void }) {
  const level = useStudio((s) => s.level)
  const set = useStudio((s) => s.set)
  const project = useStudio((s) => s.project)
  const recording = useStudio((s) => !!s.recording)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const bare = level === 'bare'

  return (
    <nav className="pathbar" aria-label="מסלול העבודה" data-testid="pathbar">
      <PathSlot.Provider value={slot}>
        <ol className="path-steps">
          <li data-step="bare">
            <button type="button" aria-pressed={bare} disabled={recording} data-testid="level-bare" onClick={() => set('level', 'bare')}>
              <span className="step-num">01</span> ערום
            </button>
          </li>
          <li data-step="realistic">
            <button type="button" aria-pressed={!bare} disabled={recording} data-testid="level-realistic" onClick={() => set('level', 'realistic')}>
              <span className="step-num">02</span> ריאליסטי
            </button>
          </li>
          <li data-step="freeze">
            <FreezeControl />
          </li>
          <li data-step="clip">
            <ClipControl />
          </li>
          <li data-step="render">
            <FreezeControl mode="render" />
          </li>
          <li data-step="print">
            <div className="step-control">
              <button type="button" onClick={onPrint} data-testid="open-print">
                <span className="step-num">06</span> הדפסה
              </button>
            </div>
          </li>
          {project && (
            <li data-step="collection" className="path-end">
              <button type="button" className="quiet" onClick={() => navigate('collection', { p: project.id })} data-testid="path-collection">
                לקולקציה
              </button>
            </li>
          )}
        </ol>
        <ClipTimeline />
        <div className="path-status" ref={setSlot} />
      </PathSlot.Provider>
    </nav>
  )
}
