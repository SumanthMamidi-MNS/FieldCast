import { useEffect, useId, useRef, useState } from 'react'
import { BULLETIN_FIELDS, validateBulletin } from '../../lib/bulletin'
import { formatLongDate } from '../../lib/dates'
import { Icon } from '../common/Icon'

interface BulletinDialogProps {
  open: boolean
  blockName: string | null
  date: string
  /** True while the dashboard is showing the officer's own values. */
  active: boolean
  onSubmit: (blockValues: Record<string, number>) => void
  onClear: () => void
  onClose: () => void
}

/**
 * "Use official bulletin": downscale the officer's own IMD block values instead
 * of the system's. A native <dialog> gives a real modal — focus is trapped,
 * Escape closes it, the page behind is inert — with no library.
 */
export function BulletinDialog({
  open,
  blockName,
  date,
  active,
  onSubmit,
  onClear,
  onClose,
}: BulletinDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [raw, setRaw] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const result = validateBulletin(raw)
    setErrors(result.errors)
    if (result.ok) {
      onSubmit(result.values)
      onClose()
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose()
      }}
    >
      <form className="dialog-inner" onSubmit={submit} noValidate>
        <header className="dialog-head">
          <div>
            <h2 id={`${id}-title`} className="dialog-title">
              Use the official bulletin
            </h2>
            <p id={`${id}-desc`} className="dialog-sub">
              Enter the block values from the IMD bulletin for{' '}
              <strong>{blockName ?? 'this block'}</strong> on <strong>{formatLongDate(date)}</strong>.
              FieldCast refines them to each village. Leave a field blank to keep the system&rsquo;s
              own value.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="bulletin-grid">
          {BULLETIN_FIELDS.map((field) => {
            const inputId = `${id}-${field.key}`
            const error = errors[field.key]
            return (
              <div key={field.key} className={`field${error ? ' has-error' : ''}`}>
                <label htmlFor={inputId} className="field-label">
                  {field.label}
                </label>
                <div className="field-input-wrap">
                  <input
                    id={inputId}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="input"
                    value={raw[field.key] ?? ''}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-err` : undefined}
                    onChange={(e) => setRaw((r) => ({ ...r, [field.key]: e.target.value }))}
                  />
                  <span className="field-unit" aria-hidden>
                    {field.unit}
                  </span>
                </div>
                {error && (
                  <p id={`${inputId}-err`} className="field-error">
                    {error}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {errors._form && (
          <p className="field-error" role="alert">
            {errors._form}
          </p>
        )}

        <footer className="dialog-foot">
          {active && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRaw({})
                setErrors({})
                onClear()
                onClose()
              }}
            >
              Back to standard forecast
            </button>
          )}
          <span className="dialog-foot-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Refine these values
          </button>
        </footer>
      </form>
    </dialog>
  )
}
