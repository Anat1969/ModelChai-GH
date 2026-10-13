interface Props {
  label: string
  why: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  testId?: string
}

/** A segmented choice: every option is visible, the chosen one is marked. */
export function Choice({ label, why, value, options, onChange, testId }: Props) {
  return (
    <div className="ctl" role="group" aria-label={label}>
      <span className="label">{label}</span>
      <span />
      <div className="seg">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={o.value === value} data-testid={testId && `${testId}-${o.value}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <span className="why">{why}</span>
    </div>
  )
}
