/**
 * A model drawn from its equation (figures.ts). The line draws itself once, and a point travels along it: the
 * movement a person would make along the form. Illustration only; the numbers are in the studio.
 */
import { useMemo } from 'react'
import { FIGURES, pathOf } from '../../learn/figures'

export function ModelFigure({ id, size = 'card', moving = true }: { id: string; size?: 'card' | 'large'; moving?: boolean }) {
  const fig = useMemo(() => FIGURES[id]?.(), [id])
  if (!fig) return null
  const mainLines = fig.lines.filter((l) => l.role === 'main')
  const longest = mainLines.reduce((a, b) => (b.pts.length > a.pts.length ? b : a), mainLines[0]!)
  const track = pathOf(longest.pts, longest.closed)
  return (
    <svg className={`model-figure ${size}`} viewBox="0 0 240 160" role="img" aria-label="המחשה של המודל, מחושבת מהמשוואה שלו">
      {fig.lines.map((l, i) => (
        <path key={i} d={pathOf(l.pts, l.closed)} className={`mf-${l.role}`} pathLength={1} fill="none" />
      ))}
      {moving && (
        <circle r={size === 'large' ? 3.4 : 2.6} className="mf-walker">
          <animateMotion dur={size === 'large' ? '9s' : '7s'} repeatCount="indefinite" path={track} rotate="auto" />
        </circle>
      )}
    </svg>
  )
}
