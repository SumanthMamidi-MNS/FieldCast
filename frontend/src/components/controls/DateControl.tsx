import { useId, useState } from 'react'
import {
  DATE_HINT_SHORT,
  PAST_SEASON_EXAMPLE,
  dateKind,
  formatLongDate,
  isIsoDate,
  stepDate,
} from '../../lib/dates'
import { Icon } from '../common/Icon'

interface DateControlProps {
  value: string
  today: string
  onChange: (date: string) => void
  /** Hide the quick chips (compact phone bar). */
  chips?: boolean
}

/**
 * Forecast date: day steppers that skip the gaps between servable windows, a
 * native date input for jumping, and two quick chips. The servable windows are
 * disjoint, which a native min/max cannot express, so they are stated in words.
 */
export function DateControl({ value, today, onChange, chips = true }: DateControlProps) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  // Keep the draft in step when the date changes from elsewhere.
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value)
  }

  const prev = stepDate(value, -1, today)
  const next = stepDate(value, 1, today)
  const kind = dateKind(value, today)
  const hintId = `${id}-hint`

  return (
    <div className="control control-date">
      <div className="control-label-row">
        <label className="control-label" htmlFor={id}>
          Date
        </label>
        <span id={hintId} className={`control-hint${kind === 'unavailable' ? ' is-warn' : ''}`}>
          {kind === 'unavailable' ? 'No data for this date. ' : ''}
          {DATE_HINT_SHORT}
        </span>
      </div>
      <div className="date-row">
        <div className="date-stepper">
          <button
            type="button"
            className="icon-btn"
            disabled={!prev}
            onClick={() => prev && onChange(prev)}
            aria-label={prev ? `Previous day, ${formatLongDate(prev)}` : 'No earlier date available'}
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <input
            id={id}
            type="date"
            className={`date-input${kind === 'unavailable' ? ' is-warn' : ''}`}
            value={draft}
            aria-describedby={hintId}
            onChange={(e) => {
              setDraft(e.target.value)
              // Only commit complete, real dates; typing "2023-0" must not fire a request.
              if (isIsoDate(e.target.value)) onChange(e.target.value)
            }}
          />
          <button
            type="button"
            className="icon-btn"
            disabled={!next}
            onClick={() => next && onChange(next)}
            aria-label={next ? `Next day, ${formatLongDate(next)}` : 'No later date available'}
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
        {chips && (
          <div className="date-chips" role="group" aria-label="Quick dates">
            <button
              type="button"
              className={`chip${value === today ? ' is-on' : ''}`}
              aria-pressed={value === today}
              onClick={() => onChange(today)}
            >
              Today
            </button>
            <button
              type="button"
              className={`chip${value === PAST_SEASON_EXAMPLE ? ' is-on' : ''}`}
              aria-pressed={value === PAST_SEASON_EXAMPLE}
              onClick={() => onChange(PAST_SEASON_EXAMPLE)}
              title="20 Jul 2023, a monsoon day from a season the model never trained on"
            >
              Past season example
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
