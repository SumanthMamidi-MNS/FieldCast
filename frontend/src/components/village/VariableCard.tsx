import type { VariableForecast } from '../../types/api'
import { computeBand, refinementSignal } from '../../lib/intervalBand'
import { formatDelta, formatNumber, variableMeta } from '../../lib/variables'

/** Virtual drawing width; positions are consumed as percentages. */
const VIRTUAL_WIDTH = 1000

/**
 * One variable for one village, drawn on one axis:
 *   shaded band = the 80% range (the honest answer),
 *   dot         = the refined value,
 *   upright tick = the official block value.
 * Rain chance is a separate statement from rain amount, so it gets its own meter.
 */
export function VariableCard({ forecast }: { forecast: VariableForecast }) {
  const key = forecast.variable
  const meta = variableMeta(key)
  const unit = forecast.unit
  const c = forecast.confidence
  const band = computeBand({
    lower: c.lower,
    upper: c.upper,
    value: forecast.value,
    blockValue: forecast.block_value,
    width: VIRTUAL_WIDTH,
    ...(meta.zeroAnchored ? { floor: 0 } : {}),
  })
  const delta = forecast.value - forecast.block_value
  const signal = refinementSignal({
    value: forecast.value,
    blockValue: forecast.block_value,
    lower: c.lower,
    upper: c.upper,
  })
  const n = (v: number) => formatNumber(v, key)
  const p = forecast.rain_probability
  const pct = p === null ? null : Math.round(p * 100)

  const summary =
    `${forecast.label}: ${n(forecast.value)} ${unit}, likely between ${n(c.lower)} and ${n(c.upper)} ${unit}. ` +
    `Block forecast ${n(forecast.block_value)} ${unit}.`

  return (
    <article className="var-card">
      <header className="var-card-head">
        <h4 className="var-card-label">{forecast.label}</h4>
        <p className="var-card-value">
          <span className="num">{n(forecast.value)}</span>
          <span className="var-card-unit">{unit}</span>
        </p>
        <span
          className={`delta num${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}`}
          title="Difference from the block forecast"
        >
          {formatDelta(delta, key, unit)}
          <span className="visually-hidden"> compared with the block forecast</span>
        </span>
      </header>

      <div className="band" role="img" aria-label={summary}>
        <span className="band-rail" />
        <span
          className={`band-range sup-${c.support}`}
          style={{ left: `${band.bandStartPct}%`, width: `${band.bandWidthPct}%` }}
        />
        <span className="band-block" style={{ left: `${band.blockPct}%` }} />
        <span className="band-dot" style={{ left: `${band.valuePct}%` }} />
      </div>
      <p className="band-foot num">
        <span>
          Likely {n(c.lower)}–{n(c.upper)}
        </span>
        <span className="band-foot-block">
          <span className="band-block-key" aria-hidden /> Block {n(forecast.block_value)}
        </span>
      </p>
      <p className="var-card-read">
        {signal >= 1
          ? 'Clear local difference: bigger than the uncertainty.'
          : 'Within the uncertainty: treat as the same as the block.'}
      </p>
      {pct !== null && (
        <div className="rain-chance">
          <p className="rain-chance-text">
            <strong className="num">{pct}%</strong> chance of rain (2.5 mm or more)
          </p>
          <div
            className="meter"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Chance of measurable rain"
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="rain-chance-help">
            Chance of rain decides spraying and harvest. The amount above decides irrigation.
          </p>
        </div>
      )}
    </article>
  )
}
