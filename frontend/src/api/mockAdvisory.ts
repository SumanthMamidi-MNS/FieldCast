/**
 * TypeScript port of `backend/app/services/advisory.py`, for the mock API only.
 *
 * This exists so mock advisories are *consistent with the mock numbers* — a
 * panchayat showing 60 mm must not also say "good spraying window". Hand-written
 * advisory strings drift from the data and make the demo lie.
 *
 * When `VITE_USE_MOCK=false` this file is never reached: the real advisory comes
 * from the backend, which is the only place the agronomic thresholds are
 * authoritative. Keep the two in sync or delete this one; do not let the
 * frontend become a second source of agronomic truth.
 */

import type {
  Advisory,
  AdvisoryAction,
  AdvisoryItem,
  SupportLevel,
  VariableForecast,
} from '../types/api'

const THRESHOLDS = {
  sprayRainProbAvoid: 0.4,
  sprayRainProbCaution: 0.2,
  sprayWindAvoidKmh: 20,
  sprayWindCautionKmh: 15,
  irrigationRainSufficientMm: 10,
  irrigationRainPartialMm: 3,
  irrigationHeatStressC: 38,
  harvestRainProbAvoid: 0.35,
  harvestRainAmountAvoidMm: 5,
  fertRunoffRiskMm: 25,
  diseaseHumidityPct: 85,
  diseaseTempMinC: 18,
  diseaseTempMaxC: 30,
  heavyRainMm: 64.5,
  veryHeavyRainMm: 115.5,
} as const

const IRREVERSIBLE = new Set(['Pesticide spraying', 'Fertiliser application', 'Harvesting'])

const LOW_SUPPORT_CAVEAT =
  'Local terrain data is sparse for this panchayat, so this estimate is less certain than for ' +
  'neighbouring areas — confirm against local observation.'
const MEDIUM_SUPPORT_CAVEAT =
  'Moderate confidence for this panchayat; treat the range, not the single number, as the forecast.'

type Vars = Record<string, VariableForecast>

const pct = (p: number) => `${Math.round(p * 100)}%`
const f = (n: number, d = 0) => n.toFixed(d)

function worstSupport(variables: Vars): SupportLevel {
  const order: Record<SupportLevel, number> = { high: 0, medium: 1, low: 2 }
  const levels = Object.values(variables).map((v) => v.confidence.support)
  if (levels.length === 0) return 'low'
  return levels.reduce((worst, s) => (order[s] > order[worst] ? s : worst), 'high' as SupportLevel)
}

function downgrade(action: AdvisoryAction): AdvisoryAction {
  return action === 'proceed' ? 'caution' : action
}

function item(
  activity: string,
  action: AdvisoryAction,
  reason: string,
): AdvisoryItem {
  return { activity, action, reason, confidence_caveat: null }
}

function sprayAdvice(v: Vars): AdvisoryItem | null {
  const rain = v.precip
  const wind = v.wind
  if (!rain && !wind) return null
  const p = rain?.rain_probability ?? 0
  const w = wind?.value ?? 0

  if (p >= THRESHOLDS.sprayRainProbAvoid) {
    return item(
      'Pesticide spraying',
      'avoid',
      `${pct(p)} chance of rain — spray applied now is likely to wash off before it acts, ` +
        `wasting the input and leaving the crop unprotected.`,
    )
  }
  if (w >= THRESHOLDS.sprayWindAvoidKmh) {
    return item(
      'Pesticide spraying',
      'avoid',
      `Wind up to ${f(w)} km/h will carry spray droplets off-target. Wait for calmer ` +
        `conditions, ideally early morning.`,
    )
  }
  if (p >= THRESHOLDS.sprayRainProbCaution || w >= THRESHOLDS.sprayWindCautionKmh) {
    return item(
      'Pesticide spraying',
      'caution',
      `${pct(p)} rain chance and wind up to ${f(w)} km/h — possible but not ideal. Spray early ` +
        `morning and allow a few hours of drying time.`,
    )
  }
  return item(
    'Pesticide spraying',
    'proceed',
    `Low rain chance (${pct(p)}) and light wind (${f(w)} km/h) — good spraying window.`,
  )
}

