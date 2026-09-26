import { useEffect, useState } from 'react'
import { parseRoute, type Route } from '../lib/route'

/** Current page from `location.hash`, updated on back/forward and link clicks. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash))
      // A new page starts at the top, like a real navigation.
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}
