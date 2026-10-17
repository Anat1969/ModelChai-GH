/**
 * The path under the model (DECISIONS.md 90): the work's steps in the collection's order, numbered, from the
 * abstract to the object. 01 and 02 are the two levels; the clip passes from one to the other; then the
 * visualization and the print. One status line under the steps carries every outcome.
 */
import { useMemo, useState } from 'react'
import { navigate } from '../router'
import { useStudio } from '../store'
import { useShots } from '../shots'
import { ClipControl } from './ClipControl'
import { FreezeControl } from './FreezeControl'
import { PathSlot } from './pathSlot'
import { clipPhases, QUARTER } from '../../capture/clip'
import { buildPath } from '../../capture/path'
import { planSeconds } from '../../capture/shots'
import { num } from '../format'

/**
 * Step 04 in time: what each second of the clip shows, and where the chosen views fall (DECISIONS.md 116).
 * The marker follows the frames being drawn, or the preview as it plays.
 */
function ClipTimeline() {
  const progress = useStudio((s) => s.clipProgress)
  const shots = useShots((s) => s.shots)
  const levels = useShots((s) => s.levels)
  const { seconds, phases, ticks } = useMemo(() => {
    const seconds = shots.length ? planSeconds(shots) : QUARTER.seconds
    const ticks = shots.length > 1 && seconds > 0 ? buildPath(shots).keyAt.map((t) => (100 * t) / seconds) : []
    return { seconds, phases: clipPhases(levels, seconds), ticks }
  }, [shots, levels])
  const motion = shots.length ? `המצלמה עוברת בין ${shots.length} מבטים שנבחרו` : `המצלמה מסתובבת ${QUARTER.turnDeg}° סביב המודל`
  const s1 = (v: number) => num(v, v % 1 ? 1 : 0)
  return (
    <div className="cliptime" data-testid="cliptime" data-seconds={seconds}>
      <span className="cliptime-title">
        <span className="step-num">04</span> מסלול הסרטון, <span className="num">{s1(seconds)}</span> שניות:
      </span>
      <div className="cliptime-bar" role="img" aria-label={`${phases.map((p) => `${p.label} ${s1(p.seconds)} שניות`).join(', ')}. ${motion}`}>
        {phases.map((p) => (
          <span key={p.id} className={`cliptime-part ${p.id}`} style={{ flexGrow: p.seconds }} data-seconds={p.seconds}>
            {p.label} <span className="num">{s1(p.seconds)} ש'</span>
          </span>
        ))}
        {ticks.map((x, i) => (
          <i key={i} className="cliptime-key" style={{ insetInlineStart: `${x}%` }} title={`מבט ${i + 1}`} />
        ))}
        {progress !== null && <i className="cliptime-marker" data-testid="cliptime-marker" data-progress={progress.toFixed(1)} style={{ insetInlineStart: `${progress}%` }} />}
      </div>
      <span className="cliptime-turn">{motion}</span>
    </div>
  )
}

export function PathBar({ onPrint, onVideo }: { onPrint: () => void; onVideo?: () => void }) {
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
            <ClipControl onViews={onVideo} />
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
