import type { AdvisoryItem } from '../../types/api'
import { actionPresentation } from '../../lib/actions'
import { ActionGlyph } from '../common/ActionGlyph'

/**
 * Advisory items, most restrictive first. Each action is encoded three ways —
 * glyph shape, colour and the word ("Hold off" / "Take care" / "Go ahead") —
 * so colour is the least load-bearing cue. A `confidence_caveat` stays attached
 * to its own item, because it changes how that recommendation should be read.
 */
const RANK = { avoid: 0, caution: 1, proceed: 2, no_guidance: 3 } as const

export function AdvisoryActions({ items }: { items: AdvisoryItem[] }) {
  if (items.length === 0) {
    return <p className="muted">No farm operations are affected today.</p>
  }
  const sorted = [...items].sort((a, b) => (RANK[a.action] ?? 3) - (RANK[b.action] ?? 3))
  return (
    <ul className="actions">
      {sorted.map((item, i) => {
        const p = actionPresentation(item.action)
        return (
          <li key={`${item.activity}-${i}`} className={`action-card act-${item.action}`}>
            <ActionGlyph action={item.action} size={22} />
            <div className="action-body">
              <p className="action-head">
                <span className="action-word">{p.word}</span>
                <span className="action-activity">{item.activity}</span>
              </p>
              <p className="action-reason">{item.reason}</p>
              {item.confidence_caveat && (
                <p className="action-caveat">
                  <span className="visually-hidden">Confidence caveat: </span>
                  {item.confidence_caveat}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
