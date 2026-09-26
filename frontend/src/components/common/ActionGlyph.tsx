import type { AdvisoryAction } from '../../types/api'
import { actionPresentation } from '../../lib/actions'

/**
 * Shape + colour for an advisory action: a round tick, a warning triangle, a
 * stop octagon. The shape alone is enough to tell them apart.
 */
export function ActionGlyph({ action, size = 20 }: { action: AdvisoryAction; size?: number }) {
  const { glyph } = actionPresentation(action)
  return (
    <svg
      className={`action-glyph act-${action}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
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
          <path d="M12 2.6l10 18H2z" fill="currentColor" strokeLinejoin="round" />
          <path d="M12 9v5.2M12 16.6v1.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {glyph === 'octagon' && (
        <>
          <path d="M8.1 2.4h7.8l5.7 5.7v7.8l-5.7 5.7H8.1L2.4 15.9V8.1z" fill="currentColor" />
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
