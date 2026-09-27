/**
 * Which dates the forecast service can answer, and stepping between them.
 *
 * The API serves two kinds of day, and says which for every region in
 * `GET /api/regions`:
 *   - **replay** (`replay_windows`): past seasons with recorded block values,
 *     re-run from the records the model was evaluated on;
 *   - **live** (`live_days_back` / `live_days_ahead`): around today, from the
 *     current forecast.
 * Anything else is a 422. These windows only drive the hint, the quick-date
 * chip and the day steppers: the backend's answer is always the final word, and
 * its `detail` text is shown if it disagrees.
 *
 * All arithmetic is on UTC calendar days, so a user's timezone can never shift
 * a date by one.
 */

import type { RegionInfo } from '../types/api'

export interface DateWindow {
  start: string
  end: string
  kind: 'replay' | 'live'
}

/** Every date a region can serve, as the API describes it. */
export interface DateCalendar {
  /** Inclusive replay windows, sorted by start. */
  replay: DateWindow[]
  liveBack: number
  liveAhead: number
}

/**
 * Used only when the API does not describe its windows (the in-browser mock,
 * or a backend that predates `replay_windows`). The real list comes from
 * `GET /api/regions`.
 */
export const FALLBACK_CALENDAR: DateCalendar = {
  replay: [
    { start: '2022-06-01', end: '2022-09-30', kind: 'replay' },
    { start: '2023-06-01', end: '2023-09-30', kind: 'replay' },
  ],
  liveBack: 1,
  liveAhead: 15,
}

/** The best-known past day to show first: its example block's terrain is cached. */
const PREFERRED_EXAMPLE = '2023-07-20'

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

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function isWindowPair(w: unknown): w is [string, string] {
  return (
    Array.isArray(w) &&
    typeof w[0] === 'string' &&
    typeof w[1] === 'string' &&
    isIsoDate(w[0]) &&
    isIsoDate(w[1]) &&
    w[0] <= w[1]
  )
}

/**
 * The calendar for one region. Each field falls back on its own, so a partial
 * answer still uses whatever the API did say. An empty `replay_windows` is a
 * real answer (the region has no recorded history) and is kept.
 */
export function calendarFromRegion(region: RegionInfo | null | undefined): DateCalendar {
  if (!region) return FALLBACK_CALENDAR
  const raw: unknown = region.replay_windows
  const replay = Array.isArray(raw)
    ? raw
        .filter(isWindowPair)
        .map(([start, end]): DateWindow => ({ start, end, kind: 'replay' }))
        .sort((a, b) => a.start.localeCompare(b.start))
    : FALLBACK_CALENDAR.replay
  return {
    replay,
    liveBack: nonNegativeInt(region.live_days_back, FALLBACK_CALENDAR.liveBack),
    liveAhead: nonNegativeInt(region.live_days_ahead, FALLBACK_CALENDAR.liveAhead),
  }
}

export function liveWindow(today: string, cal: DateCalendar): DateWindow {
  return { start: addDays(today, -cal.liveBack), end: addDays(today, cal.liveAhead), kind: 'live' }
}

/** Every servable window, sorted by start date. */
export function servableWindows(today: string, cal: DateCalendar): DateWindow[] {
  return [...cal.replay, liveWindow(today, cal)].sort((a, b) => a.start.localeCompare(b.start))
}

export type DateKind = 'replay' | 'live' | 'unavailable'

export function dateKind(iso: string, today: string, cal: DateCalendar): DateKind {
  if (!isIsoDate(iso)) return 'unavailable'
  // Live wins if a replay season and the live horizon ever overlap.
  const live = liveWindow(today, cal)
  if (iso >= live.start && iso <= live.end) return 'live'
  for (const w of cal.replay) if (iso >= w.start && iso <= w.end) return 'replay'
  return 'unavailable'
}

export function isServableDate(iso: string, today: string, cal: DateCalendar): boolean {
  return dateKind(iso, today, cal) !== 'unavailable'
}

/**
 * The next servable day in `direction` (+1 or -1). Steps one day at a time
 * inside a window and jumps the gap between windows, so the arrows never land
 * on a day the API will refuse. Returns null when there is nothing further.
 */
export function stepDate(iso: string, direction: 1 | -1, today: string, cal: DateCalendar): string | null {
  if (!isIsoDate(iso)) return null
  const next = addDays(iso, direction)
  if (isServableDate(next, today, cal)) return next
  const windows = servableWindows(today, cal)
  if (direction === 1) {
    const w = windows.find((x) => x.start > iso)
    return w ? w.start : null
  }
  const w = [...windows].reverse().find((x) => x.end < iso)
  return w ? w.end : null
}

/**
 * A good past day for the "Past season example" chip: 20 Jul 2023 while it is
 * served, otherwise the middle of the most recent replay window. Null when the
 * region has no recorded history.
 */
export function pastSeasonExample(cal: DateCalendar): string | null {
  if (cal.replay.some((w) => PREFERRED_EXAMPLE >= w.start && PREFERRED_EXAMPLE <= w.end)) {
    return PREFERRED_EXAMPLE
  }
  const last = cal.replay[cal.replay.length - 1]
  if (!last) return null
  return addDays(last.start, Math.floor((toMs(last.end) - toMs(last.start)) / DAY_MS / 2))
}

