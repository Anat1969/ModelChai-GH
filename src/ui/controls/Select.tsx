import { useId } from 'react'

interface Props {
  label: string
  why: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  testId?: string
}

/** A list choice for longer option sets, with the same label and explaining sentence as every control. */
export function Select({ label, why, value, options, onChange, testId }: Props) {
  const id = useId()
  return (
    <div className="ctl">
      <label htmlFor={id}>{label}</label>
      <span />
      <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-describedby={`${id}-why`} data-testid={testId} style={{ gridColumn: '1 / -1' }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="why" id={`${id}-why`}>
        {why}
      </span>
    </div>
  )
}
