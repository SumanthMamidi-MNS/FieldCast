import type { VariableForecast } from '../../types/api'
import { computeBasisBand, rangeBasisOf, rangeWording, refinementSignal } from '../../lib/intervalBand'
import { deltaClass, formatDelta, formatNumber, percentOf } from '../../lib/format'
import { blockValueNote, isBlockSourced } from '../../lib/valueSource'
import { variableMeta } from '../../lib/variables'

/** Virtual drawing width; positions are consumed as percentages. */
const VIRTUAL_WIDTH = 1000

/**
 * One variable for one village, drawn on one axis:
 *   shaded band = the 80% range (the honest answer),
 *   dot         = the refined value,
 *   upright tick = the official block value.
 * Rain chance is a separate statement from rain amount, so it gets its own meter.
 *
 * When the value is the official block value (`value_source: "block"`), the
 * dot sits on the block tick by construction, so a "+0.0 / within the
 * uncertainty" verdict would be meaningless: the card says where the number
 * comes from instead.
 *
 * Rain with `range_basis: "if_rain"` reads differently (see `RainIfRainsCard`):
 * its range is the amount on a day it rains, not a range for the served value.
 */
export function VariableCard({ forecast }: { forecast: VariableForecast }) {
  const key = forecast.variable
  const meta = variableMeta(key)
  const unit = forecast.unit
  const c = forecast.confidence
  const basis = rangeBasisOf(forecast)
  if (basis === 'if_rain') return <RainIfRainsCard forecast={forecast} />

  const band = computeBasisBand({
    basis,
    lower: c.lower,
    upper: c.upper,
    value: forecast.value,
    blockValue: forecast.block_value,
    width: VIRTUAL_WIDTH,
    ...(meta.zeroAnchored ? { floor: 0 } : {}),
  })
  const signal = refinementSignal({
    value: forecast.value,
    blockValue: forecast.block_value,
    lower: c.lower,
    upper: c.upper,
  })
  const n = (v: number) => formatNumber(v, key)
  const p = forecast.rain_probability
  const pct = p === null ? null : percentOf(p)
  const fromBlock = isBlockSourced(forecast)
  const wording = rangeWording(basis, n(c.lower), n(c.upper), unit)

  const summary =
    `${forecast.label}: ${n(forecast.value)} ${unit}, ${wording.spoken}. ` +
    (fromBlock
      ? 'This is the official block forecast.'
      : `Block forecast ${n(forecast.block_value)} ${unit}.`)

  return (
    <article className="var-card">
      <header className="var-card-head">
        <h4 className="var-card-label">{forecast.label}</h4>
        <p className="var-card-value">
          <span className="num">{n(forecast.value)}</span>
          <span className="var-card-unit">{unit}</span>
        </p>
        {fromBlock ? (
          <span className="source-tag">Block value</span>
        ) : (
          <span
            className={`delta num${deltaClass(forecast.value, forecast.block_value, key)}`}
            title="Difference from the block forecast"
          >
            {formatDelta(forecast.value, forecast.block_value, key, unit)}
            <span className="visually-hidden"> compared with the block forecast</span>
          </span>
        )}
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
        <span>{wording.foot}</span>
        <span className="band-foot-block">
          <span className="band-block-key" aria-hidden /> Block {n(forecast.block_value)}
        </span>
      </p>
      {fromBlock ? (
        <p className="var-card-source">{blockValueNote(pct !== null)}</p>
      ) : (
        <p className="var-card-read">
          {signal >= 1
            ? 'Clear local difference: bigger than the uncertainty.'
            : 'Within the uncertainty: treat as the same as the block.'}
        </p>
      )}
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
            {fromBlock
              ? 'This chance is specific to this panchayat and decides spraying and harvest. The amount above, the block forecast, decides irrigation.'
              : 'Chance of rain decides spraying and harvest. The amount above decides irrigation.'}
          </p>
        </div>
      )}
    </article>
  )
}

/**
 * Rain whose range is "if it rains" (`range_basis: "if_rain"`): two linked
 * statements, the chance of rain and then the amount on a day it rains. The
 * band is that if-it-rains range; the block amount is a labelled reference
 * tick only. No value dot, and no "inside / outside the range" verdict: on a
 * low-chance day the served block amount can sit below a range it was never
 * part of.
 */
function RainIfRainsCard({ forecast }: { forecast: VariableForecast }) {
  const key = forecast.variable
  const unit = forecast.unit
  const c = forecast.confidence
  const n = (v: number) => formatNumber(v, key)
  const band = computeBasisBand({
    basis: 'if_rain',
    lower: c.lower,
    upper: c.upper,
    value: forecast.value,
    blockValue: forecast.block_value,
    width: VIRTUAL_WIDTH,
    floor: 0,
  })
  const wording = rangeWording('if_rain', n(c.lower), n(c.upper), unit)
  const p = forecast.rain_probability
  const pct = p === null ? null : percentOf(p)
  const fromBlock = isBlockSourced(forecast)

  const bandLabel =
    `${wording.spoken}. ` +
    `Block forecast ${n(forecast.block_value)} ${unit}, marked for reference.`

  return (
    <article className="var-card var-card-rain">
      <header className="var-card-head">
        <h4 className="var-card-label">{forecast.label}</h4>
        <p className="var-card-value">
          <span className="num">{n(forecast.value)}</span>
          <span className="var-card-unit">{unit}</span>
        </p>
        {fromBlock ? (
          <span className="source-tag">Block value</span>
        ) : (
          <span
            className={`delta num${deltaClass(forecast.value, forecast.block_value, key)}`}
            title="Difference from the block forecast"
          >
            {formatDelta(forecast.value, forecast.block_value, key, unit)}
            <span className="visually-hidden"> compared with the block forecast</span>
          </span>
        )}
      </header>

      <div className="rain-statements">
        {pct !== null && (
          <div className="rain-stmt">
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
          </div>
        )}

        <div className="rain-stmt rain-stmt-amount">
          <p className="rain-if-text">
            <strong>If it rains:</strong> about{' '}
            <span className="num rain-if-range">
              {n(c.lower)}–{n(c.upper)} {unit}
            </span>{' '}
            <span className="rain-if-cov">(8 days in 10)</span>
          </p>
          <div className="band" role="img" aria-label={bandLabel}>
            <span className="band-rail" />
            <span
              className={`band-range sup-${c.support}`}
              style={{ left: `${band.bandStartPct}%`, width: `${band.bandWidthPct}%` }}
            />
            <span className="band-block" style={{ left: `${band.blockPct}%` }} />
          </div>
          <p className="band-foot num">
            <span className="band-foot-block">
              <span className="band-block-key" aria-hidden /> block forecast {n(forecast.block_value)} {unit}
            </span>
          </p>
        </div>
      </div>

      {fromBlock && <p className="var-card-source">{blockValueNote(pct !== null, true)}</p>}
      <p className="rain-chance-help">
        {fromBlock
          ? 'This chance is specific to this panchayat and decides spraying and harvest. The amount above, the block forecast, decides irrigation.'
          : 'Chance of rain decides spraying and harvest. The amount above decides irrigation.'}
      </p>
    </article>
  )
}
