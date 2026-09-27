import { describe, expect, it } from 'vitest'
import { applyRouteClass, documentRouteClass, parseRoute } from './route'

describe('parseRoute', () => {
  it('maps hashes to routes and defaults to the forecast', () => {
    expect(parseRoute('#/evidence')).toBe('evidence')
    expect(parseRoute('#/how-it-works')).toBe('how')
    expect(parseRoute('')).toBe('forecast')
  })
})

describe('applyRouteClass', () => {
  it('adds the class for the current route', () => {
    expect(applyRouteClass([], 'forecast')).toEqual(['route-forecast'])
    expect(documentRouteClass('how')).toBe('route-how')
  })

  it('replaces the previous route class and keeps unrelated classes', () => {
    expect(applyRouteClass(['dark', 'route-forecast'], 'evidence')).toEqual(['dark', 'route-evidence'])
    expect(applyRouteClass(['route-evidence', 'route-how'], 'forecast')).toEqual(['route-forecast'])
  })

  it('does not strip classes that only share the prefix', () => {
    expect(applyRouteClass(['route-forecast-wrap'], 'how')).toEqual(['route-forecast-wrap', 'route-how'])
  })
})
