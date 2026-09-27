import type { EvaluationRow } from '../../types/api'
import {
  OUTCOME_LABEL,
  baselineLosses,
  blockServedNote,
  classifyOutcome,
  formatSkill,
  type Outcome,
} from '../../lib/evidence'
import { Icon, type IconName } from '../common/Icon'
import { formatPercent } from '../../lib/format'

const OUTCOME_ICON: Record<Outcome, IconName> = {
  'clear-win': 'check',
  'uncertain-win': 'alert',
  even: 'info',
  loss: 'close',
}

function ticksFor(axis: { min: number; max: number }): number[] {
  const span = axis.max - axis.min
  const step = span > 1.2 ? 0.4 : span > 0.6 ? 0.2 : 0.1
  const out: number[] = []
  for (let v = Math.ceil(axis.min / step) * step; v <= axis.max + 1e-9; v += step) {
    out.push(Number(v.toFixed(2)))
  }
  if (!out.some((v) => Math.abs(v) < 1e-9)) out.push(0)
  return out.sort((a, b) => a - b)
}

function coverageWords(c: number): string {
  if (c < 0.75) return 'ranges too narrow'
  if (c > 0.9) return 'ranges on the cautious side'
  return 'about right'
}

/**
 * Skill vs the naive block copy, one row per variable: a dot for the estimate,
 * a whisker for its 90% interval, on one shared axis whose zero line is "no
 * better than the block value". Plain HTML so the text stays crisp and the
 * layout can reflow on a phone.
 */
export function SkillChart({
  rows,
  axis,
  caption,
}: {
  rows: EvaluationRow[]
  axis: { min: number; max: number }
  caption: string
}) {
  const pct = (v: number) => `${(((v - axis.min) / (axis.max - axis.min)) * 100).toFixed(2)}%`
  const ticks = ticksFor(axis)

  return (
    <figure className="skill">
      <figcaption className="visually-hidden">{caption}</figcaption>
      <div className="skill-axis" aria-hidden>
        <span className="skill-axis-spacer" />
        <div className="skill-axis-track">
          {ticks.map((t) => (
            <span key={t} className={`skill-tick${t === 0 ? ' is-zero' : ''}`} style={{ left: pct(t) }}>
              {t === 0 ? 'Block value' : formatSkill(t)}
            </span>
          ))}
        </div>
        <span className="skill-axis-cov">80% range check</span>
      </div>

      <ul className="skill-rows">
        {rows.map((r) => {
          const outcome = classifyOutcome(r)
          const [lo, hi] = r.skill_ci90 ?? [r.skill_vs_naive, r.skill_vs_naive]
          const cov = r.interval_coverage_80
          const losses = baselineLosses(r)
          const served = r.reconciled_skill_vs_naive
          const ciText = r.skill_ci90 ? `, 90% range ${formatSkill(lo)} to ${formatSkill(hi)}` : ''
          const blockNote = blockServedNote(r)
          return (
            <li key={r.variable} className={`skill-row out-${outcome}`}>
              <div className="skill-name">
                <span className="skill-label">{r.label}</span>
                <span className={`outcome out-${outcome}`}>
                  <Icon name={OUTCOME_ICON[outcome]} size={14} />
                  {OUTCOME_LABEL[outcome]}
                </span>
              </div>

              <div
                className="skill-track"
                role="img"
                aria-label={`${r.label}: skill ${formatSkill(r.skill_vs_naive)}${ciText}. ${OUTCOME_LABEL[outcome]}.${blockNote ? ' Official block value served.' : ''}`}
              >
                {ticks.map((t) => (
                  <span key={t} className={`skill-grid${t === 0 ? ' is-zero' : ''}`} style={{ left: pct(t) }} />
                ))}
                <span
                  className="skill-whisker"
                  style={{ left: pct(Math.min(lo, hi)), width: `calc(${pct(Math.max(lo, hi))} - ${pct(Math.min(lo, hi))})` }}
                />
                <span className="skill-dot" style={{ left: pct(r.skill_vs_naive) }} />
                <span className="skill-value num" style={{ left: pct(r.skill_vs_naive) }}>
                  {formatSkill(r.skill_vs_naive)}
                </span>
              </div>

              <div className="skill-cov">
                {cov !== undefined ? (
                  <>
                    <div className="cov-bar" aria-hidden>
                      <span className="cov-fill" style={{ width: `${Math.min(cov, 1) * 100}%` }} />
                      <span className="cov-target" />
                    </div>
                    <p className="cov-text num">
                      <strong>{formatPercent(cov)}</strong> of days inside, {coverageWords(cov)}
                    </p>
                  </>
                ) : (
                  <p className="cov-text muted">Not measured</p>
                )}
              </div>

              {blockNote && (
                <p className="skill-block-note">
                  <Icon name="info" size={14} />
                  <span>
                    <strong>{blockNote.lead}</strong>
                    {blockNote.rest && ` ${blockNote.rest}`}
                  </span>
                </p>
              )}

              {(r.verdict || losses.length > 0 || served !== undefined) && (
                <div className="skill-notes">
                  {r.verdict && <span>Evaluator: {r.verdict}.</span>}
                  {served !== undefined && Math.abs(served - r.skill_vs_naive) >= 0.01 && (
                    <span>
                      As served, after matching the block total: <strong className="num">{formatSkill(served)}</strong>.
                    </span>
                  )}
                  {losses.map((l) => (
                    <span key={l.name} className="skill-loss-note">
                      Loses to a {l.name} ({formatSkill(l.skill)}).
                    </span>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </figure>
  )
}
