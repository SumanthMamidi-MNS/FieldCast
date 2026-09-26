import { useId, useState } from 'react'
import type { ColorScale, RelativeDomain } from '../../lib/colorScale'
import { SUPPORT_LEVELS, confidenceStyle } from '../../lib/confidenceTexture'
import { formatNumber, variableMeta, type VariableKey } from '../../lib/variables'
import { Icon } from '../common/Icon'
import { TextureSwatch } from '../common/TextureSwatch'

interface MapLegendProps {
  variableKey: VariableKey
  unit: string
  scale: ColorScale
  domain: RelativeDomain
  defaultOpen: boolean
}

const SUPPORT_SHORT = { high: 'Well supported', medium: 'Moderate', low: 'Low' } as const

/**
 * Two keys in one card, because the map carries two channels: colour answers
 * "how much, compared with the block forecast?", texture answers "how sure?".
 * The block value sits on the ramp, and the real lowest and highest villages
 * are marked, so the scale is never mistaken for the data's range.
 */
export function MapLegend({ variableKey, unit, scale, domain, defaultOpen }: MapLegendProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const meta = variableMeta(variableKey)
  const gradient = `linear-gradient(to right, ${scale
    .samples(16)
    .map((s) => s.color)
    .join(', ')})`
  const pct = (v: number) => `${(scale.normalize(v) * 100).toFixed(2)}%`
  const hasData = Number.isFinite(domain.dataMin) && Number.isFinite(domain.dataMax)
  const n = (v: number) => formatNumber(v, variableKey)

  return (
    <section className={`legend${open ? ' is-open' : ''}`} aria-label="Map legend">
      <button
        type="button"
        className="legend-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="legend-toggle-title">
          {meta.label} <span className="legend-unit">({unit})</span>
        </span>
        <Icon name="chevron-down" size={16} className={open ? 'is-flipped' : undefined} />
      </button>

      <div id={bodyId} className="legend-body" hidden={!open}>
        <p className="legend-plain">{meta.plain}</p>

        <div
          className="legend-ramp-wrap"
          role="img"
          aria-label={
            hasData
              ? `Colour scale. Block forecast ${n(domain.block)} ${unit}. Villages range from ${n(domain.dataMin)} to ${n(domain.dataMax)} ${unit}.`
              : `Colour scale centred on the block forecast of ${n(domain.block)} ${unit}.`
          }
        >
          <div className="legend-ramp" style={{ backgroundImage: gradient }} />
          {hasData && (
            <>
              <span className="legend-mark is-data" style={{ left: pct(domain.dataMin) }} />
              <span className="legend-mark is-data" style={{ left: pct(domain.dataMax) }} />
            </>
          )}
          <span className="legend-mark is-block" style={{ left: pct(domain.block) }} />
        </div>
        <div className="legend-ends" aria-hidden>
          <span>{meta.ends[0]}</span>
          <span>{meta.ends[1]}</span>
        </div>

        <dl className="legend-stats">
          <div>
            <dt>Lowest</dt>
            <dd className="num">{hasData ? n(domain.dataMin) : '—'}</dd>
          </div>
          <div className="is-block">
            <dt>
              <span className="legend-block-key" aria-hidden /> Block
            </dt>
            <dd className="num">{n(domain.block)}</dd>
          </div>
          <div>
            <dt>Highest</dt>
            <dd className="num">{hasData ? n(domain.dataMax) : '—'}</dd>
          </div>
        </dl>

        <div className="legend-conf">
          <p className="legend-conf-title">Pattern = how sure we are</p>
          <ul className="legend-conf-list">
            {SUPPORT_LEVELS.map((level) => (
              <li key={level} title={confidenceStyle(level).legendExplanation}>
                <TextureSwatch support={level} size={16} />
                <span>{SUPPORT_SHORT[level]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
