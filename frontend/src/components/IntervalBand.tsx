import { computeBand, refinementSignal } from '../lib/intervalBand'
import type { VariableForecast } from '../types/api'
import { variableMeta } from '../lib/variables'
import { confidenceStyle } from '../lib/confidenceTexture'

interface IntervalBandProps {
  forecast: VariableForecast
}

/** Virtual drawing width; positions are consumed as percentages. */
const VIRTUAL_WIDTH = 1000

/**
 * One variable, drawn on one scale:
 *
 *   - the shaded band is the 80% interval (the honest answer),
 *   - the solid marker is the downscaled median,
 *   - the upright tick is the official block value.
 *
 * Putting the block value on the *same* axis is the point. It turns "we refined
 * this" from a claim into something you can see the size of, and when the marker
 * sits on top of the tick it silently admits we added nothing here.
 */
export function IntervalBand({ forecast }: IntervalBandProps) {
  const meta = variableMeta(forecast.variable)
  const floor = meta.zeroAnchored ? 0 : undefined
  const band = computeBand({
    lower: forecast.confidence.lower,
    upper: forecast.confidence.upper,
    value: forecast.value,
    blockValue: forecast.block_value,
    width: VIRTUAL_WIDTH,
    ...(floor !== undefined ? { floor } : {}),
  })

  const d = meta.decimals
  const unit = forecast.unit
  const style = confidenceStyle(forecast.confidence.support)
  const signal = refinementSignal({
    value: forecast.value,
    blockValue: forecast.block_value,
    lower: forecast.confidence.lower,
    upper: forecast.confidence.upper,
  })
  const shift = forecast.value - forecast.block_value
  const shiftText =
    Math.abs(shift) < Math.pow(10, -d) / 2
      ? 'the same as the block forecast'
      : `${Math.abs(shift).toFixed(d)} ${unit} ${shift > 0 ? 'above' : 'below'} the block forecast`

  const summary =
    `${forecast.label}: ${forecast.value.toFixed(d)} ${unit}, ` +
    `${forecast.confidence.interval_pct}% range ${forecast.confidence.lower.toFixed(d)} to ` +
    `${forecast.confidence.upper.toFixed(d)} ${unit}. Block forecast ` +
    `${forecast.block_value.toFixed(d)} ${unit} — this village is ${shiftText}.`

  return (
    <div className="interval">
      <div className="interval-head">
        <h4 className="interval-label">{forecast.label}</h4>
        <p className="interval-value">
          <strong>{forecast.value.toFixed(d)}</strong>
          <span className="interval-unit">{unit}</span>
        </p>
      </div>

      <div className="interval-track" role="img" aria-label={summary}>
        <div className="interval-rail" />
        <div
          className={`interval-band support-band-${forecast.confidence.support}`}
          style={{ left: `${band.bandStartPct}%`, width: `${band.bandWidthPct}%` }}
        />
        <div className="interval-block" style={{ left: `${band.blockPct}%` }}>
          <span className="interval-block-tick" />
        </div>
        <div className="interval-marker" style={{ left: `${band.valuePct}%` }}>
          <span className="interval-marker-dot" />
        </div>
      </div>

      <div className="interval-foot">
        <span className="interval-range">
          {forecast.confidence.interval_pct}% range {forecast.confidence.lower.toFixed(d)}–
          {forecast.confidence.upper.toFixed(d)} {unit}
        </span>
        <span className="interval-block-note">
          block {forecast.block_value.toFixed(d)} {unit}
        </span>
      </div>

      <p className="interval-reading">
        {signal >= 1 ? (
          <>
            <strong>Refined:</strong> this village sits {shiftText}, a shift larger than the
            model&rsquo;s own uncertainty — worth telling farmers about.
          </>
        ) : (
          <>
            <strong>Within noise:</strong> this village is {shiftText}, which is smaller than the
            uncertainty on the estimate. Do not build advice on this difference alone.
          </>
        )}{' '}
        {style.shortLabel}.
      </p>
    </div>
  )
}
