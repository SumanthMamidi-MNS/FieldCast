import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BaselineComparison } from '../types/api'
import { TierBadge } from './TierBadge'

interface SkillTableProps {
  rows: BaselineComparison[]
}

const MODEL_FILL = '#0f4c8a'
const NAIVE_FILL = '#97a3b0'

/**
 * Model error against the naive "copy the block value everywhere" baseline —
 * PRD §9's actual proof.
 *
 * Two things this deliberately does not do: it does not hide the rows where we
 * lose, and it does not lead with the skill score. Error in real units is what
 * an extension officer can reason about ("we are 2.6 mm closer"); the skill
 * score is the derived number, so it comes second.
 */
// One group per (region, tier): the backend returns T1 and T2 rows for the
// same region, and mixing them would put two "Rainfall" bars side by side.
const groupKey = (r: BaselineComparison) => `${r.region} · ${r.tier}`

function groupLabel(key: string): string {
  const [regionKey, tier] = key.split(' · ')
  const where = tier === 'T2' ? 'real rain gauges' : tier === 'T1' ? '~9 km reanalysis grid' : tier
  return `${where} (${regionKey})`
}

export function SkillTable({ rows }: SkillTableProps) {
  const regions = useMemo(() => {
    const keys = [...new Set(rows.map(groupKey))]
    // T2 first: real gauges are the PRD's actual proof.
    return keys.sort((a, b) => (a.endsWith('T2') === b.endsWith('T2') ? a.localeCompare(b) : a.endsWith('T2') ? -1 : 1))
  }, [rows])
  const [chosen, setRegion] = useState<string>('')
  const region = regions.includes(chosen) ? chosen : (regions[0] ?? '')

  const active = rows.filter((r) => groupKey(r) === region)
  const chartData = active.map((r) => ({
    name: r.label,
    unit: r.unit,
    model: r.model_mae,
    naive: r.naive_mae,
    beaten: r.skill_score > 0,
  }))

  const losses = active.filter((r) => r.skill_score <= 0)

  return (
    <div className="skill">
      <div className="skill-controls">
        <fieldset className="region-filter">
          <legend className="field-label">Measured on</legend>
          <div className="region-options">
            {regions.map((r) => (
              <label key={r} className={`region-option${r === region ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="skill-region"
                  value={r}
                  checked={r === region}
                  onChange={() => setRegion(r)}
                />
                <span>{groupLabel(r)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="skill-chart" aria-hidden>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#cdd5de" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#4a5560' }} interval={0} height={48} />
            <YAxis
              tick={{ fontSize: 12, fill: '#4a5560' }}
              label={{
                value: 'Average error (own units)',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 12, fill: '#4a5560' },
              }}
            />
            <Tooltip
              formatter={(value, name) => [
                typeof value === 'number' ? value.toFixed(2) : String(value ?? '—'),
                String(name ?? ''),
              ]}
              contentStyle={{ fontSize: 13, borderRadius: 8, borderColor: '#cdd5de' }}
            />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <Bar dataKey="naive" name="Block value copied (naive)" fill={NAIVE_FILL} radius={[3, 3, 0, 0]} />
            <Bar dataKey="model" name="Downscaled (this system)" radius={[3, 3, 0, 0]}>
              {chartData.map((d) => (
                <Cell key={d.name} fill={d.beaten ? MODEL_FILL : '#a01722'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table className="skill-table">
        <caption className="visually-hidden">
          Model error versus the naive block-copy baseline, by variable, for {region}
        </caption>
        <thead>
          <tr>
            <th scope="col">Variable</th>
            <th scope="col">Naive error</th>
            <th scope="col">Our error</th>
            <th scope="col">Improvement</th>
            <th scope="col">80% range actually covers</th>
            <th scope="col">Checked against</th>
          </tr>
        </thead>
        <tbody>
          {active.map((r) => {
            const won = r.skill_score > 0
            return (
              <tr key={`${r.region}-${r.variable}-${r.tier}`} className={won ? '' : 'is-loss'}>
                <th scope="row">{r.label}</th>
                <td>
                  {r.naive_mae.toFixed(2)} {r.unit}
                </td>
                <td>
                  <strong>
                    {r.model_mae.toFixed(2)} {r.unit}
                  </strong>
                </td>
                <td className={won ? 'skill-win' : 'skill-loss'}>
                  {won ? '▲' : '▼'} {(Math.abs(r.skill_score) * 100).toFixed(1)}%{' '}
                  <span className="visually-hidden">{won ? 'better than' : 'worse than'} naive</span>
                </td>
                <td>
                  {(r.interval_coverage * 100).toFixed(0)}%
                  <span className="skill-target"> (target 80%)</span>
                </td>
                <td>
                  <TierBadge tier={r.tier} size="sm" />{' '}
                  <span className="skill-n">{r.n_observations.toLocaleString()} obs</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {losses.length > 0 && (
        <p className="skill-honest">
          <strong>Where we do not win:</strong>{' '}
          {losses.map((l) => l.label.toLowerCase()).join(', ')} — the naive block value is as good
          or better here. That is reported rather than hidden; use the block figure for those
          variables.
        </p>
      )}
      <p className="skill-note">
        &ldquo;80% range actually covers&rdquo; is the calibration check: if our stated 80% range
        only contained the truth 60% of the time, the model would be overconfident and the
        improvement column would not matter.
      </p>
    </div>
  )
}
