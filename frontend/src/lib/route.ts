/**
 * Hash routes. Three pages do not justify a router dependency, and hash URLs
 * work on any static host without rewrite rules.
 */

export type Route = 'forecast' | 'evidence' | 'how'

export const ROUTES: { route: Route; hash: string; label: string }[] = [
  { route: 'forecast', hash: '#/forecast', label: 'Forecast' },
  { route: 'evidence', hash: '#/evidence', label: 'Evidence' },
  { route: 'how', hash: '#/how-it-works', label: 'How it works' },
]

/** Unknown or empty hashes land on the forecast. Query strings are ignored. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split(/[?#]/)[0]?.replace(/\/$/, '').toLowerCase() ?? ''
  if (path === 'evidence') return 'evidence'
  if (path === 'how-it-works' || path === 'how') return 'how'
  return 'forecast'
}

export function hashFor(route: Route): string {
  return ROUTES.find((r) => r.route === route)?.hash ?? '#/forecast'
}
