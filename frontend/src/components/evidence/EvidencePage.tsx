import { useMemo, type ReactNode } from 'react'
import { api } from '../../api/client'
import { useAsync } from '../../hooks/useAsync'
import type { EvaluationReport, EvaluationRow } from '../../types/api'
import {
  allReportRows,
  approxCount,
  calibratedOn1958,
  classifyOutcome,
  coverageFit,
  formatSkill,
  gaugeCount,
  occurrenceGain,
  orderedRows,
  regionName,
  skillAxis,
  splitReports,
  type CoverageFit,
} from '../../lib/evidence'
import { Icon } from '../common/Icon'
import { Skeleton, SkeletonText } from '../common/Skeleton'
import { StatusCard } from '../common/StatusCard'
import { SkillChart } from './SkillChart'
import { fixed, formatPercent } from '../../lib/format'

type Axis = { min: number; max: number }

function OccurrenceNote({ row, where }: { row: EvaluationRow | undefined; where: string }) {
  if (!row?.occurrence) return null
  const gain = occurrenceGain(row)
  if (gain === null) return null
  const good = gain > 0
  return (
    <div className={`occurrence ${good ? 'is-good' : 'is-bad'}`}>
      <p className="occurrence-big num">{formatSkill(gain)}</p>
      <div>
        <p className="occurrence-title">Rain or no rain, {where}</p>
        <p className="occurrence-text">
          {good
            ? `FieldCast's own call on whether it rains (2.5 mm or more) makes ${formatPercent(gain)} less error than using the block forecast's call. This is what drives spraying and harvest advice.`
            : `FieldCast's own call on whether it rains is ${formatPercent(-gain)} worse than the block forecast's call.`}{' '}
          <span className="muted num">
            Brier score {fixed(row.occurrence.brier, 3)} vs {fixed(row.occurrence.brier_naive_block, 3)} for the
            block value; lower is better.
          </span>
        </p>
      </div>
    </div>
  )
}

function TierBlock({
  title,
  kicker,
  description,
  rows,
  axis,
  gauge = false,
  historical = false,
  children,
}: {
  title: string
  kicker: string
  description: ReactNode
  rows: EvaluationRow[]
  axis: Axis
  gauge?: boolean
  historical?: boolean
  children?: ReactNode
}) {
  const cls = `tier-block${gauge ? ' is-gauge' : ''}${historical ? ' is-hist' : ''}`
  const kickerEl = (
    <p className="kicker">
      {gauge && <Icon name="gauge" size={16} />} {kicker}
    </p>
  )
  if (rows.length === 0) {
    return (
      <div className={`${cls} is-empty`}>
        {kickerEl}
        <h3 className="tier-block-title">{title}</h3>
        <p className="tier-empty">Not available yet.</p>
      </div>
    )
  }
  const precip = rows.find((r) => r.variable === 'precip')
  return (
    <div className={cls}>
      {kickerEl}
      <h3 className="tier-block-title">{title}</h3>
      <div className="tier-block-desc">{description}</div>
      {children}
      <SkillChart rows={rows} axis={axis} caption={`${title}: skill versus the block value, by variable`} />
      <OccurrenceNote row={precip} where={gauge ? 'at real gauges' : 'on the grid'} />
    </div>
  )
}

const FIT_WORDS: Record<CoverageFit, string> = {
  near: 'near the 80% target',
  narrow: 'below 80%: ranges too narrow',
  wide: 'above 80%: ranges on the cautious side',
}

