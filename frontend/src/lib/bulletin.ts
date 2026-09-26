/**
 * Validation for an officer-entered block bulletin (POST /api/blocks/{id}/forecast).
 *
 * Bounds are physical plausibility limits, not agronomic thresholds: they catch
 * typos (a 290 °C "29.0", a 2400 mm "24.0") before the model is asked to
 * downscale nonsense. Blank fields are simply omitted — the backend accepts a
 * partial `block_values` map.
 */

export interface BulletinField {
  key: 'precip' | 'tmax' | 'tmin' | 'humidity' | 'wind'
  label: string
  unit: string
  min: number
  max: number
  step: string
}

export const BULLETIN_FIELDS: BulletinField[] = [
  { key: 'precip', label: 'Rainfall', unit: 'mm', min: 0, max: 500, step: '0.1' },
  { key: 'tmax', label: 'Max temperature', unit: '°C', min: -10, max: 55, step: '0.1' },
  { key: 'tmin', label: 'Min temperature', unit: '°C', min: -15, max: 45, step: '0.1' },
  { key: 'humidity', label: 'Humidity', unit: '%', min: 0, max: 100, step: '1' },
  { key: 'wind', label: 'Wind speed', unit: 'km/h', min: 0, max: 200, step: '0.1' },
]

export interface BulletinResult {
  values: Record<string, number>
  /** Field key → message. `_form` holds errors not tied to one field. */
  errors: Record<string, string>
  ok: boolean
}

export function validateBulletin(raw: Record<string, string>): BulletinResult {
  const values: Record<string, number> = {}
  const errors: Record<string, string> = {}

  for (const field of BULLETIN_FIELDS) {
    const text = (raw[field.key] ?? '').trim()
    if (text === '') continue
    // Number('') is 0 and Number('1e3') is valid; require a plain decimal.
    if (!/^-?\d+(\.\d+)?$/.test(text)) {
      errors[field.key] = `${field.label} must be a plain number in ${field.unit}, like 24 or 24.5`
      continue
    }
    const n = Number(text)
    if (n < field.min || n > field.max) {
      errors[field.key] = `${field.label} must be between ${field.min} and ${field.max} ${field.unit}`
      continue
    }
    values[field.key] = n
  }

  if (
    values.tmax !== undefined &&
    values.tmin !== undefined &&
    values.tmin > values.tmax &&
    !errors.tmin
  ) {
    errors.tmin = 'Min temperature cannot be higher than max temperature'
    delete values.tmin
  }

  if (Object.keys(values).length === 0 && Object.keys(errors).length === 0) {
    errors._form = 'Enter at least one value from the bulletin.'
  }

  return { values, errors, ok: Object.keys(errors).length === 0 }
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}
