import { useId } from 'react'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Value and unit, as displayed. */
  display: string
  /** One sentence on what the parameter does. */
  why: string
  onChange: (v: number) => void
  testId?: string
}

/** Value, unit and one explaining sentence (CLAUDE.md, "ממשק"). */
export function Slider({ label, value, min, max, step, display, why, onChange, testId }: Props) {
  const id = useId()
  return (
    <div className="ctl">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id} data-testid={testId && `${testId}-out`}>
        {display}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        aria-describedby={`${id}-why`}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <span className="why" id={`${id}-why`}>
        {why}
      </span>
    </div>
  )
}
