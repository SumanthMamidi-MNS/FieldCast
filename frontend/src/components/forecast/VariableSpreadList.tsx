import type { VariableStats } from '../../lib/blockSummary'
import type { BlockScale } from '../../lib/mapScale'
import { formatNumber } from '../../lib/format'
import { variableMeta, type VariableKey } from '../../lib/variables'

interface VariableSpreadListProps {
  stats: VariableStats[]
  scales: Partial<Record<VariableKey, BlockScale>>
  active: VariableKey
  onPick: (key: VariableKey) => void
}

/**
 * One row per variable: the official block value, the range the panchayats
 * actually span, and a tiny bar on the same block-relative scale the map uses.
 * Each row switches the map to that variable.
 */
export function VariableSpreadList({ stats, scales, active, onPick }: VariableSpreadListProps) {
  return (
    <ul className="spread-list" aria-label="Block forecast and gram panchayat range, by variable">
      {stats.map((s) => {
        const bs = scales[s.key]
        const meta = variableMeta(s.key)
        const pos = (v: number) => (bs ? bs.scale.normalize(v) * 100 : 50)
        const lo = pos(s.min)
        const hi = pos(s.max)
        const isActive = s.key === active
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
              <span className="spread-bar" aria-hidden>
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
              </span>
              <span className="spread-range num">
                {formatNumber(s.min, s.key)}–{formatNumber(s.max, s.key)}
              </span>
              <span className="visually-hidden">
                {`${meta.label}: block forecast ${formatNumber(s.block, s.key)} ${s.unit}; gram panchayats range from ${formatNumber(s.min, s.key)} to ${formatNumber(s.max, s.key)} ${s.unit}.${isActive ? ' Shown on the map.' : ' Show on the map.'}`}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
