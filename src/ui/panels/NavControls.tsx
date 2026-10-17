/**
 * Navigation under the model (DECISIONS.md 110): words, not arrows. One row of four directions that orbit or
 * pan by the chosen mode, closer and farther, framing the whole model, and back to the chosen view.
 * A short line explains the free hand: mouse wording on a computer, touch wording on a phone.
 */
import { useState } from 'react'
import { cameraControl } from '../../scene/BareScene'
import { STEP, type NavStep } from '../../scene/navigation'

type Mode = 'orbit' | 'pan'
type Dir = 'right' | 'left' | 'up' | 'down'

const DIRS: { id: Dir; label: string; d: [number, number] }[] = [
  { id: 'right', label: 'ימינה', d: [1, 0] },
  { id: 'left', label: 'שמאלה', d: [-1, 0] },
  { id: 'up', label: 'למעלה', d: [0, 1] },
  { id: 'down', label: 'למטה', d: [0, -1] },
]

const TITLES: Record<Mode, Record<Dir, string>> = {
  orbit: {
    right: 'המצלמה מקיפה את המודל ימינה, 15 מעלות',
    left: 'המצלמה מקיפה את המודל שמאלה, 15 מעלות',
    up: 'המצלמה עולה ומביטה יותר מלמעלה, 8 מעלות',
    down: 'המצלמה יורדת לכיוון הקרקע, 8 מעלות',
  },
  pan: {
    right: 'המבט זז ימינה בלי להסתובב',
    left: 'המבט זז שמאלה בלי להסתובב',
    up: 'המבט זז למעלה בלי להסתובב',
    down: 'המבט זז למטה בלי להסתובב',
  },
}

export function navStep(mode: Mode, [x, y]: [number, number]): NavStep {
  return mode === 'orbit' ? { kind: 'orbit', azimuth: x * STEP.azimuth, polar: y * STEP.polar } : { kind: 'pan', right: x * STEP.pan, up: y * STEP.pan }
}

const coarse = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)

export function NavControls() {
  const [mode, setMode] = useState<Mode>('orbit')
  const [touch] = useState(coarse)
  const move = (s: Parameters<NonNullable<typeof cameraControl.move>>[0]) => cameraControl.move?.(s)
  return (
    <div className="navbar">
      <div className="navbar-row" role="toolbar" aria-label="ניווט במודל">
        <div className="seg" role="group" aria-label="מה הכיוונים עושים">
          <button type="button" aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')} data-testid="nav-mode-orbit" title="הכיוונים מסובבים את המצלמה סביב המודל">
            סיבוב
          </button>
          <button type="button" aria-pressed={mode === 'pan'} onClick={() => setMode('pan')} data-testid="nav-mode-pan" title="הכיוונים מזיזים את המבט בלי לסובב">
            הזזה
          </button>
        </div>
        <div className="seg dirs" role="group" aria-label={mode === 'orbit' ? 'כיוון הסיבוב' : 'כיוון ההזזה'}>
          {DIRS.map((d) => (
            <button key={d.id} type="button" onClick={() => move(navStep(mode, d.d))} title={TITLES[mode][d.id]} data-testid={`nav-${d.id}`}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="מרחק">
          <button type="button" onClick={() => move({ kind: 'zoom', factor: STEP.zoom })} title="מקרב את המצלמה פי 1.25" data-testid="nav-in">
            קרוב
          </button>
          <button type="button" onClick={() => move({ kind: 'zoom', factor: 1 / STEP.zoom })} title="מרחיק את המצלמה פי 1.25" data-testid="nav-out">
            רחוק
          </button>
        </div>
        <button type="button" onClick={() => move('center')} title="המודל כולו במרכז החלון, מאותו כיוון מבט" data-testid="nav-center">
          מרכוז
        </button>
        <button type="button" onClick={() => move('reset')} title="חזרה לנקודת המבט שנבחרה" data-testid="nav-reset">
          איפוס מבט
        </button>
      </div>
      <p
        className="navhelp"
        data-testid="nav-help"
        title={touch ? undefined : 'אחרי לחיצה על המודל: חיצים מסובבים, Shift עם חיצים מזיזים, פלוס ומינוס מקרבים ומרחיקים, אפס מאפס את המבט, C ממרכז'}
      >
        {touch ? 'אצבע אחת: סיבוב · שתי אצבעות: הזזה · צביטה: קרוב ורחוק' : 'גרירה: סיבוב · גרירה ימנית: הזזה · גלגלת: קרוב ורחוק · מקלדת: חיצים, Shift, פלוס, מינוס, אפס'}
      </p>
    </div>
  )
}
