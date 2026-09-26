import { useCallback, useState } from 'react'

/**
 * Persisted UI state. Every access is wrapped: private browsing, blocked site
 * data and quota errors must not take the dashboard down with them.
 */
export function useLocalStorage(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback
    } catch {
      return fallback
    }
  })

  const update = useCallback(
    (next: string) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, next)
      } catch {
        // Persistence is a convenience, never a requirement.
      }
    },
    [key],
  )

  return [value, update]
}
