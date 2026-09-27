import { forwardRef } from 'react'
import type { PanchayatForecast } from '../../types/api'
import type { ColorScale } from '../../lib/colorScale'
import { deltaClass, formatDelta, formatPercent, formatValue } from '../../lib/format'
import { chancePct, formatMetric, isBlockSourced, type MapMetric } from '../../lib/valueSource'
import type { VariableKey } from '../../lib/variables'
import { SupportChip } from '../common/TextureSwatch'
import { UnitTag } from '../common/UnitTag'

interface MapTooltipProps {
  forecast: PanchayatForecast | null
  variableKey: VariableKey
  scale: ColorScale
  metric: MapMetric
}

/**
 * Hover card. Positioned imperatively by MapView (via the forwarded ref) so a
 * mouse move never re-renders React; content changes only when the hovered
 * panchayat changes. Pointer-only and aria-hidden: keyboard and screen-reader
 * users get the same facts from the panchayat list.
 */
export const MapTooltip = forwardRef<HTMLDivElement, MapTooltipProps>(function MapTooltip(
  { forecast, variableKey, scale, metric },
  ref,
) {
  const v = forecast?.variables[variableKey]
  return (
    <div ref={ref} className={`map-tooltip${forecast ? ' is-on' : ''}`} aria-hidden>
      {forecast && (
        <>
          <p className="map-tooltip-name">
            {forecast.panchayat_name} <UnitTag unitType={forecast.unit_type} />
          </p>
          {v && metric === 'chance' ? (
            <>
              <p className="map-tooltip-value">
                <span className="swatch-dot" style={{ background: scale.color(chancePct(v)) }} />
                <strong className="num">{formatMetric(chancePct(v), variableKey, 'chance')}</strong>
                <span className="map-tooltip-unit">chance of rain</span>
              </p>
              <p className="map-tooltip-sub num">
                Amount {formatValue(v.value, variableKey, v.unit)}, the block forecast
              </p>
              <SupportChip support={v.confidence.support} label={v.confidence.support_label} />
            </>
          ) : v ? (
            <>
              <p className="map-tooltip-value">
                <span className="swatch-dot" style={{ background: scale.color(v.value) }} />
                <strong className="num">{formatValue(v.value, variableKey, v.unit)}</strong>
                {isBlockSourced(v) ? (
                  <span className="map-tooltip-unit">block value</span>
                ) : (
                  <span className={`delta num${deltaClass(v.value, v.block_value, variableKey)}`}>
                    {formatDelta(v.value, v.block_value, variableKey, v.unit)} vs block
                  </span>
                )}
              </p>
              {v.rain_probability !== null && (
                <p className="map-tooltip-sub num">{formatPercent(v.rain_probability)} chance of rain</p>
              )}
              <SupportChip support={v.confidence.support} label={v.confidence.support_label} />
            </>
          ) : (
            <p className="map-tooltip-sub">No forecast for this panchayat.</p>
          )}
          <p className="map-tooltip-hint">Click for advice</p>
        </>
      )}
    </div>
  )
})
