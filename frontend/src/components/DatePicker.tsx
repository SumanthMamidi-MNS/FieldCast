import { useId, useState } from 'react'
import { DATE_HINT } from '../api/client'
import { isIsoDate } from '../lib/bulletin'

interface DatePickerProps {
  value: string
  onChange: (date: string) => void
}

/**
 * Forecast date. The available dates are two disjoint windows (past monsoon
 * replays and the live forecast horizon), which a native min/max cannot
 * express — so the rule is stated in words next to the field, and the backend's
 * own 422 message is shown if a date falls outside it.
 */
export function DatePicker({ value, onChange }: DatePickerProps) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  // Keep the draft in step if the date is changed from elsewhere.
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value)
  }

  return (
    <div className="date-picker">
      <label className="field-label" htmlFor={id}>
        Forecast date
      </label>
      <input
        id={id}
        type="date"
        className="date-input"
        value={draft}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setDraft(e.target.value)
          // Only commit complete, real dates; typing "2023-0" must not fire a request.
          if (isIsoDate(e.target.value)) onChange(e.target.value)
        }}
      />
      <p id={`${id}-hint`} className="field-hint">
        {DATE_HINT}
      </p>
    </div>
  )
}
