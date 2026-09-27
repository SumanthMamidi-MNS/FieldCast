/**
 * TypeScript mirror of `backend/app/schemas.py`.
 *
 * This file is a contract, not a convenience layer. Every field below exists in
 * the Pydantic model with the same name and the same nullability. Nothing is
 * invented here: if the dashboard needs a value the API does not return, that is
 * a backend conversation, not a place to add an optional field.
 *
 * Python `X | None` maps to `X | null` (Pydantic serialises absent optionals as
 * null in JSON), not to `?:`.
 */

/** schemas.Tier — how well-grounded a given number actually is. */
export type Tier = 'T1' | 'T2' | 'T3'

/** schemas.SupportLevel */
export type SupportLevel = 'high' | 'medium' | 'low'

/**
 * `unit_type` on PanchayatForecast / PanchayatGeometry. The backend types it
 * as `str` defaulting to "village_cluster"; these are the two values it writes.
 */
export type UnitType = 'gram_panchayat' | 'village_cluster'

/** schemas.AdvisoryAction */
export type AdvisoryAction = 'proceed' | 'caution' | 'avoid' | 'no_guidance'

/** schemas.Confidence */
export interface Confidence {
  /** 10th percentile of the predictive distribution */
  lower: number
  /** 90th percentile of the predictive distribution */
  upper: number
  /** Nominal coverage of [lower, upper]; default 80 */
  interval_pct: number

  /** Epistemic: how well do we know this area? */
  support: SupportLevel
  /** Human-readable support, shown verbatim in the UI */
  support_label: string
  /** 0 = no support, 1 = fully in-distribution */
  support_score: number

  tier: Tier
  /** What validation, if any, backs this number */
  tier_note: string

  /** Distance to the nearest real observing station */
  nearest_gauge_km: number | null
}

/** schemas.VariableForecast */
export interface VariableForecast {
  variable: string
  label: string
  unit: string

  /** Downscaled median estimate */
  value: number
  /** The official block-level value, for comparison */
  block_value: number
  /** value - block_value; the refinement we actually added */
  anomaly: number

  confidence: Confidence

  /**
   * Precipitation only. Deliberately separate from `value`: "70% chance of rain"
   * and "12 mm expected" are different statements.
   */
  rain_probability: number | null

  /**
   * Where `value` comes from. `"model"`: FieldCast's panchayat estimate.
   * `"block"`: the official block value, served because the model did not beat
   * it on validation data (then `value === block_value` and `anomaly === 0`,
   * while `confidence` and `rain_probability` still come from the model and
   * still differ by panchayat). Backend default is `"model"`.
   */
  value_source: 'model' | 'block'
}

/** schemas.AdvisoryItem */
export interface AdvisoryItem {
  activity: string
  action: AdvisoryAction
  reason: string
  confidence_caveat: string | null
}

/** schemas.Advisory */
export interface Advisory {
  headline: string
  items: AdvisoryItem[]
  /** The honest caveat, always present, never buried */
  uncertainty_statement: string
}

/** schemas.PanchayatForecast */
export interface PanchayatForecast {
  panchayat_id: string
  panchayat_name: string
  /** Real LGD gram-panchayat boundary, or an approximate village cluster. */
  unit_type: UnitType
  block_id: string
  block_name: string

  latitude: number
  longitude: number
  elevation_m: number
  area_km2: number

  /** ISO date (YYYY-MM-DD) */
  date: string
  variables: Record<string, VariableForecast>

  advisory: Advisory
}

/** schemas.Differentiation */
export interface Differentiation {
  /** max-min across panchayats within the block, per variable */
  variable_spread: Record<string, number>
  /** True if at least one variable is differentiated beyond noise */
  meaningful: boolean
  note: string
}

/** schemas.BlockForecastResponse */
export interface BlockForecastResponse {
  block_id: string
  block_name: string
  district: string
  state: string
  /** ISO date (YYYY-MM-DD) */
  date: string

  panchayat_count: number
  panchayats: PanchayatForecast[]

  differentiation: Differentiation

  model_version: string
  generated_at: string
}

/** schemas.BlockSummary */
export interface BlockSummary {
  block_id: string
  block_name: string
  district: string
  state: string
  panchayat_count: number
  centroid_lat: number
  centroid_lon: number
}

/**
 * The `geometry: dict` field of schemas.PanchayatGeometry, narrowed to the two
 * shapes an administrative outline can actually take.
 */
export type GeoJsonPolygon = {
  type: 'Polygon'
  /** [ring][vertex][lon, lat] */
  coordinates: number[][][]
}

export type GeoJsonMultiPolygon = {
  type: 'MultiPolygon'
  /** [polygon][ring][vertex][lon, lat] */
  coordinates: number[][][][]
}

export type GeoJsonGeometry = GeoJsonPolygon | GeoJsonMultiPolygon

