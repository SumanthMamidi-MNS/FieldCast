import type { VariableStats } from '../../lib/blockSummary'
import type { BlockScale } from '../../lib/mapScale'
import { fixed, formatNumber } from '../../lib/format'
import { variableMeta, type VariableKey } from '../../lib/variables'

interface VariableSpreadListProps {
  stats: VariableStats[]
  scales: Partial<Record<VariableKey, BlockScale>>
  active: VariableKey
  onPick: (key: VariableKey) => void
}

const pctText = (v: number) => `${fixed(v, 0)}%`

/**
 * One row per variable: the official block value, the range the panchayats
 * actually span, and a tiny bar on the same block-relative scale the map uses.
 * Each row switches the map to that variable.
 *
 * When a variable's point value is the official block value, the panchayats
 * all share it: the row says "same across panchayats" instead of drawing a
 * range, except rain, which shows the rain-chance range the map is painting.
 */
export function VariableSpreadList({ stats, scales, active, onPick }: VariableSpreadListProps) {
  return (
    <ul className="spread-list" aria-label="Block forecast and gram panchayat range, by variable">
      {stats.map((s) => {
        const bs = scales[s.key]
        const meta = variableMeta(s.key)
        const pos = (v: number) => (bs ? bs.scale.normalize(v) * 100 : 50)
        const isActive = s.key === active
        const blockText = `${formatNumber(s.block, s.key)} ${s.unit}`

        let bar: React.ReactNode
        let range: React.ReactNode
        let spoken: string
        if (s.mode === 'chance') {
          const lo = pos(s.chanceMin)
          const hi = pos(s.chanceMax)
          const oneValue = pctText(s.chanceMin) === pctText(s.chanceMax)
          bar = (
            <span
              className="spread-seg"
              style={{
                left: `${lo}%`,
                width: `${Math.max(hi - lo, 1.5)}%`,
                background: bs
                  ? `linear-gradient(to right, ${bs.scale.color(s.chanceMin)}, ${bs.scale.color(s.chanceMax)})`
                  : undefined,
              }}
            />
          )
          range = (
            <span className="spread-range num is-chance">
              {oneValue ? pctText(s.chanceMin) : `${pctText(s.chanceMin)}–${pctText(s.chanceMax)}`}
              <span className="spread-range-note">chance</span>
            </span>
          )
          spoken = `${meta.label}: block forecast ${blockText}, the same in every gram panchayat. ${
            oneValue
              ? `Chance of rain is ${pctText(s.chanceMin)} in every gram panchayat.`
              : `Chance of rain ranges from ${pctText(s.chanceMin)} to ${pctText(s.chanceMax)}.`
          }`
        } else if (s.mode === 'same') {
          bar = <span className="spread-tick" style={{ left: '50%' }} />
          range = <span className="spread-range is-same">same across panchayats</span>
          spoken = `${meta.label}: block forecast ${blockText}, shown the same in every gram panchayat.`
        } else {
          const lo = pos(s.min)
          const hi = pos(s.max)
          bar = (
            <>
              <span
                className="spread-seg"
                style={{
                  left: `${lo}%`,
                  width: `${Math.max(hi - lo, 1.5)}%`,
                  background: bs
                    ? `linear-gradient(to right, ${bs.scale.color(s.min)}, ${bs.scale.color(s.max)})`
                    : undefined,
                }}
              />
              <span className="spread-tick" style={{ left: `${pos(s.block)}%` }} />
            </>
          )
          range = (
            <span className="spread-range num">
              {formatNumber(s.min, s.key)}–{formatNumber(s.max, s.key)}
            </span>
          )
          spoken = `${meta.label}: block forecast ${blockText}; gram panchayats range from ${formatNumber(s.min, s.key)} to ${formatNumber(s.max, s.key)} ${s.unit}.`
        }

        return (
          <li key={s.key}>
            <button
              type="button"
              className={`spread-row${isActive ? ' is-active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onPick(s.key)}
            >
              <span className="spread-label">{meta.shortLabel}</span>
              <span className="spread-block num">
                {formatNumber(s.block, s.key)}
                <span className="spread-unit">{s.unit}</span>
              </span>
              <span className={`spread-bar${s.mode === 'same' ? ' is-same' : ''}`} aria-hidden>
                {bar}
              </span>
              {range}
              <span className="visually-hidden">
                {`${spoken}${isActive ? ' Shown on the map.' : ' Show on the map.'}`}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
