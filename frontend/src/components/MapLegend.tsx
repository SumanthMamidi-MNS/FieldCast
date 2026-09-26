import type { ColorScale } from '../lib/colorScale'
import { SUPPORT_LEVELS, confidenceStyle } from '../lib/confidenceTexture'
import { variableMeta, type VariableKey } from '../lib/variables'
import { TextureSwatch } from './TextureSwatch'

interface MapLegendProps {
  variableKey: VariableKey
  unit: string
  scale: ColorScale
  /** The official block value, marked on the ramp so refinement is readable. */
  blockValue: number
}

/**
 * Two legends, because the map carries two channels.
 *
 * The value ramp answers "how much?". The confidence key answers "how much
 * should I trust it?" — and it is given equal visual weight rather than being
 * demoted to a footnote, because under-trusting a good forecast costs a day
 * while over-trusting a bad one costs a crop.
 */
export function MapLegend({ variableKey, unit, scale, blockValue }: MapLegendProps) {
  const meta = variableMeta(variableKey)
  const samples = scale.samples(24)
  const gradient = `linear-gradient(to right, ${samples.map((s) => s.color).join(', ')})`
  const blockPct = Math.max(0, Math.min(1, scale.normalize(blockValue))) * 100
  const ticks = scale.samples(5)
  const decimals = meta.decimals

  return (
    <div className="legend" aria-label="Map legend">
      <section className="legend-section">
        <h3 className="legend-title">{meta.label}</h3>
        <p className="legend-plain">{meta.plain}</p>

        <div className="legend-ramp-wrap">
          <div className="legend-ramp" style={{ backgroundImage: gradient }} role="img"
            aria-label={`Colour scale from ${ticks[0]?.value.toFixed(decimals)} to ${ticks[
              ticks.length - 1
            ]?.value.toFixed(decimals)} ${unit}`}
          />
          <div className="legend-block-marker" style={{ left: `${blockPct}%` }} aria-hidden>
            <span className="legend-block-tick" />
          </div>
        </div>

        <div className="legend-scale-labels" aria-hidden>
          {ticks.map((t) => (
            <span key={t.t}>{t.value.toFixed(decimals)}</span>
          ))}
        </div>
        <p className="legend-block-note">
          <span className="legend-block-key" aria-hidden />
          Official block forecast: <strong>{blockValue.toFixed(decimals)} {unit}</strong>. Anything
          left or right of this line is the refinement this system added.
        </p>
      </section>

      <section className="legend-section">
        <h3 className="legend-title">How sure are we?</h3>
        <p className="legend-plain">
          The pattern on top of the colour shows how well we know each village — it never changes
          the colour, so it can never be mistaken for a bigger or smaller number.
        </p>
        <ul className="legend-support-list">
          {SUPPORT_LEVELS.map((level) => {
            const style = confidenceStyle(level)
            return (
              <li key={level} className="legend-support-item">
                <TextureSwatch support={level} />
                <span>
                  <strong>{style.shortLabel}</strong>
                  <br />
                  {style.legendExplanation}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
