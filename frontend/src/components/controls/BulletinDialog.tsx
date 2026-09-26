import { useId, useState } from 'react'
import { BULLETIN_FIELDS, validateBulletin } from '../lib/bulletin'

interface BulletinFormProps {
  blockName: string | null
  date: string
  /** True while the dashboard is showing the officer's own values. */
  active: boolean
  submitting: boolean
  onSubmit: (blockValues: Record<string, number>) => void
  onClear: () => void
}

/**
 * "Enter official block forecast" — lets an officer downscale their own IMD
 * bulletin instead of the replayed/live block values.
 *
 * Collapsed by default via native <details>, which is keyboard- and
 * screen-reader-accessible with no extra code. Validation runs on submit and
 * errors are tied to their fields with aria-describedby.
 */
export function BulletinForm({
  blockName,
  date,
  active,
  submitting,
  onSubmit,
  onClear,
}: BulletinFormProps) {
  const id = useId()
  const [raw, setRaw] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const result = validateBulletin(raw)
    setErrors(result.errors)
    if (result.ok) onSubmit(result.values)
  }

  return (
    <details className="bulletin" open={active || undefined}>
      <summary className="bulletin-summary">
        Enter official block forecast
        <span className="bulletin-summary-hint">optional — downscale your own bulletin</span>
      </summary>

      <form className="bulletin-form" onSubmit={submit} noValidate>
        <p className="bulletin-help">
          Type the block-level values from the IMD bulletin for{' '}
          <strong>{blockName ?? 'this block'}</strong> on <strong>{date}</strong>. Leave a field
          blank to use the system&rsquo;s own value for it.
        </p>

        <div className="bulletin-grid">
          {BULLETIN_FIELDS.map((field) => {
            const inputId = `${id}-${field.key}`
            const error = errors[field.key]
            return (
              <div key={field.key} className={`bulletin-field${error ? ' has-error' : ''}`}>
                <label htmlFor={inputId} className="bulletin-label">
                  {field.label} <span className="bulletin-unit">({field.unit})</span>
                </label>
                <input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="bulletin-input"
                  value={raw[field.key] ?? ''}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-err` : undefined}
                  onChange={(e) => setRaw((r) => ({ ...r, [field.key]: e.target.value }))}
                />
                {error && (
                  <p id={`${inputId}-err`} className="bulletin-error">
                    {error}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {errors._form && (
          <p className="bulletin-error" role="alert">
            {errors._form}
          </p>
        )}

        <div className="bulletin-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Downscaling…' : 'Downscale this bulletin'}
          </button>
          {active && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRaw({})
                setErrors({})
                onClear()
              }}
            >
              Back to standard forecast
            </button>
          )}
        </div>
      </form>
    </details>
  )
}
