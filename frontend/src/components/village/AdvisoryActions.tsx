import type { AdvisoryAction, AdvisoryItem } from '../types/api'

interface ActionPresentation {
  word: string
  /** Distinct silhouette per action — the cue that survives colour-blindness. */
  glyph: 'check' | 'triangle' | 'octagon' | 'question'
}

const ACTIONS: Record<AdvisoryAction, ActionPresentation> = {
  proceed: { word: 'Go ahead', glyph: 'check' },
  caution: { word: 'Take care', glyph: 'triangle' },
  avoid: { word: 'Do not', glyph: 'octagon' },
  no_guidance: { word: 'No advice', glyph: 'question' },
}

function ActionGlyph({ glyph }: { glyph: ActionPresentation['glyph'] }) {
  return (
    <svg className="action-glyph" viewBox="0 0 24 24" aria-hidden focusable="false">
      {glyph === 'check' && (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path
            d="M7.5 12.4l3.1 3.1 6-6.4"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {glyph === 'triangle' && (
        <>
          <path d="M12 2.6l10 18H2z" fill="currentColor" />
          <path
            d="M12 9v5.2M12 16.6v1.4"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </>
      )}
      {glyph === 'octagon' && (
        <>
          <path
            d="M8.1 2.4h7.8l5.7 5.7v7.8l-5.7 5.7H8.1L2.4 15.9V8.1z"
            fill="currentColor"
          />
          <path d="M7.6 12h8.8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        </>
      )}
      {glyph === 'question' && (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path
            d="M9.4 9.3a2.7 2.7 0 115.2 1c-.5 1.3-2.1 1.6-2.4 2.9"
            fill="none"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17.1" r="1.3" fill="#fff" />
        </>
      )}
    </svg>
  )
}

/**
 * Advisory items.
 *
 * Action is encoded three ways at once — glyph shape, colour, and the word
 * itself ("Go ahead" / "Take care" / "Do not"). Colour is the *least* load-
 * bearing of the three, which is what makes this readable to a colour-blind
 * officer and on a washed-out projector.
 *
 * `confidence_caveat` renders attached to its item rather than pooled at the
 * bottom, because it changes how that specific recommendation should be read.
 */
export function AdvisoryList({ items }: { items: AdvisoryItem[] }) {
  return (
    <ul className="advisory-list">
      {items.map((item, i) => {
        const presentation = ACTIONS[item.action] ?? ACTIONS.no_guidance
        return (
          <li key={`${item.activity}-${i}`} className={`advisory-item action-${item.action}`}>
            <div className="advisory-item-head">
              <ActionGlyph glyph={presentation.glyph} />
              <div>
                <p className="advisory-activity">{item.activity}</p>
                <p className="advisory-action-word">{presentation.word}</p>
              </div>
            </div>
            <p className="advisory-reason">{item.reason}</p>
            {item.confidence_caveat && (
              <p className="advisory-caveat">
                <span className="visually-hidden">Confidence caveat: </span>
                {item.confidence_caveat}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
