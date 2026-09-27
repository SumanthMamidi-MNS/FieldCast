/** Plain names and meanings of the three evidence tiers. */

import type { Tier } from '../types/api'

export const TIER_NAME: Record<Tier, string> = {
  T1: 'Grid-checked',
  T2: 'Gauge-checked',
  T3: 'Panchayat-level inference',
}

export const TIER_SUMMARY: Record<Tier, string> = {
  T1: 'Checked against a dense weather grid (about 16 km apart) on seasons the model never saw. Errors at this scale are measured.',
  T2:
    'Checked against real rain gauges never used in training: the few that report today, and about 100 per state ' +
    'in the 1960 monsoon. The closest thing to ground truth that exists here.',
  T3:
    'No panchayat-level measurements exist to check this against, so it is a terrain-informed ' +
    'estimate, not a measured result. Its range is widened to reflect that.',
}
