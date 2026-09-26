import type { VariableForecast } from '../types/api'

interface RainProbabilityProps {
  precip: VariableForecast
}

/**
 * Rain chance and rain amount, side by side and clearly separated.
 *
 * `backend/app/services/advisory.py` keeps these apart on purpose: spray timing
 * depends on *whether* it rains, irrigation depends on *how much*. Collapsing
 * them into one number is the single easiest way for this dashboard to mislead
 * someone, so the two statements are drawn as two statements.
 */
export function RainProbability({ precip }: RainProbabilityProps) {
  const p = precip.rain_probability
  if (p === null) return null
  const pct = Math.round(p * 100)

  return (
    <section className="rain-split" aria-label="Rain chance and rain amount">
      <div className="rain-card">
        <p className="rain-card-label">Chance of any rain</p>
        <p className="rain-card-value">
          {pct}
          <span className="rain-card-unit">%</span>
        </p>
        <div
          className="rain-meter"
          role="img"
          aria-label={`${pct} percent chance of measurable rain`}
        >
          <div className="rain-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="rain-card-help">
          Whether it rains at all. This is what decides spraying.
        </p>
      </div>

      <div className="rain-card">
        <p className="rain-card-label">How much, if it rains</p>
        <p className="rain-card-value">
          {precip.value.toFixed(1)}
          <span className="rain-card-unit">{precip.unit}</span>
        </p>
        <p className="rain-card-range">
          could be {precip.confidence.lower.toFixed(1)}–{precip.confidence.upper.toFixed(1)}{' '}
          {precip.unit}
        </p>
        <p className="rain-card-help">
          Depth over the day. This is what decides irrigation.
        </p>
      </div>
    </section>
  )
}