/** One line per gauge-checked variable: did the 80% range hold 8 days in 10? */
function CoverageCheck({ rows }: { rows: EvaluationRow[] }) {
  const measured = rows.filter(
    (r): r is EvaluationRow & { interval_coverage_80: number } =>
      typeof r.interval_coverage_80 === 'number' && Number.isFinite(r.interval_coverage_80),
  )
  if (measured.length === 0) return null
  const allNear = measured.every((r) => coverageFit(r.interval_coverage_80) === 'near')
  return (
    <div className={`cov-check${allNear ? ' is-near' : ''}`}>
      <p className="cov-check-title">
        <Icon name={allNear ? 'check' : 'alert'} size={16} />
        {allNear
          ? 'The likely ranges held the gauge reading about 8 days in 10, as they should.'
          : 'Range check against these gauges'}
      </p>
      <ul className="cov-check-list">
        {measured.map((r) => {
          const fit = coverageFit(r.interval_coverage_80)
          return (
            <li key={r.variable} className={`fit-${fit}`}>
              <span>{r.label}</span>
              <strong className="num">{formatPercent(r.interval_coverage_80)}</strong>
              <span className="cov-check-word">{FIT_WORDS[fit]}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ReportSection({ report, axis }: { report: EvaluationReport; axis: Axis }) {
  const t1 = orderedRows(report.T1)
  const t2 = orderedRows(report.T2)
  const hist = orderedRows(report.T2_hist)
  const t1n = t1[0]
  const gauges = gaugeCount(t2)
  const histGauges = gaugeCount(hist)
  const size = t1n
    ? `${t1n.n.toLocaleString('en-IN')} grid-cell days${t1n.n_clusters ? ` across ${t1n.n_clusters} blocks` : ''}`
    : ''
  const t1Desc = report.transfer
    ? `Every block in this region is new to the model${size ? `: ${size}` : ''}.`
    : `The 2022–23 dry season and the 2023 monsoon, held out from training${size ? `: ${size}` : ''}. Whole blocks were hidden from the model too, so it could not memorise them.`
  const histTitle = `Real rain gauges — 1960 monsoon (${histGauges ? `${approxCount(histGauges)} gauges` : '~100 gauges'}, never used in training)`
  return (
    <>
      <TierBlock
        kicker="T1 · Weather grid"
        title="Against a dense weather grid"
        description={<p>{t1Desc}</p>}
        rows={t1}
        axis={axis}
      />
      <div className="gauge-pair">
        <TierBlock
          gauge
          kicker="T2 · Real rain gauges, today"
          title="Against modern rain gauges"
          description={
            <p>
              Weather stations never used in training{gauges ? `, only ${gauges} of them` : ''}.
              This is the closest thing to ground truth, but with so few gauges no result here can
              be called proven.
            </p>
          }
          rows={t2}
          axis={axis}
        />
        <TierBlock
          gauge
          historical
          kicker="T2 · Real rain gauges, 1960"
          title={histTitle}
          description={
            <>
              <p>
                <strong>Why 1960?</strong> India&rsquo;s older station network had about 100 rain
                gauges per state with public daily records; today only a handful report, so an old
                monsoon is the one way to check against many real gauges.
              </p>
              <p className="muted small">
                {calibratedOn1958(report)
                  ? 'The ranges were widened using the 1958 monsoon, so 1960 tests that widening on a season it never saw. '
                  : ''}
                The weather record of that era drew on fewer observations, so treat this as a strict test.
              </p>
            </>
          }
          rows={hist}
          axis={axis}
        >
          <CoverageCheck rows={hist} />
        </TierBlock>
      </div>
    </>
  )
}

function Summary({ rows }: { rows: EvaluationRow[] }) {
  const counts = { 'clear-win': 0, 'uncertain-win': 0, even: 0, loss: 0 }
  for (const r of rows) counts[classifyOutcome(r)] += 1
  return (
    <ul className="evidence-summary" aria-label={`All ${rows.length} results below, at a glance`}>
      <li className="out-clear-win">
        <span className="num">{counts['clear-win']}</span> clearly better than the block value
      </li>
      <li className="out-uncertain-win">
        <span className="num">{counts['uncertain-win']}</span> slightly better, not proven
      </li>
      {counts.even > 0 && (
        <li className="out-even">
          <span className="num">{counts.even}</span> no real difference
        </li>
      )}
      <li className="out-loss">
        <span className="num">{counts.loss}</span> not better, shown just as plainly
      </li>
    </ul>
  )
}

export function EvidencePage() {
  const reports = useAsync(() => api.getEvaluationReports(), [])
  const split = useMemo(() => splitReports(reports.data), [reports.data])

  const allRows = useMemo(
    () =>
      [...split.home, ...split.transfer].flatMap(([, r]) => allReportRows(r)),
    [split],
  )
  const axis = useMemo(() => skillAxis(allRows), [allRows])

  return (
    <article className="page evidence">
      <header className="page-head">
        <p className="kicker">Evidence</p>
        <h1 className="page-title">Is the panchayat forecast better than the block forecast?</h1>
        <p className="page-lead">
          The simplest alternative to FieldCast is to copy the block value to every gram panchayat. Every
          result below compares against exactly that, on data the model never saw. Where FieldCast
          does not beat it, we say so in the same size type.
        </p>
      </header>

      <section className="howto" aria-label="How to read these charts">
        <div className="howto-item">
          <span className="howto-demo" aria-hidden>
            <span className="howto-whisker" />
            <span className="howto-dot" />
          </span>
          <p>
            <strong>Skill</strong> is how much smaller our error is than the block value&rsquo;s.
            +40% means 40% smaller. The line is the 90% range of that estimate: if it crosses the
            block-value line, the improvement is not proven.
          </p>
        </div>
        <div className="howto-item">
          <span className="howto-demo" aria-hidden>
            <span className="cov-bar">
              <span className="cov-fill" style={{ width: '74%' }} />
              <span className="cov-target" />
            </span>
          </span>
          <p>
            <strong>Range check.</strong> Each value comes with a likely range meant to hold the
            truth on 8 days in 10. The mark is that 80% target; the bar is how often it really did.
          </p>
        </div>
      </section>

      {reports.loading && (
        <div aria-busy="true" className="evidence-loading">
          <Skeleton height="1.4rem" width="40%" />
          <SkeletonText lines={2} />
          <Skeleton height="280px" radius="12px" />
        </div>
      )}

      {reports.error && (
        <StatusCard
          tone="error"
          title="The evaluation reports could not be loaded"
          live
          actions={
            <button type="button" className="btn btn-primary" onClick={reports.reload}>
              <Icon name="refresh" size={16} /> Try again
            </button>
          }
        >
          <p className="status-detail">{reports.error}</p>
        </StatusCard>
      )}

      {!reports.loading && !reports.error && split.home.length === 0 && split.transfer.length === 0 && (
        <StatusCard tone="info" title="No evaluation has been run yet">
          <p>
            Until the model is scored against held-out data, treat every panchayat value as
            unverified. Run <code>python -m backend.pipeline.evaluate.run</code> to produce the
            reports.
          </p>
        </StatusCard>
      )}

      {allRows.length > 0 && <Summary rows={allRows} />}

      {split.home.map(([key, report]) => (
        <section key={key} className="report" aria-labelledby={`r-${key}`}>
          <h2 id={`r-${key}`} className="report-title">
            {regionName(report.region)}
            <span className="report-sub">the region the model was trained for</span>
          </h2>
          <ReportSection report={report} axis={axis} />
        </section>
      ))}

      {split.transfer.length > 0 && (
        <section className="report is-transfer" aria-labelledby="r-transfer">
          <h2 id="r-transfer" className="report-title">
            Tested on a region it never saw
          </h2>
          <p className="report-lead">
            The same models, trained on {regionName(split.transfer[0]?.[1].model_region)}, run
            unchanged somewhere else. This shows what carries over and what does not, and it is why
            FieldCast only serves regions that have their own trained models.
          </p>
          {split.transfer.map(([key, report]) => (
            <div key={key} className="transfer">
              <h3 className="transfer-title">
                {regionName(report.region)}{' '}
                <span className="report-sub">
                  models from {regionName(report.model_region)}
                </span>
              </h3>
              <ReportSection report={report} axis={axis} />
            </div>
          ))}
        </section>
      )}

      {!reports.loading && !reports.error && split.home.length > 0 && split.transfer.length === 0 && (
        <p className="muted">No transfer test has been run yet.</p>
      )}
    </article>
  )
}
