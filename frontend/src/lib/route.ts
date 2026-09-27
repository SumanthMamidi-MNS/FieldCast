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

/** Class set on `<html>` so page-level CSS (e.g. the desktop scroll lock) can follow the route. */
export const ROUTE_CLASS_PREFIX = 'route-'

export function documentRouteClass(route: Route): string {
  return `${ROUTE_CLASS_PREFIX}${route}`
}

/**
 * The class list for `<html>` after switching to `route`: every other route class
 * is removed, anything unrelated is kept.
 */
export function applyRouteClass(classes: readonly string[], route: Route): string[] {
  const kept = classes.filter((c) => !ROUTES.some((r) => documentRouteClass(r.route) === c))
  return [...kept, documentRouteClass(route)]
}
