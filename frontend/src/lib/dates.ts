/**
 * Which dates the forecast service can answer, and stepping between them.
 *
 * The API serves two kinds of day:
 *   - **replay**: past monsoon seasons, re-run from the records the model was
 *     evaluated on;
 *   - **live**: yesterday up to 15 days ahead, from the current forecast.
 * Anything else is a 422. These windows only drive hints and the day
 * steppers: the backend's answer is always the final word, and its `detail`
 * text is shown if it disagrees.
 *
 * All arithmetic is on UTC calendar days, so a user's timezone can never shift
 * a date by one.
 */

export interface DateWindow {
  start: string
  end: string
  kind: 'replay' | 'live'
}

/**
 * Replay seasons the API currently serves (checked against the running API).
 * backend/config.py also lists an Oct 2022 – May 2023 test season, but the
 * forecast endpoint returns 422 for those dates today, so they are not offered.
 */
export const REPLAY_WINDOWS: DateWindow[] = [
  { start: '2022-06-01', end: '2022-09-30', kind: 'replay' },
  { start: '2023-06-01', end: '2023-09-30', kind: 'replay' },
]

export const LIVE_BACK_DAYS = 1
export const LIVE_AHEAD_DAYS = 15

export const PAST_SEASON_EXAMPLE = '2023-07-20'

export const DATE_HINT_SHORT = 'Past monsoons: Jun–Sep 2022 & 2023 · Live: yesterday to +15 days'

const DAY_MS = 86_400_000

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const d = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

function toMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return fromMs(toMs(iso) + days * DAY_MS)
}

/** Today's local calendar date as YYYY-MM-DD (what the officer calls "today"). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function liveWindow(today: string): DateWindow {
  return { start: addDays(today, -LIVE_BACK_DAYS), end: addDays(today, LIVE_AHEAD_DAYS), kind: 'live' }
}

/** Every servable window, sorted by start date. */
export function servableWindows(today: string): DateWindow[] {
  return [...REPLAY_WINDOWS, liveWindow(today)].sort((a, b) => a.start.localeCompare(b.start))
}

export type DateKind = 'replay' | 'live' | 'unavailable'

export function dateKind(iso: string, today: string): DateKind {
  if (!isIsoDate(iso)) return 'unavailable'
  // Live wins if a replay season and the live horizon ever overlap.
  const live = liveWindow(today)
  if (iso >= live.start && iso <= live.end) return 'live'
  for (const w of REPLAY_WINDOWS) if (iso >= w.start && iso <= w.end) return 'replay'
  return 'unavailable'
}

export function isServableDate(iso: string, today: string): boolean {
  return dateKind(iso, today) !== 'unavailable'
}

/**
 * The next servable day in `direction` (+1 or -1). Steps one day at a time
 * inside a window and jumps the gap between windows, so the arrows never land
 * on a day the API will refuse. Returns null when there is nothing further.
 */
export function stepDate(iso: string, direction: 1 | -1, today: string): string | null {
  if (!isIsoDate(iso)) return null
  const next = addDays(iso, direction)
  if (isServableDate(next, today)) return next
  const windows = servableWindows(today)
  if (direction === 1) {
    const w = windows.find((x) => x.start > iso)
    return w ? w.start : null
  }
  const w = [...windows].reverse().find((x) => x.end < iso)
  return w ? w.end : null
}

const LONG = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const SHORT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Thu, 20 Jul 2023". */
export function formatLongDate(iso: string): string {
  return isIsoDate(iso) ? LONG.format(new Date(`${iso}T00:00:00Z`)) : iso
}

/** "20 Jul". */
export function formatShortDate(iso: string): string {
  return isIsoDate(iso) ? SHORT.format(new Date(`${iso}T00:00:00Z`)) : iso
}
