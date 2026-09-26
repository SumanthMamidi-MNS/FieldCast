import { VARIABLES, VARIABLE_ORDER, type VariableKey } from '../../lib/variables'

interface VariableSegmentedProps {
  value: VariableKey
  onChange: (key: VariableKey) => void
  /** Keys present in the response; others are disabled, not hidden. */
  available: Set<string>
}

/**
 * Radio group rather than tabs: choosing a variable changes what the map
 * *means*, not which panel is showing. Arrow keys move and select, which is
 * the native radio contract.
 */
export function VariableSegmented({ value, onChange, available }: VariableSegmentedProps) {
  const isOn = (k: VariableKey) => available.size === 0 || available.has(k)
  const keys = VARIABLE_ORDER.filter(isOn)

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const i = keys.indexOf(value)
    const next = keys[(i + delta + keys.length) % keys.length]
    if (next) {
      onChange(next)
      const group = e.currentTarget.parentElement
      requestAnimationFrame(() =>
        group?.querySelector<HTMLButtonElement>(`[data-key="${next}"]`)?.focus(),
      )
    }
  }

  return (
    <div className="segmented" role="radiogroup" aria-label="Weather shown on the map">
      {VARIABLE_ORDER.map((key) => {
        const selected = key === value
        return (
          <button
            key={key}
            data-key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!isOn(key)}
            tabIndex={selected ? 0 : -1}
            className={`segment${selected ? ' is-on' : ''}`}
            onClick={() => onChange(key)}
            onKeyDown={onKeyDown}
          >
            {VARIABLES[key].shortLabel}
          </button>
        )
      })}
    </div>
  )
}
