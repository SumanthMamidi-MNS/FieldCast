import type { BaselineComparison, BlockForecastResponse } from '../types/api'
import type { ColorScale } from '../lib/colorScale'
import { formatValue, variableMeta, type VariableKey } from '../lib/variables'
import { SkeletonText } from './Skeleton'
import { SkillTable } from './SkillTable'
import { SpreadChart } from './SpreadChart'

interface ComparisonViewProps {
  forecast: BlockForecastResponse
  baselines: BaselineComparison[]
  baselinesLoading: boolean
  /** Set when /api/evaluation fails — 404 until the evaluation has been run. */
  baselinesError: string | null
  variableKey: VariableKey
  scale: ColorScale
  selectedId: string | null
  onSelect: (panchayatId: string) => void
}

/**
 * "Why not just use the block value?"
 *
 * The screen that has to earn the whole project. It answers in two steps:
 *
 *   1. Here is how much villages inside this one block actually differ today.
 *   2. Here is whether that difference is closer to the truth than the block
 *      value was — measured at real gauges, including where we lose.
 *
 * Step 1 without step 2 is just a prettier map. Step 2 is the argument.
 */
export function ComparisonView({
  forecast,
  baselines,
  baselinesLoading,
  baselinesError,
  variableKey,
  scale,
  selectedId,
  onSelect,
}: ComparisonViewProps) {
  const meta = variableMeta(variableKey)
  const sample = forecast.panchayats[0]?.variables[variableKey]
  const unit = sample?.unit ?? meta.fallbackUnit
  const blockValue = sample?.block_value ?? 0
  const spread = forecast.differentiation.variable_spread[variableKey] ?? 0

  const values = forecast.panchayats
    .map((p) => p.variables[variableKey]?.value)
    .filter((v): v is number => v !== undefined && Number.isFinite(v))
  const lowest = values.length > 0 ? Math.min(...values) : Number.NaN
  const highest = values.length > 0 ? Math.max(...values) : Number.NaN
  const ratio = lowest > 0 ? highest / lowest : Number.NaN

  return (
    <div className="comparison">
      <section className="comparison-lede">
        <h2 className="comparison-title">Why not just use the block value?</h2>
        <p className="comparison-sub">
          {forecast.block_name} block gets one official {meta.label.toLowerCase()} figure today:{' '}
          <strong>
            {blockValue.toFixed(meta.decimals)} {unit}
          </strong>
          . Here is what that single number is being asked to cover.
        </p>

        <ul className="comparison-stats">
          <li>
            <span className="stat-value">{formatValue(highest, variableKey, unit)}</span>
            <span className="stat-label">wettest / highest village</span>
          </li>
          <li>
            <span className="stat-value">{formatValue(lowest, variableKey, unit)}</span>
            <span className="stat-label">driest / lowest village</span>
          </li>
          <li>
            <span className="stat-value">
              {spread.toFixed(meta.decimals)} {unit}
            </span>
            <span className="stat-label">spread inside one block</span>
          </li>
          {Number.isFinite(ratio) && meta.zeroAnchored && (
            <li>
              <span className="stat-value">{ratio.toFixed(1)}×</span>
              <span className="stat-label">highest over lowest</span>
            </li>
          )}
        </ul>

        <p
          className={`comparison-note${forecast.differentiation.meaningful ? '' : ' is-flat'}`}
          role="status"
        >
          {forecast.differentiation.note}
        </p>
      </section>

      <section className="comparison-section" aria-labelledby="spread-heading">
        <h3 id="spread-heading" className="comparison-section-title">
          1. How much villages differ today
        </h3>
        <SpreadChart
          forecasts={forecast.panchayats}
          variableKey={variableKey}
          scale={scale}
          unit={unit}
          blockValue={blockValue}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      </section>

      <section className="comparison-section" aria-labelledby="skill-heading">
        <h3 id="skill-heading" className="comparison-section-title">
          2. Is the refined number actually closer to the truth?
        </h3>
        <p className="comparison-section-help">
          Measured against real rain-gauge and reanalysis records. Lower error is better. The naive
          bar is what you get by copying the block value to every village — the thing this system
          has to beat to be worth running.
        </p>
        {baselinesLoading ? (
          <SkeletonText lines={6} />
        ) : baselinesError || baselines.length === 0 ? (
          <div className="eval-pending" role="status">
            <p className="eval-pending-title">Evaluation not yet available</p>
            <p>
              The comparison against real gauge records has not been run for this region yet, so
              there is no measured proof to show here. Until it is, treat every village value as
              unverified: the spread above shows what the model <em>claims</em>, not that the claim
              is right.
            </p>
          </div>
        ) : (
          <SkillTable rows={baselines} />
        )}
      </section>

      <p className="comparison-caveat">
        Note the gap in the evidence: these numbers are measured at ~9 km reanalysis cells (T1) and
        at real gauges (T2). Village-scale output is <strong>T3</strong> — there is no
        village-scale ground truth in India to check it against, so it is inference guided by
        terrain physics, not a measured result. This dashboard labels every number with which of
        those it is.
      </p>
    </div>
  )
}