function irrigationAdvice(v: Vars): AdvisoryItem | null {
  const rain = v.precip
  const tmax = v.tmax
  if (!rain) return null
  const mm = rain.value
  const hot = tmax !== undefined && tmax.value >= THRESHOLDS.irrigationHeatStressC

  if (mm >= THRESHOLDS.irrigationRainSufficientMm) {
    return item(
      'Irrigation',
      'avoid',
      `About ${f(mm)} mm of rain expected here — enough to meet crop water need. Irrigating as ` +
        `well risks waterlogging and wastes water.`,
    )
  }
  if (mm >= THRESHOLDS.irrigationRainPartialMm) {
    return item(
      'Irrigation',
      'caution',
      `About ${f(mm)} mm expected — some help, but not a full replacement. Reduce the planned ` +
        `volume rather than skipping entirely.`,
    )
  }
  if (hot && tmax) {
    return item(
      'Irrigation',
      'proceed',
      `Little rain expected (${f(mm, 1)} mm) with ${f(tmax.value)}°C peak temperature — ` +
        `irrigate, preferably early morning or evening to cut evaporation loss.`,
    )
  }
  return item(
    'Irrigation',
    'proceed',
    `Little rain expected (${f(mm, 1)} mm) — irrigate as per your normal schedule.`,
  )
}

function harvestAdvice(v: Vars): AdvisoryItem | null {
  const rain = v.precip
  if (!rain) return null
  const p = rain.rain_probability ?? 0
  const mm = rain.value

  if (p >= THRESHOLDS.harvestRainProbAvoid || mm >= THRESHOLDS.harvestRainAmountAvoidMm) {
    return item(
      'Harvesting',
      'avoid',
      `${pct(p)} chance of rain (${f(mm)} mm expected) — harvested grain left in the open will ` +
        `take up moisture and risk spoilage. Delay, or ensure covered storage.`,
    )
  }
  return item(
    'Harvesting',
    'proceed',
    `Dry conditions expected (${pct(p)} rain chance) — suitable for harvest and drying.`,
  )
}

function fertiliserAdvice(v: Vars): AdvisoryItem | null {
  const rain = v.precip
  if (!rain) return null
  const mm = rain.value

  if (mm >= THRESHOLDS.fertRunoffRiskMm) {
    return item(
      'Fertiliser application',
      'avoid',
      `Heavy rain expected (${f(mm)} mm) — surface-applied nutrients will wash away before the ` +
        `crop can take them up. Apply after the rain passes.`,
    )
  }
  if (mm >= THRESHOLDS.irrigationRainPartialMm && mm < THRESHOLDS.fertRunoffRiskMm) {
    return item(
      'Fertiliser application',
      'proceed',
      `Light to moderate rain (${f(mm)} mm) will help work the fertiliser into the soil — a ` +
        `favourable window.`,
    )
  }
  return item(
    'Fertiliser application',
    'caution',
    `Very little rain expected (${f(mm, 1)} mm) — irrigate lightly after applying so nutrients ` +
      `reach the root zone.`,
  )
}

function diseaseAdvice(v: Vars): AdvisoryItem | null {
  const rh = v.humidity
  const tmax = v.tmax
  if (!rh || !tmax) return null
  if (
    rh.value >= THRESHOLDS.diseaseHumidityPct &&
    tmax.value >= THRESHOLDS.diseaseTempMinC &&
    tmax.value <= THRESHOLDS.diseaseTempMaxC
  ) {
    return item(
      'Fungal disease watch',
      'caution',
      `${f(rh.value)}% humidity at ${f(tmax.value)}°C is favourable for fungal infection. Scout ` +
        `the crop and consider a preventive fungicide if the spray window allows.`,
    )
  }
  return null
}

function heavyRainItem(v: Vars): AdvisoryItem | null {
  const rain = v.precip
  if (!rain) return null
  // Warn on the plausible high end, not the median. An "if it rains" range is
  // conditional on rain, so weight its upper end by the chance of rain (a rough
  // stand-in for the backend's panchayat-scale estimate); otherwise it would
  // fire on every light day.
  const mm =
    rain.range_basis === 'if_rain'
      ? Math.max(rain.value, (rain.rain_probability ?? 0) * rain.confidence.upper)
      : rain.confidence.upper
  if (mm >= THRESHOLDS.veryHeavyRainMm) {
    return item(
      'Heavy rainfall preparedness',
      'avoid',
      `Upper estimate reaches ${f(mm)} mm — very heavy rainfall is plausible here. Clear field ` +
        `drainage, secure harvested produce, and defer field operations.`,
    )
  }
  if (mm >= THRESHOLDS.heavyRainMm) {
    return item(
      'Heavy rainfall preparedness',
      'caution',
      `Upper estimate reaches ${f(mm)} mm — heavy rainfall is possible. Check drainage and ` +
        `avoid leaving produce uncovered.`,
    )
  }
  return null
}

