import { useId } from 'react'

/**
 * The FieldCast mark: a raindrop holding two curved field furrows, with a warm
 * pin-head dot where the village sits. Drawn on a 32-unit grid with strokes
 * thick enough to survive at 16 px (the favicon is the same drawing).
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  const clip = useId()
  const drop =
    'M16 2.5C16 2.5 5.5 14.2 5.5 20.4a10.5 10.5 0 0 0 21 0C26.5 14.2 16 2.5 16 2.5Z'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <path d={drop} />
        </clipPath>
      </defs>
      <path d={drop} fill="var(--brand-700)" />
      <g
        clipPath={`url(#${clip})`}
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <path d="M3 19.2Q16 13.4 29 19.2" />
        <path d="M3 25Q16 19 29 25" />
      </g>
      <circle cx="16" cy="10.6" r="2.2" fill="#e39a4a" />
    </svg>
  )
}

/** Mark + wordmark, used in the top bar and on printed advisories. */
export function Logo({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={30} />
      <span className="logo-text">
        <span className="logo-name">FieldCast</span>
        {tagline && <span className="logo-tagline">Village-level weather, with honest confidence</span>}
      </span>
    </span>
  )
}
