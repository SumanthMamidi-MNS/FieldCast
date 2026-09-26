import { useId, useState } from 'react'
import type { Tier } from '../types/api'

const TIER_TITLE: Record<Tier, string> = {
  T1: 'Validated at ~9 km',
  T2: 'Validated at rain gauges',
  T3: 'Inferred below the validated scale',
}

const TIER_SUMMARY: Record<Tier, string> = {
  T1: 'Checked against dense reanalysis data at about 9 km grid cells. Errors at this scale are measured.',
  T2: 'Checked against real rain-gauge records. This is the validation the project stands on.',
  T3:
    'Inferred below the validated scale. No village-level measurements exist to check this ' +
    'against, so it is a physically-informed estimate built on terrain, not a measured result. ' +
    'Its accuracy is backed only indirectly, by the T1 and T2 checks at coarser scales.',
}

interface TierBadgeProps {
  tier: Tier
  /** The API's own `tier_note`, shown verbatim when supplied. */
  note?: string
  size?: 'sm' | 'md'
}

/**
 * The tier badge is a disclosure, not decoration. The tooltip opens on hover
 * *and* on focus, and its content is also rendered into the accessible name, so
 * a screen-reader user gets the caveat without needing the hover.
 */
export function TierBadge({ tier, note, size = 'md' }: TierBadgeProps) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()
  const summary = TIER_SUMMARY[tier]
  // The API's own note adds specifics; it never replaces the plain meaning.
  const extra = note && note !== summary ? note : null

  return (
    <span className="tier-badge-wrap">
      <button
        type="button"
        className={`tier-badge tier-${tier.toLowerCase()} tier-${size}`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{tier}</span>
        <span className="visually-hidden">
          Evidence tier {tier}: {TIER_TITLE[tier]}. {summary} {extra}
        </span>
        <svg className="tier-badge-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 7.2v4.2M8 4.6v.9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <span role="tooltip" id={tooltipId} className="tier-tooltip">
          <strong>
            {tier} — {TIER_TITLE[tier]}
          </strong>
          <span>{summary}</span>
          {extra && <span className="tier-tooltip-note">{extra}</span>}
        </span>
      )}
    </span>
  )
}
