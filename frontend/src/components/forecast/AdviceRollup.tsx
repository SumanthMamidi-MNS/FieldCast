import { ACTION_ORDER, actionWord, describeRollup, type ActivityRollup } from '../../lib/blockSummary'
import { ActionGlyph } from '../common/ActionGlyph'

/**
 * What the advice adds up to across the block: one row per activity, a
 * stacked bar for the shape, and glyph + count + word for the facts. The
 * sentence form is the accessible name, so a screen reader hears the summary.
 */
export function AdviceRollup({ rows }: { rows: ActivityRollup[] }) {
  if (rows.length === 0) return <p className="muted">No advice was issued for this day.</p>
  return (
    <ul className="rollup">
      {rows.map((row) => {
        const parts = ACTION_ORDER.filter((a) => row.counts[a] > 0)
        return (
          <li key={row.activity} className="rollup-row" aria-label={describeRollup(row)}>
            <div className="rollup-head" aria-hidden>
              <span className="rollup-activity">{row.short}</span>
              <span className="rollup-counts">
                {parts.map((a) => (
                  <span key={a} className={`rollup-count act-${a}`}>
                    <ActionGlyph action={a} size={13} />
                    <span className="num">{row.counts[a]}</span>
                    <span className="rollup-word">{actionWord(a)}</span>
                  </span>
                ))}
              </span>
            </div>
            <div className="rollup-bar" aria-hidden>
              {parts.map((a) => (
                <span
                  key={a}
                  className={`rollup-seg act-${a}`}
                  style={{ flexGrow: row.counts[a] }}
                />
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
