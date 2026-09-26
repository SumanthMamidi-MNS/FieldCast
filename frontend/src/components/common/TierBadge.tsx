import { useId, useState } from 'react'
import type { Tier } from '../../types/api'
import { TIER_NAME, TIER_SUMMARY } from '../../lib/tiers'

interface TierBadgeProps {
  tier: Tier
  /** The API's own `tier_note`, shown verbatim when supplied. */
  note?: string
  /** Show the tier's name next to its code. */
  named?: boolean
}

/**
 * The tier badge is a disclosure, not decoration. The tooltip opens on hover,
 * on focus and on tap, and its content is also in the accessible name, so a
 * screen-reader user gets the caveat without needing the hover.
 */
export function TierBadge({ tier, note, named = false }: TierBadgeProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()
  const summary = TIER_SUMMARY[tier]
  const extra = note && note !== summary ? note : null

  return (
    <span className="tier-wrap">
      <button
        type="button"
        className={`tier-badge tier-${tier.toLowerCase()}`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      >
        <span aria-hidden>
          {tier}
          {named && <span className="tier-name"> · {TIER_NAME[tier]}</span>}
        </span>
        <span className="visually-hidden">
          Evidence tier {tier}, {TIER_NAME[tier]}. {summary} {extra}
        </span>
        <svg className="tier-i" viewBox="0 0 16 16" width="13" height="13" aria-hidden focusable="false">
          <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.3v3.9M8 4.8v.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span role="tooltip" id={tooltipId} className="tier-tooltip">
          <strong>
            {tier} · {TIER_NAME[tier]}
          </strong>
          <span>{summary}</span>
          {extra && <span className="tier-tooltip-note">From the forecast: {extra}</span>}
        </span>
      )}
    </span>
  )
}
