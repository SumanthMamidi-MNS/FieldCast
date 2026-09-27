/**
 * The FieldCast mark: The Downscale Lens Aperture (Option 8.2).
 * Designed for high-contrast circular GitHub avatars, favicons, and dashboards:
 * an outer atmospheric aperture boundary curving inward into a localized micro-climate
 * focal arc, locked onto the central panchayat beacon.
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      className="logo-mark"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer 270° Downscaling Aperture Arc */}
      <path
        d="M8 8 C12.5 3.5 20.5 3.5 25 8 C29.5 12.5 29.5 20.5 25 25 C20.5 29.5 12.5 29.5 8 25"
        stroke="var(--brand-900, #0a3b34)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Inner Downscale Focal Arc */}
      <path
        d="M11 11 C14 8 19 8 22 11 C25 14 25 19 22 22"
        stroke="#10b981"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Central Panchayat Beacon */}
      <circle
        cx="16.5"
        cy="16.5"
        r="3"
        fill="#f59e0b"
      />
    </svg>
  )
}

/** Mark + wordmark, used in the top bar and on printed advisories. */
export function Logo({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={30} />
      <span className="logo-text">
        <span className="logo-name">
          <span className="logo-name-base">Field</span>
          <span className="logo-name-accent">Cast</span>
        </span>
        {tagline && <span className="logo-tagline">Village-level weather, with honest confidence</span>}
      </span>
    </span>
  )
}
