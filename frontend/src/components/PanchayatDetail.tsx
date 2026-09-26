import { useEffect, useRef } from 'react'
import type { PanchayatForecast } from '../types/api'
import { VARIABLE_ORDER } from '../lib/variables'
import { AdvisoryList } from './AdvisoryList'
import { IntervalBand } from './IntervalBand'
import { RainProbability } from './RainProbability'
import { SupportChip } from './TextureSwatch'
import { TierBadge } from './TierBadge'

interface PanchayatDetailProps {
  forecast: PanchayatForecast | null
  onClose: () => void
}

/**
 * The panel an officer actually reads before speaking to a village.
 *
 * Order is deliberate and matches `advisory.py`'s own reasoning: headline, then
 * the uncertainty statement (never collapsed, never behind "more info"), then
 * the rain split, then per-variable bands, then the actions.
 *
 * The uncertainty statement sits *above* the recommendations on purpose. Put it
 * underneath and it becomes a disclaimer nobody reads; put it above and it
 * frames everything that follows, which is what PRD §7 asks for.
 */
export function PanchayatDetail({ forecast, onClose }: PanchayatDetailProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (forecast) headingRef.current?.focus()
  }, [forecast?.panchayat_id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!forecast) {
    return (
      <aside className="detail detail-empty" aria-labelledby="detail-empty-heading">
        <h2 id="detail-empty-heading" className="detail-empty-title">
          Pick a village
        </h2>
        <p className="detail-empty-text">
          Select a panchayat on the map, or from the list, to see its forecast, how confident we
          are, and what to advise.
        </p>
      </aside>
    )
  }

  const precip = forecast.variables.precip
  const anyVariable = precip ?? Object.values(forecast.variables)[0]
  const confidence = anyVariable?.confidence

  const variables = VARIABLE_ORDER.map((key) => forecast.variables[key]).filter(
    (v): v is NonNullable<typeof v> => v !== undefined,
  )

  return (
    <aside className="detail" aria-labelledby="detail-heading">
      <header className="detail-header">
        <div>
          <p className="detail-eyebrow">
            {forecast.block_name} block · {forecast.elevation_m} m · {forecast.area_km2} km²
          </p>
          <h2 id="detail-heading" className="detail-title" tabIndex={-1} ref={headingRef}>
            {forecast.panchayat_name}
          </h2>
        </div>
        <button type="button" className="detail-close" onClick={onClose}>
          <span aria-hidden>×</span>
          <span className="visually-hidden">Close {forecast.panchayat_name} details</span>
        </button>
      </header>

      <p className="detail-headline">{forecast.advisory.headline}</p>

      {confidence && (
        <div className="detail-confidence">
          <div className="detail-confidence-row">
            <SupportChip support={confidence.support} label={confidence.support_label} />
            <TierBadge tier={confidence.tier} note={confidence.tier_note} />
          </div>
          <p className="detail-uncertainty">{forecast.advisory.uncertainty_statement}</p>
          {confidence.nearest_gauge_km !== null && (
            <p className="detail-gauge">
              Nearest real weather station: <strong>{confidence.nearest_gauge_km} km</strong> away.
            </p>
          )}
        </div>
      )}

      {precip && <RainProbability precip={precip} />}

      <section className="detail-section" aria-labelledby="detail-variables-heading">
        <h3 id="detail-variables-heading" className="detail-section-title">
          Each variable, with its range
        </h3>
        <p className="detail-section-help">
          The shaded bar is the range the value could plausibly fall in. The upright tick is the
          official block forecast, on the same scale — the gap between them is what downscaling
          added.
        </p>
        <div className="detail-intervals">
          {variables.map((variable) => (
            <IntervalBand key={variable.variable} forecast={variable} />
          ))}
        </div>
      </section>

      <section className="detail-section" aria-labelledby="detail-advisory-heading">
        <h3 id="detail-advisory-heading" className="detail-section-title">
          What to advise
        </h3>
        <AdvisoryList items={forecast.advisory.items} />
      </section>
    </aside>
  )
}
