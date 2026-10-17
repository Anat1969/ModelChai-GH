/**
 * "סרטון" side tab (DECISIONS.md 116–118): the views the clip passes through, in order, each with its time;
 * two ready paths; the level plan; a live preview; and making the clip.
 */
import { useMemo } from 'react'
import { framesFor, LEVEL_MODES, QUARTER, quarterOrbit } from '../../capture/clip'
import { entryPass, planSeconds, SECONDS } from '../../capture/shots'
import { cameraControl } from '../../scene/BareScene'
import { addCurrentShot, addShots, cancelClip, makeClip, startPreview, stopPreview, useClip } from '../clipRun'
import { num } from '../format'
import type { Sweep } from '../params'
import { useShots } from '../shots'
import { useStudio } from '../store'

const s1 = (v: number) => num(v, v % 1 ? 1 : 0)
const seconds = (v: number) => (v === 1 ? 'שנייה אחת' : `${s1(v)} שניות`)

export function VideoPanel({ built }: { built: Sweep | null }) {
  const shots = useShots((s) => s.shots)
  const thumbs = useShots((s) => s.thumbs)
  const levels = useShots((s) => s.levels)
  const dispatch = useShots((s) => s.dispatch)
  const state = useClip((s) => s.state)
  const ready = useStudio((s) => !!s.result && !s.building)
  const recording = useStudio((s) => s.recording)
  const previewing = state.status === 'previewing'
  const busy = state.status === 'busy'
  const locked = busy || previewing

  const total = useMemo(() => (shots.length ? planSeconds(shots) : QUARTER.seconds), [shots])
  const mode = LEVEL_MODES.find((m) => m.id === levels.mode)!

  const quarter = () => {
    const pose = cameraControl.get?.()
    if (pose) void addShots(quarterOrbit(pose))
  }
  const entry = () => built && void addShots(entryPass(built))

  return (
    <section className="panel video-panel" aria-label="סרטון ממבטים נבחרים" data-testid="video-panel">
      <h2>סרטון ממבטים נבחרים</h2>
      <p className="why">כל מבט הוא נקודה במסלול המצלמה. הסרטון עובר ביניהם לפי הסדר, בקו רך ובמהירות כמעט קבועה.</p>

      <div className="video-add" role="group" aria-label="הוספת מבטים">
        <button type="button" className="primary" onClick={() => void addCurrentShot()} disabled={!ready || locked} data-testid="shot-add">
          הוספת המבט הנוכחי
        </button>
        <button type="button" onClick={quarter} disabled={!ready || locked} data-testid="shot-preset-quarter" title="חמישה מבטים שמסובבים את המבט הנוכחי ברבע סיבוב, ארבע שניות">
          סיבוב רבע
        </button>
        <button type="button" onClick={entry} disabled={!ready || locked || !built} data-testid="shot-preset-entry" title="מרחוק בגובה העיניים, דרך הכניסה, אל הפנים">
          מעבר כניסה
        </button>
      </div>

      {shots.length === 0 ? (
        <p className="video-empty" data-testid="shot-empty">
          אין עדיין מבטים. בלי מבטים הסרטון הוא סיבוב רבע של ארבע שניות סביב המבט הנוכחי. מזיזים את המצלמה, או בוחרים נקודת מבט מתחת למודל, ולוחצים "הוספת המבט הנוכחי".
        </p>
      ) : (
        <ol className="shots" data-testid="shot-list">
          {shots.map((s, i) => {
            const last = i === shots.length - 1
            const id = `shot-sec-${s.id}`
            return (
              <li key={s.id} className="shot" data-testid="shot" data-id={s.id}>
                <div className="shot-thumb">{thumbs[s.id] ? <img src={thumbs[s.id]} alt={`מבט ${i + 1}`} width={150} height={100} /> : <span>מבט {i + 1}</span>}</div>
                <div className="shot-body">
                  <div className="shot-head">
                    <strong>מבט {i + 1}</strong>
                    <span className="shot-meta">
                      {s.level === 'bare' ? 'נלקח בערום' : 'נלקח בריאליסטי'}, גובה המצלמה <span className="num">{num(s.position[1], 1)}</span> מ'
                    </span>
                  </div>
                  <div className="ctl">
                    <label htmlFor={id}>{last ? 'עצירה בסוף' : 'משך עד המבט הבא'}</label>
                    <output htmlFor={id} className="num">
                      {seconds(s.seconds)}
                    </output>
                    <input
                      id={id}
                      type="range"
                      min={SECONDS.min}
                      max={SECONDS.max}
                      step={SECONDS.step}
                      value={s.seconds}
                      disabled={locked}
                      data-testid="shot-seconds"
                      onChange={(e) => dispatch({ type: 'seconds', id: s.id, seconds: Number(e.currentTarget.value) })}
                    />
                    <span className="why">{last ? 'כמה זמן המצלמה נשארת על המבט האחרון.' : 'כמה זמן המצלמה נוסעת מהמבט הזה לבא אחריו. אפס הוא חיתוך: קפיצה ישירה.'}</span>
                  </div>
                  <div className="shot-actions">
                    <button type="button" disabled={locked || i === 0} onClick={() => dispatch({ type: 'move', id: s.id, by: -1 })} data-testid="shot-earlier">
                      מוקדם יותר
                    </button>
                    <button type="button" disabled={locked || last} onClick={() => dispatch({ type: 'move', id: s.id, by: 1 })} data-testid="shot-later">
                      מאוחר יותר
                    </button>
                    <button type="button" className="quiet" disabled={locked} onClick={() => dispatch({ type: 'remove', id: s.id })} data-testid="shot-remove">
                      הסרה
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <fieldset className="video-levels" disabled={locked}>
        <legend>מעבר בין הרמות</legend>
        <div className="seg" role="group" aria-label="מעבר בין הרמות">
          {LEVEL_MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={levels.mode === m.id} onClick={() => dispatch({ type: 'levels', levels: { mode: m.id } })} data-testid={`level-mode-${m.id}`}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="why">{mode.why}</p>
        {levels.mode === 'blend' && (
          <>
            <div className="ctl">
              <label htmlFor="blend-from">המעבר מתחיל</label>
              <output htmlFor="blend-from" className="num">
                בשנייה {s1(levels.from)}
              </output>
              <input id="blend-from" type="range" min={0} max={Math.max(total, levels.from)} step={0.5} value={levels.from} onChange={(e) => dispatch({ type: 'levels', levels: { from: Number(e.currentTarget.value), to: Math.max(levels.to, Number(e.currentTarget.value)) } })} data-testid="blend-from" />
              <span className="why">עד הרגע הזה רואים רק את הגאומטריה הערומה.</span>
            </div>
            <div className="ctl">
              <label htmlFor="blend-to">המעבר נגמר</label>
              <output htmlFor="blend-to" className="num">
                בשנייה {s1(levels.to)}
              </output>
              <input id="blend-to" type="range" min={0} max={Math.max(total, levels.to)} step={0.5} value={levels.to} onChange={(e) => dispatch({ type: 'levels', levels: { to: Math.max(levels.from, Number(e.currentTarget.value)) } })} data-testid="blend-to" />
              <span className="why">מכאן והלאה המודל בחומרים ובסביבה. בין שתי השניות התמונה מתמזגת בהדרגה.</span>
            </div>
          </>
        )}
      </fieldset>

      <p className="video-total" data-testid="video-total" data-seconds={total} data-frames={framesFor(total)}>
        סך הכול <span className="num">{seconds(total)}</span>, <span className="num">{framesFor(total)}</span> תמונות, 30 בשנייה.
      </p>

      <div className="video-run">
        {previewing ? (
          <button type="button" onClick={() => stopPreview('התצוגה המקדימה נעצרה, והמצלמה חזרה למקומה.')} data-testid="stop-preview">
            עצירה
          </button>
        ) : (
          <button type="button" onClick={startPreview} disabled={!ready || busy || (!!recording && !previewing)} data-testid="preview-clip">
            תצוגה מקדימה
          </button>
        )}
        <button type="button" className="primary" onClick={() => void makeClip()} disabled={!ready || locked} data-testid="video-make">
          {busy ? `${state.step}, ${state.progress}%` : 'יצירת הסרטון'}
        </button>
        {busy && (
          <button type="button" onClick={cancelClip} data-testid="video-cancel">
            ביטול
          </button>
        )}
        {shots.length > 0 && (
          <button type="button" className="quiet" disabled={locked} onClick={() => dispatch({ type: 'clear' })} data-testid="shot-clear">
            ניקוי הרשימה
          </button>
        )}
      </div>
      {(state.status === 'failed' || state.status === 'done' || (state.status === 'idle' && state.message)) && (
        <p className="video-status" role="status" data-testid="video-status">
          {state.message}
        </p>
      )}
    </section>
  )
}