// --- Describing the calendar in words ---------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Span {
  y0: number
  m0: number
  y1: number
  m1: number
}

function spanOf(w: DateWindow): Span {
  return {
    y0: Number(w.start.slice(0, 4)),
    m0: Number(w.start.slice(5, 7)) - 1,
    y1: Number(w.end.slice(0, 4)),
    m1: Number(w.end.slice(5, 7)) - 1,
  }
}

function monthYear(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`
}

/** "2022 & 2023", "2019, 2021 & 2023", or "2019–2023" for an unbroken run of 3+. */
function joinYears(labels: string[], starts: number[]): string {
  if (labels.length === 1) return labels[0] as string
  const unbroken = starts.every((y, i) => i === 0 || y === (starts[i - 1] as number) + 1)
  if (unbroken && labels.length >= 3) return `${labels[0]}–${labels[labels.length - 1]}`
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`
}

/** Windows that touch or overlap become one, so back-to-back seasons read as a single run. */
function mergeWindows(windows: DateWindow[]): DateWindow[] {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start))
  const out: DateWindow[] = []
  for (const w of sorted) {
    const last = out[out.length - 1]
    if (last && addDays(last.end, 1) >= w.start) {
      if (w.end > last.end) last.end = w.end
    } else {
      out.push({ ...w })
    }
  }
  return out
}

/** More distinct groups than this and the list collapses to an overall range. */
const MAX_GROUPS = 3

interface Group {
  months: string
  /** Null for a window that crosses the new year, which is written out in full. */
  years: { label: string; start: number }[] | null
  first: string
}

/**
 * Replay windows in as few words as possible, always generated from the data:
 *   Jun–Sep 2022 & 2023
 *   Jun–Sep 2022 & 2023, Oct 2023–May 2024   (a new-year crossing is written in full)
 *   Oct 2022–Sep 2023                  (back-to-back seasons merge)
 *   7 seasons, Jun 2015–Sep 2023       (too many groups to list)
 * Months are shown, not days; the steppers know the exact edges.
 * Null when there is no recorded history.
 */
export function describeReplay(windows: DateWindow[]): string | null {
  const merged = mergeWindows(windows)
  const first = merged[0]
  const last = merged[merged.length - 1]
  if (!first || !last) return null

  const groups: Group[] = []
  for (const w of merged) {
    const s = spanOf(w)
    // A window that crosses the new year is written out in full ("Oct 2022–Sep
    // 2023"): "Oct–Sep 2022–23" makes the reader do the pairing themselves.
    if (s.y0 !== s.y1) {
      groups.push({ months: `${monthYear(s.y0, s.m0)}–${monthYear(s.y1, s.m1)}`, years: null, first: w.start })
      continue
    }
    const months = s.m0 === s.m1 ? (MONTHS[s.m0] as string) : `${MONTHS[s.m0]}–${MONTHS[s.m1]}`
    const year = { label: String(s.y0), start: s.y0 }
    const same = groups.find((g) => g.years !== null && g.months === months)
    if (same?.years) same.years.push(year)
    else groups.push({ months, years: [year], first: w.start })
  }

  if (groups.length > MAX_GROUPS) {
    const a = spanOf(first)
    const b = spanOf(last)
    return `${merged.length} seasons, ${monthYear(a.y0, a.m0)}–${monthYear(b.y1, b.m1)}`
  }

  return groups
    .map((g) =>
      g.years
        ? `${g.months} ${joinYears(
            g.years.map((y) => y.label),
            g.years.map((y) => y.start),
          )}`
        : g.months,
    )
    .join(', ')
}

function relDays(n: number, sign: '+' | '−'): string {
  return `${sign}${n} day${n === 1 ? '' : 's'}`
}

/** "yesterday to +15 days", "today to tomorrow", "today only". */
export function describeLive(cal: DateCalendar): string {
  const from = cal.liveBack === 0 ? 'today' : cal.liveBack === 1 ? 'yesterday' : relDays(cal.liveBack, '−')
  if (cal.liveAhead === 0) return cal.liveBack === 0 ? 'today only' : `${from} to today`
  const to = cal.liveAhead === 1 ? 'tomorrow' : relDays(cal.liveAhead, '+')
  return `${from} to ${to}`
}

/** The one-line hint beside the date input. */
export function describeCalendar(cal: DateCalendar): string {
  const replay = describeReplay(cal.replay)
  const live = `Live: ${describeLive(cal)}`
  return replay ? `Replay: ${replay} · ${live}` : live
}

// --- Formatting single dates ------------------------------------------------

const LONG = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const MEDIUM = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const SHORT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Thu, 20 Jul 2023". */
export function formatLongDate(iso: string): string {
  return isIsoDate(iso) ? LONG.format(new Date(`${iso}T00:00:00Z`)) : iso
}

/** "20 Jul 2023". */
export function formatMediumDate(iso: string): string {
  return isIsoDate(iso) ? MEDIUM.format(new Date(`${iso}T00:00:00Z`)) : iso
}

/** "20 Jul". */
export function formatShortDate(iso: string): string {
  return isIsoDate(iso) ? SHORT.format(new Date(`${iso}T00:00:00Z`)) : iso
}
