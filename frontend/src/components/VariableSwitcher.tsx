import { VARIABLES, VARIABLE_ORDER, type VariableKey } from '../lib/variables'

interface VariableSwitcherProps {
  value: VariableKey
  onChange: (key: VariableKey) => void
  /** Keys actually present in the response; others are disabled, not hidden. */
  available: Set<string>
}

/**
 * Radio group rather than tabs: choosing a variable changes what the map
 * *means*, not which panel is showing. Arrow keys move between options, which is
 * the native radio contract and what a keyboard user will try first.
 */
export function VariableSwitcher({ value, onChange, available }: VariableSwitcherProps) {
  const keys = VARIABLE_ORDER.filter((k) => available.size === 0 || available.has(k))

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const next = keys[(index + delta + keys.length) % keys.length]
    if (next) onChange(next)
  }

  return (
    <div className="variable-switcher" role="radiogroup" aria-label="Weather variable shown on the map">
      {keys.map((key, i) => {
        const meta = VARIABLES[key]
        const selected = key === value
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`variable-option${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="variable-option-label">{meta.shortLabel}</span>
            <span className="variable-option-unit">{meta.fallbackUnit}</span>
          </button>
        )
      })}
    </div>
  )
}
