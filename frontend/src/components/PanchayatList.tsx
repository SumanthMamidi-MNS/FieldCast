import type { PanchayatForecast } from '../types/api'
import type { ColorScale } from '../lib/colorScale'
import { formatValue, variableMeta, type VariableKey } from '../lib/variables'
import { SupportChip } from './TextureSwatch'

interface PanchayatListProps {
  forecasts: PanchayatForecast[]
  variableKey: VariableKey
  scale: ColorScale
  selectedId: string | null
  onSelect: (panchayatId: string) => void
}

/**
 * The map's keyboard-accessible twin.
 *
 * A canvas choropleth cannot be tabbed through, so every panchayat is also a
 * real button here, in the same colour and carrying the same confidence chip.
 * This is not a fallback for "accessibility compliance" — on a phone in a field
 * it is the faster way to work, and it is the only way to read the map with a
 * screen reader.
 */
export function PanchayatList({
  forecasts,
  variableKey,
  scale,
  selectedId,
  onSelect,
}: PanchayatListProps) {
  const meta = variableMeta(variableKey)
  const sorted = [...forecasts].sort((a, b) => {
    const av = a.variables[variableKey]?.value ?? Number.NEGATIVE_INFINITY
    const bv = b.variables[variableKey]?.value ?? Number.NEGATIVE_INFINITY
    return bv - av
  })

  return (
    <nav className="panchayat-list" aria-label={`Panchayats ranked by ${meta.label.toLowerCase()}`}>
      <ol>
        {sorted.map((forecast) => {
          const variable = forecast.variables[variableKey]
          const value = variable?.value ?? Number.NaN
          const selected = forecast.panchayat_id === selectedId
          return (
            <li key={forecast.panchayat_id}>
              <button
                type="button"
                className={`panchayat-row${selected ? ' is-selected' : ''}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(forecast.panchayat_id)}
              >
                <span
                  className="panchayat-row-swatch"
                  style={{ background: scale.color(value) }}
                  aria-hidden
                />
                <span className="panchayat-row-body">
                  <span className="panchayat-row-name">{forecast.panchayat_name}</span>
                  {variable && (
                    <SupportChip
                      support={variable.confidence.support}
                      label={variable.confidence.support_label}
                      color={scale.color(value)}
                    />
                  )}
                </span>
                <span className="panchayat-row-value">
                  {formatValue(value, variableKey, variable?.unit)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
