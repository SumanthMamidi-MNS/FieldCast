import type { SupportLevel } from '../types/api'
import { confidenceStyle } from '../lib/confidenceTexture'

interface TextureSwatchProps {
  support: SupportLevel
  /** Fill colour beneath the texture; defaults to a mid-ramp blue. */
  color?: string
  size?: number
}

/**
 * The legend swatch, drawn with the *same* marks the map uses: identical hatch
 * spacing, identical two-tone strokes, identical dashed outline for low support.
 * A legend that only approximates the map is a legend people stop trusting.
 */
export function TextureSwatch({ support, color = '#5ea5cd', size = 26 }: TextureSwatchProps) {
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
        <pattern id={`sw-hatch-${support}`} width="8" height="8" patternUnits="userSpaceOnUse">
          <line x1="0" y1="-1" x2="-9" y2="8" stroke="rgba(14,19,25,0.92)" strokeWidth="1.6" />
          <line x1="4" y1="-1" x2="-5" y2="8" stroke="rgba(255,255,255,0.95)" strokeWidth="1.6" />
          <line x1="8" y1="-1" x2="-1" y2="8" stroke="rgba(14,19,25,0.92)" strokeWidth="1.6" />
          <line x1="12" y1="-1" x2="3" y2="8" stroke="rgba(255,255,255,0.95)" strokeWidth="1.6" />
        </pattern>
        <pattern id={`sw-stipple-${support}`} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" fill="rgba(255,255,255,0.95)" />
          <circle cx="2" cy="2" r="0.9" fill="rgba(14,19,25,0.92)" />
          <circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,0.95)" />
          <circle cx="6" cy="6" r="0.9" fill="rgba(14,19,25,0.92)" />
        </pattern>
      </defs>

      <rect x="1" y="1" width="22" height="22" rx="3" fill={color} opacity={style.fillOpacity} />
      {style.texture === 'hatch-low' && (
        <rect x="1" y="1" width="22" height="22" rx="3" fill={`url(#sw-hatch-${support})`} />
      )}
      {style.texture === 'stipple-medium' && (
        <rect x="1" y="1" width="22" height="22" rx="3" fill={`url(#sw-stipple-${support})`} />
      )}
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="3"
        fill="none"
        stroke={style.outlineColor}
        strokeWidth={style.outlineWidth}
        strokeDasharray={dash}
      />
    </svg>
  )
}

/** Inline chip: swatch plus the words. Confidence is never texture alone. */
export function SupportChip({
  support,
  label,
  color,
}: {
  support: SupportLevel
  /** The API's `support_label`, shown verbatim when supplied. */
  label?: string
  color?: string
}) {
  const style = confidenceStyle(support)
  return (
    <span className={`support-chip support-${support}`}>
      <TextureSwatch support={support} color={color} size={18} />
      <span>{label ?? style.shortLabel}</span>
    </span>
  )
}
