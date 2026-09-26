import { useEffect, useState } from 'react'

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setValue(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return value
}

/** The single layout breakpoint: below it the app stacks for a phone. */
export const MOBILE_QUERY = '(max-width: 767px)'

export function prefersReducedMotion(): boolean {
  return matches('(prefers-reduced-motion: reduce)')
}
