import { useId } from 'react'
import type { SupportLevel } from '../../types/api'
import { confidenceStyle } from '../../lib/confidenceTexture'

interface TextureSwatchProps {
  support: SupportLevel
  /** Fill colour beneath the texture; defaults to a neutral mid-grey. */
  color?: string
  size?: number
}

const DARK = 'rgba(14,19,25,0.92)'
const LIGHT = 'rgba(255,255,255,0.95)'

/**
 * The legend swatch, drawn with the *same* marks the map uses: identical hatch
 * spacing, identical two-tone strokes, identical dashed outline for low support.
 * A legend that only approximates the map is a legend people stop trusting.
 */
export function TextureSwatch({ support, color = '#9fb5ae', size = 22 }: TextureSwatchProps) {
  const uid = useId().replace(/:/g, '')
  const style = confidenceStyle(support)
  const dash = style.outlineDash ? style.outlineDash.map((d) => d * 2).join(' ') : undefined

  return (
    <svg
      className="texture-swatch"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <defs>
        <pattern id={`h${uid}`} width="8" height="8" patternUnits="userSpaceOnUse">
          <line x1="0" y1="-1" x2="-9" y2="8" stroke={DARK} strokeWidth="1.6" />
          <line x1="4" y1="-1" x2="-5" y2="8" stroke={LIGHT} strokeWidth="1.6" />
          <line x1="8" y1="-1" x2="-1" y2="8" stroke={DARK} strokeWidth="1.6" />
          <line x1="12" y1="-1" x2="3" y2="8" stroke={LIGHT} strokeWidth="1.6" />
        </pattern>
        <pattern id={`s${uid}`} width="11" height="11" patternUnits="userSpaceOnUse" x="1" y="1">
          <circle cx="2.75" cy="2.75" r="1.6" fill={LIGHT} />
          <circle cx="2.75" cy="2.75" r="1" fill={DARK} />
          <circle cx="8.25" cy="8.25" r="1.6" fill={LIGHT} />
          <circle cx="8.25" cy="8.25" r="1" fill={DARK} />
        </pattern>
      </defs>

      <rect x="1" y="1" width="22" height="22" rx="4" fill={color} opacity={style.fillOpacity} />
      {style.texture === 'hatch-low' && (
        <rect x="1" y="1" width="22" height="22" rx="4" fill={`url(#h${uid})`} />
      )}
      {style.texture === 'stipple-medium' && (
        <rect x="1" y="1" width="22" height="22" rx="4" fill={`url(#s${uid})`} />
      )}
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="4"
        fill="none"
        stroke={style.outlineColor}
        strokeWidth={style.outlineWidth}
        strokeDasharray={dash}
      />
    </svg>
  )
}

const CHIP_WORD: Record<SupportLevel, string> = {
  high: 'High',
  medium: 'Moderate',
  low: 'Low',
}

/** Inline chip: swatch plus the words. Confidence is never texture alone. */
export function SupportChip({
  support,
  label,
  color,
  compact = false,
}: {
  support: SupportLevel
  /** The API's `support_label`, shown verbatim when supplied. */
  label?: string
  color?: string
  /** One-word chip for dense lists. */
  compact?: boolean
}) {
  const text = compact ? CHIP_WORD[support] : (label ?? confidenceStyle(support).shortLabel)
  return (
    <span className={`support-chip sup-${support}${compact ? ' is-compact' : ''}`}>
      <TextureSwatch support={support} color={color} size={compact ? 12 : 16} />
      <span>
        {compact && <span className="visually-hidden">Confidence: </span>}
        {text}
      </span>
    </span>
  )
}