function headline(v: Vars, items: AdvisoryItem[]): string {
  const parts: string[] = []
  const rain = v.precip
  const tmax = v.tmax
  if (rain) {
    const p = rain.rain_probability ?? 0
    if (p >= 0.6) parts.push(`Rain likely (${pct(p)}), about ${f(rain.value)} mm`)
    else if (p >= 0.3) parts.push(`Rain possible (${pct(p)}), about ${f(rain.value)} mm`)
    else parts.push(`Mostly dry (${pct(p)} rain chance)`)
  }
  if (tmax) parts.push(`peak ${f(tmax.value)}°C`)

  const avoided = items.filter((i) => i.action === 'avoid').map((i) => i.activity.toLowerCase())
  const lead = parts.length > 0 ? parts.join('; ') : 'Forecast available'
  return avoided.length > 0
    ? `${lead}. Hold off on ${avoided.join(', ')}.`
    : `${lead}. No operations need to be postponed.`
}

function uncertaintyStatement(v: Vars, support: SupportLevel): string {
  const values = Object.values(v)
  if (values.length === 0) {
    return (
      'No forecast variables were available for this panchayat, so no confidence can be stated. ' +
      'Do not treat the absence of a warning as an all-clear.'
    )
  }
  const rain = v.precip
  const tier = rain ? rain.confidence.tier : (values[0] as VariableForecast).confidence.tier

  const base: Record<SupportLevel, string> = {
    high:
      'Confidence is good for this panchayat: its terrain is well represented in the training ' +
      'data and an observing station is nearby.',
    medium:
      'Confidence is moderate for this panchayat. Use the stated range rather than the single ' +
      'value when the decision is costly.',
    low:
      'Confidence is low for this panchayat — we have little local terrain or observational ' +
      'support here. Treat this as indicative and verify locally before acting on it.',
  }

  let text = base[support]
  if (rain && rain.range_basis === 'if_rain') {
    text += ` If it rains, the amount is likely between ${f(rain.confidence.lower)} and ${f(
      rain.confidence.upper,
    )} mm.`
  } else if (rain) {
    text += ` Rainfall could plausibly fall anywhere between ${f(rain.confidence.lower)} and ${f(
      rain.confidence.upper,
    )} mm.`
  }
  if (tier === 'T3') {
    text +=
      ' This estimate is produced below the scale at which we can validate against observations, ' +
      'so it is physically-informed inference rather than a measured result.'
  }
  return text
}

export function buildAdvisory(variables: Vars): Advisory {
  const candidates = [
    heavyRainItem(variables),
    sprayAdvice(variables),
    irrigationAdvice(variables),
    harvestAdvice(variables),
    fertiliserAdvice(variables),
    diseaseAdvice(variables),
  ]
  let items = candidates.filter((i): i is AdvisoryItem => i !== null)

  const support = worstSupport(variables)

  if (support === 'low') {
    items = items.map((i) =>
      IRREVERSIBLE.has(i.activity)
        ? { ...i, action: downgrade(i.action), confidence_caveat: LOW_SUPPORT_CAVEAT }
        : { ...i, confidence_caveat: LOW_SUPPORT_CAVEAT },
    )
  } else if (support === 'medium') {
    items = items.map((i) =>
      IRREVERSIBLE.has(i.activity) ? { ...i, confidence_caveat: MEDIUM_SUPPORT_CAVEAT } : i,
    )
  }

  if (items.length === 0) {
    items = [
      item(
        'General',
        'no_guidance',
        'Not enough variables were available to generate specific guidance.',
      ),
    ]
  }

  return {
    headline: headline(variables, items),
    items,
    uncertainty_statement: uncertaintyStatement(variables, support),
  }
}
