import { useId, useState, type ReactNode } from 'react'

/**
 * A quiet label with an explanation on hover, focus or tap. The explanation
 * is also in the accessible description, so it is never hover-only.
 */
export function InfoTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="infotip">
      <button
        type="button"
        className="infotip-btn"
        aria-describedby={id}
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
        {label}
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
          <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.3v3.9M8 4.8v.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      <span role="tooltip" id={id} className={`infotip-pop${open ? ' is-open' : ''}`}>
        {children}
      </span>
    </span>
  )
}