/** schemas.PanchayatGeometry — GeoJSON-ready panchayat outline for the map. */
export interface PanchayatGeometry {
  panchayat_id: string
  panchayat_name: string
  /** Real LGD gram-panchayat boundary, or an approximate village cluster. */
  unit_type: UnitType
  block_id: string
  /** Raw GeoJSON geometry object (Polygon / MultiPolygon) */
  geometry: GeoJsonGeometry
  centroid_lat: number
  centroid_lon: number
  elevation_m: number
  area_km2: number
}

/** schemas.BaselineComparison */
export interface BaselineComparison {
  variable: string
  label: string
  unit: string
  model_mae: number
  naive_mae: number
  /** 1 - model_mae/naive_mae; > 0 means we beat naive */
  skill_score: number
  /** Empirical coverage of the 80% interval */
  interval_coverage: number
  n_observations: number
  tier: Tier
  region: string
}

/** schemas.HealthResponse */
export interface HealthResponse {
  status: string
  model_loaded: boolean
  model_version: string | null
  regions_available: string[]
  offline_mode: boolean
}

/** main.RegionInfo — `GET /api/regions`. */
export interface RegionInfo {
  key: string
  state: string
  districts: string[]
  /** True when this region has its own trained models. */
  served: boolean
  /**
   * Inclusive [start, end] ISO dates with recorded block values (historical
   * replay). Backend default is `[]`. Optional here only because the
   * in-browser mock and older backends omit it; `lib/dates.ts` falls back then.
   */
  replay_windows?: [string, string][]
  /** Live forecasts reach this many days before today (backend default 1). */
  live_days_back?: number
  /** Live forecasts reach this many days after today (backend default 15). */
  live_days_ahead?: number
}

/*
 * `GET /api/evaluation/reports` returns every `reports/evaluation_*.json`
 * verbatim, keyed by file stem. The backend types it only as `dict`, so the
 * shapes below mirror what `backend/pipeline/evaluate` writes. Everything that
 * a report could plausibly omit is optional: the Evidence page must degrade
 * gracefully rather than crash on an older or partial report.
 */

/** Rain / no-rain skill, present on rainfall rows. */
export interface EvaluationOccurrence {
  brier: number
  brier_skill_vs_climatology?: number
  /** Brier score of the naive "block value decides wet/dry" call. */
  brier_naive_block: number
  base_rate?: number
  /** [mean forecast probability, observed frequency, count] per bin. */
  reliability?: [number, number, number][]
}

export interface EvaluationBaseline {
  mae: number
  /** 1 - model_mae / this baseline's MAE; > 0 means the model beats it. */
  model_skill_vs_this: number
}

/** One variable at one tier of one report. */
export interface EvaluationRow {
  variable: string
  label: string
  unit: string
  n: number
  /** Blocks (T1) or gauges (T2) the bootstrap resamples over. */
  n_clusters?: number
  model_mae: number
  naive_mae: number
  /** 1 - model_mae / naive_mae. */
  skill_vs_naive: number
  /** 90% cluster-bootstrap interval of skill_vs_naive. */
  skill_ci90?: [number, number]
  /** Plain-language verdict written by the evaluator. */
  verdict?: string
  interval_coverage_80?: number
  interval_width?: number
  mean_support?: number
  baselines?: Record<string, EvaluationBaseline>
  /** Skill after block-mean reconciliation — what the API actually serves. */
  reconciled_skill_vs_naive?: number
  occurrence?: EvaluationOccurrence
  /**
   * True when the API serves the official block value for this variable's
   * point, because the model did not beat it on validation data. Skill is then
   * 0 by design.
   */
  point_is_block?: boolean
  /** Served-point skill on the validation data that decided the serving policy. */
  validation_served_skill?: number
  /** The model's own skill on this test data, before the serving policy. */
  raw_model_skill_vs_naive?: number
}

/** How much the point-scale interval was widened for one variable, and on what. */
export interface EvaluationScaleCalibration {
  factor: number
  n?: number
  n_gauges?: number
  /** Inclusive [start, end] ISO date ranges the factor was fitted on. */
  periods?: [string, string][]
}

export interface EvaluationReport {
  region: string
  model_region?: string
  /** True when the models were trained on a different region. */
  transfer?: boolean
  generated_at?: string
  scale_calibration?: Record<string, EvaluationScaleCalibration>
  T1?: Record<string, EvaluationRow>
  /** Modern rain gauges (a handful per state). */
  T2?: Record<string, EvaluationRow>
  /**
   * Historical rain gauges (1960 monsoon, ~100 per state, never used in
   * training). `{}` until the historical data has been downloaded.
   */
  T2_hist?: Record<string, EvaluationRow>
}

/** `GET /api/evaluation/reports`, keyed by report file stem. */
export type EvaluationReports = Record<string, EvaluationReport>
