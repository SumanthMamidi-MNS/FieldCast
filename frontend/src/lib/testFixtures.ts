/** Minimal forecast fixtures shared by the pure-logic tests. */

import type { AdvisoryItem, PanchayatForecast, SupportLevel, VariableForecast } from '../types/api'

export function variable(
  key: string,
  value: number,
  block: number,
  support: SupportLevel = 'medium',
): VariableForecast {
  return {
    variable: key,
    label: key,
    unit: key === 'precip' ? 'mm' : key === 'humidity' ? '%' : key === 'wind' ? 'km/h' : '°C',
    value,
    block_value: block,
    anomaly: value - block,
    confidence: {
      lower: value - 1,
      upper: value + 1,
      interval_pct: 80,
      support,
      support_label: support,
      support_score: 0.5,
      tier: 'T3',
      tier_note: '',
      nearest_gauge_km: 40,
    },
    rain_probability: key === 'precip' ? 0.4 : null,
  }
}

export function village(
  id: string,
  name: string,
  vars: Record<string, VariableForecast>,
  items: AdvisoryItem[] = [],
): PanchayatForecast {
  return {
    panchayat_id: id,
    panchayat_name: name,
    unit_type: 'village_cluster',
    block_id: 'b',
    block_name: 'Block',
    latitude: 19,
    longitude: 74,
    elevation_m: 600,
    area_km2: 40,
    date: '2023-07-20',
    variables: vars,
    advisory: { headline: '', items, uncertainty_statement: '' },
  }
}

export function item(activity: string, action: AdvisoryItem['action']): AdvisoryItem {
  return { activity, action, reason: '', confidence_caveat: null }
}
