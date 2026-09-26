import type { Confidence } from '../../types/api'
import { confidenceStyle } from '../../lib/confidenceTexture'
import { Icon } from '../common/Icon'
import { TIER_NAME } from '../../lib/tiers'
import { TierBadge } from '../common/TierBadge'
import { SupportChip } from '../common/TextureSwatch'

/** Gauge proximity stops counting towards support at this distance (architecture §3). */
const GAUGE_REACH_KM = 50

function gaugeSentence(km: number | null): string {
  if (km === null) return 'No rain gauge is close enough to check this village directly.'
  const d = km < 10 ? km.toFixed(1) : Math.round(km).toString()
  if (km > GAUGE_REACH_KM) {
    return `The nearest real rain gauge is ${d} km away, too far to check this village directly.`
  }
  return `A real rain gauge ${d} km away helps anchor this estimate.`
}

/**
 * "How sure are we?" in plain words: support level, what it rests on, the
 * evidence tier, and the uncertainty statement — which is always visible,
 * never behind a toggle.
 */
export function ConfidencePanel({
  confidence,
  uncertainty,
}: {
  confidence: Confidence
  uncertainty: string
}) {
  const style = confidenceStyle(confidence.support)
  return (
    <div className="confidence">
      <div className="confidence-row">
        <SupportChip support={confidence.support} label={confidence.support_label} />
        <TierBadge tier={confidence.tier} note={confidence.tier_note} named />
      </div>
      <p className="confidence-text">{style.legendExplanation}</p>
      <ul className="confidence-facts">
        <li>
          <Icon name="gauge" size={16} />
          <span>{gaugeSentence(confidence.nearest_gauge_km)}</span>
        </li>
        <li>
          <Icon name="mountain" size={16} />
          <span>
            Support score{' '}
            <strong className="num">{Math.round(confidence.support_score * 100)} / 100</strong>, from
            how closely this village&rsquo;s terrain matches places the model learned from and how
            near a gauge is.
          </span>
        </li>
        <li>
          <Icon name="layers" size={16} />
          <span>
            Evidence: <strong>{TIER_NAME[confidence.tier]}</strong>. {confidence.tier_note}
          </span>
        </li>
      </ul>
      <p className="uncertainty">
        <Icon name="info" size={18} />
        <span>{uncertainty}</span>
      </p>
    </div>
  )
}
