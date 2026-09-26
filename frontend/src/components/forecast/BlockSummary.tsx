import { useMemo } from 'react'
import type { BlockForecastResponse } from '../../types/api'
import {
  allVariableStats,
  describeSupportCounts,
  humaniseNote,
  rollupAdvice,
  supportCounts,
} from '../../lib/blockSummary'
import type { ColorScale } from '../../lib/colorScale'
import { formatLongDate } from '../../lib/dates'
import type { BlockScale } from '../../lib/mapScale'
import { variableMeta, type VariableKey } from '../../lib/variables'
import { TextureSwatch } from '../common/TextureSwatch'
import { AdviceRollup } from './AdviceRollup'
import { VariableSpreadList } from './VariableSpreadList'
import { VillageList } from './VillageList'

interface BlockSummaryProps {
  forecast: BlockForecastResponse
  sourceLabel: string
  variableKey: VariableKey
  onVariable: (key: VariableKey) => void
  scales: Partial<Record<VariableKey, BlockScale>>
  scale: ColorScale
  selectedId: string | null
  onSelect: (id: string) => void
}

const SUPPORT_WORD = { high: 'well supported', medium: 'moderate', low: 'low' } as const

/** The sidebar's default view: the whole block at a glance, then every village. */
export function BlockSummary({
  forecast,
  sourceLabel,
  variableKey,
  onVariable,
  scales,
  scale,
  selectedId,
  onSelect,
}: BlockSummaryProps) {
  const panchayats = forecast.panchayats
  const stats = useMemo(() => allVariableStats(panchayats), [panchayats])
  const rollup = useMemo(() => rollupAdvice(panchayats), [panchayats])
  const counts = useMemo(() => supportCounts(panchayats, variableKey), [panchayats, variableKey])
  const diff = forecast.differentiation

  return (
    <div className="summary">
      <header className="panel-head">
        <p className="eyebrow">
          {forecast.district} district · {forecast.panchayat_count} villages
        </p>
        <h2 className="panel-title">{forecast.block_name} block</h2>
        <p className="panel-sub">
          <time dateTime={forecast.date}>{formatLongDate(forecast.date)}</time>
          <span className="source-pill">{sourceLabel}</span>
        </p>
      </header>

      <section className="panel-section" aria-labelledby="sum-weather">
        <div className="section-head">
          <h3 id="sum-weather" className="section-title">
            Block forecast and village range
          </h3>
        </div>
        <div className="spread-legend" aria-hidden>
          <span />
          <span>Block</span>
          <span />
          <span>Villages</span>
        </div>
        <VariableSpreadList stats={stats} scales={scales} active={variableKey} onPick={onVariable} />
        <p className={`diff-note${diff.meaningful ? '' : ' is-flat'}`}>
          <strong>
            {diff.meaningful
              ? 'Villages genuinely differ today.'
              : 'Villages barely differ today; the block value is fine to use.'}
          </strong>{' '}
          {humaniseNote(diff.note)}
        </p>
      </section>

      <section className="panel-section" aria-labelledby="sum-conf">
        <div className="section-head">
          <h3 id="sum-conf" className="section-title">
            Confidence
          </h3>
          <span className="section-aside">{variableMeta(variableKey).shortLabel}</span>
        </div>
        <p className="conf-line" aria-label={`Villages by confidence: ${describeSupportCounts(counts)}`}>
          {(['high', 'medium', 'low'] as const)
            .filter((l) => counts[l] > 0)
            .map((l) => (
              <span key={l} className="conf-item" aria-hidden>
                <TextureSwatch support={l} size={16} />
                <strong className="num">{counts[l]}</strong> {SUPPORT_WORD[l]}
              </span>
            ))}
        </p>
        {counts.high === 0 && (
          <p className="muted small">
            No village is rated high: nobody measures weather village by village, so these values
            are capped at moderate. The map pattern shows each level.
          </p>
        )}
      </section>

      <section className="panel-section" aria-labelledby="sum-advice">
        <div className="section-head">
          <h3 id="sum-advice" className="section-title">
            Advice across the block
          </h3>
        </div>
        <AdviceRollup rows={rollup} />
      </section>

      <VillageList
        villages={panchayats}
        variableKey={variableKey}
        scale={scale}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </div>
  )
}
