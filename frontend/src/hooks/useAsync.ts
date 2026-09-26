import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** HTTP status of the failure, when there was one (0 = network). */
  status: number | null
  /** True once a request has been in flight longer than SLOW_MS. */
  slow: boolean
}

/** First panchayat request per block fetches terrain lazily and can take seconds. */
const SLOW_MS = 2000

/**
 * Minimal data loader. Stale responses are discarded on unmount and on
 * dependency change, so switching blocks quickly can never paint the wrong
 * block's numbers over the right block's map.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: enabled,
    error: null,
    status: null,
    slow: false,
  })

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null, status: null, slow: false })
      return
    }
    let cancelled = false
    setState((prev) => ({ data: prev.data, loading: true, error: null, status: null, slow: false }))
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setState((prev) => (prev.loading ? { ...prev, slow: true } : prev))
    }, SLOW_MS)

    fn()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null, status: null, slow: false })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Something went wrong loading forecasts.',
            status: err instanceof ApiError ? err.status : null,
            slow: false,
          })
        }
      })
      .finally(() => window.clearTimeout(slowTimer))

    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled])

  return state
}
