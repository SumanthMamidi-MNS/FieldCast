import type { PanchayatForecast } from '../types/api'
import type { ColorScale } from '../lib/colorScale'
import { confidenceStyle } from '../lib/confidenceTexture'
import { variableMeta, type VariableKey } from '../lib/variables'

interface SpreadChartProps {
  forecasts: PanchayatForecast[]
  variableKey: VariableKey
  scale: ColorScale
  unit: string
  blockValue: number
  onSelect: (panchayatId: string) => void
  selectedId: string | null
}

const ROW_H = 34
const PAD_TOP = 26
const PAD_BOTTOM = 30
const LABEL_W = 116
const VALUE_W = 74

/**
 * The spread chart: one row per panchayat, each drawn as a leader line from the
 * official block value to its own downscaled value.
 *
 * A grouped bar chart would show the same numbers and none of the argument. What
 * matters is the *distance travelled* from the single block figure, so distance
 * is what gets drawn: a dashed vertical rule for the block value, and a line
 * whose length is the refinement. The 80% interval is drawn behind each marker,
 * so a long line with a wide band reads honestly as "big claim, loosely held".
 */
export function SpreadChart({
  forecasts,
  variableKey,
  scale,
  unit,
  blockValue,
  onSelect,
  selectedId,
}: SpreadChartProps) {
  const meta = variableMeta(variableKey)
  const rows = [...forecasts].sort((a, b) => {
    const av = a.variables[variableKey]?.value ?? 0
    const bv = b.variables[variableKey]?.value ?? 0
    return bv - av
  })

  const values: number[] = [blockValue]
  for (const f of rows) {
    const v = f.variables[variableKey]
    if (!v) continue
    values.push(v.value, v.confidence.lower, v.confidence.upper)
  }
  const finite = values.filter((v) => Number.isFinite(v))
  let min = finite.length > 0 ? Math.min(...finite) : 0
  let max = finite.length > 0 ? Math.max(...finite) : 1
  if (max - min < 1e-9) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.08
  min = meta.zeroAnchored ? Math.max(0, min - pad) : min - pad
  max = max + pad

  const width = 760
  const plotLeft = LABEL_W
  const plotRight = width - VALUE_W
  const plotW = plotRight - plotLeft
  const height = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM
  const x = (v: number) => plotLeft + ((v - min) / (max - min)) * plotW
  const blockX = x(blockValue)
  const d = meta.decimals

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min))

  return (
    <figure className="spread-figure">
      <figcaption className="spread-caption">
        Every village in this block, against the one number the official forecast gives them all.
      </figcaption>

      <svg
        className="spread-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${meta.label} for ${rows.length} panchayats compared with the block value of ${blockValue.toFixed(d)} ${unit}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={PAD_TOP - 8}
              y2={height - PAD_BOTTOM + 4}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text
              x={x(t)}
              y={height - PAD_BOTTOM + 20}
              textAnchor="middle"
              className="spread-tick-label"
            >
              {t.toFixed(d)}
            </text>
          </g>
        ))}

        {/* The block value: one dashed rule the whole block is told to share. */}
        <line
          x1={blockX}
          x2={blockX}
          y1={PAD_TOP - 14}
          y2={height - PAD_BOTTOM + 4}
          stroke="var(--ink)"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
        <text x={blockX} y={PAD_TOP - 18} textAnchor="middle" className="spread-block-label">
          block forecast {blockValue.toFixed(d)} {unit}
        </text>

        {rows.map((forecast, i) => {
          const variable = forecast.variables[variableKey]
          if (!variable) return null
          const y = PAD_TOP + i * ROW_H + ROW_H / 2
          const vx = x(variable.value)
          const lo = x(variable.confidence.lower)
          const hi = x(variable.confidence.upper)
          const style = confidenceStyle(variable.confidence.support)
          const selected = forecast.panchayat_id === selectedId
          const fill = scale.color(variable.value)

          return (
            <g
              key={forecast.panchayat_id}
              className={`spread-row${selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(forecast.panchayat_id)}
            >
              <rect
                x={0}
                y={y - ROW_H / 2}
                width={width}
                height={ROW_H}
                fill={selected ? 'var(--accent-wash)' : 'transparent'}
              />
              <text x={0} y={y + 4} className="spread-name">
                {forecast.panchayat_name}
              </text>

              {/* 80% interval, behind everything else. */}
              <line
                x1={lo}
                x2={hi}
                y1={y}
                y2={y}
                stroke="var(--line-strong)"
                strokeWidth="7"
                strokeLinecap="round"
                opacity="0.45"
              />
              {/* The refinement itself: block value → downscaled value. */}
              <line
                x1={blockX}
                x2={vx}
                y1={y}
                y2={y}
                stroke="var(--ink-muted)"
                strokeWidth="2"
              />
              <circle
                cx={vx}
                cy={y}
                r={selected ? 8 : 6.5}
                fill={fill}
                stroke={style.outlineDash ? 'var(--support-low)' : 'var(--ink)'}
                strokeWidth={style.outlineDash ? 2.4 : 1.4}
                strokeDasharray={style.outlineDash ? '3 2' : undefined}
              />
              <text x={width - VALUE_W + 8} y={y + 4} className="spread-value">
                {variable.value.toFixed(d)} {unit}
              </text>
            </g>
          )
        })}
      </svg>

      <p className="spread-key">
        <span className="spread-key-item">
          <svg width="26" height="12" aria-hidden>
            <line x1="1" x2="25" y1="6" y2="6" stroke="var(--line-strong)" strokeWidth="7" opacity="0.45" strokeLinecap="round" />
          </svg>
          80% range
        </span>
        <span className="spread-key-item">
          <svg width="26" height="12" aria-hidden>
            <circle cx="13" cy="6" r="5" fill="#5ea5cd" stroke="var(--support-low)" strokeWidth="2.2" strokeDasharray="3 2" />
          </svg>
          dashed ring = low support
        </span>
      </p>
    </figure>
  )
}
