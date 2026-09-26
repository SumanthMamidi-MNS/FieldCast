import { describe, expect, it } from 'vitest'
import type { RegionInfo } from '../types/api'
import {
  FALLBACK_CALENDAR,
  addDays,
  calendarFromRegion,
  dateKind,
  describeCalendar,
  describeLive,
  describeReplay,
  isIsoDate,
  isServableDate,
  pastSeasonExample,
  stepDate,
  todayIso,
  type DateCalendar,
  type DateWindow,
} from './dates'

const TODAY = '2026-09-26'

const region = (extra: Partial<RegionInfo>): RegionInfo => ({
  key: 'mh_ghats',
  state: 'Maharashtra',
  districts: [],
  served: true,
  ...extra,
})

// What the running API returns today.
const API = calendarFromRegion(
  region({
    replay_windows: [
      ['2022-06-01', '2022-09-30'],
      ['2023-06-01', '2023-09-30'],
    ],
    live_days_back: 1,
    live_days_ahead: 15,
  }),
)

const w = (start: string, end: string): DateWindow => ({ start, end, kind: 'replay' })

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2023-06-30', 1)).toBe('2023-07-01')
    expect(addDays('2023-01-01', -1)).toBe('2022-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })
})

describe('todayIso', () => {
  it('uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 8, 26, 23, 59))).toBe('2026-09-26')
  })
})

describe('calendarFromRegion', () => {
  it('reads the windows and live horizon from the API', () => {
    const cal = calendarFromRegion(
      region({ replay_windows: [['2023-10-01', '2024-05-31']], live_days_back: 2, live_days_ahead: 7 }),
    )
    expect(cal.replay).toEqual([w('2023-10-01', '2024-05-31')])
    expect(cal.liveBack).toBe(2)
    expect(cal.liveAhead).toBe(7)
  })

  it('falls back only for missing fields (mock mode, older backends)', () => {
    expect(calendarFromRegion(null)).toBe(FALLBACK_CALENDAR)
    const cal = calendarFromRegion(region({}))
    expect(cal.replay).toEqual(FALLBACK_CALENDAR.replay)
    expect(cal.liveAhead).toBe(15)
  })

  it('keeps an empty list as "no recorded history"', () => {
    expect(calendarFromRegion(region({ replay_windows: [] })).replay).toEqual([])
  })

  it('sorts windows and drops malformed ones', () => {
    const cal = calendarFromRegion(
      region({
        replay_windows: [
          ['2023-06-01', '2023-09-30'],
          ['2022-06-01', '2022-09-30'],
          ['2023-13-01', '2023-14-01'],
          ['2023-09-30', '2023-06-01'],
        ],
      }),
    )
    expect(cal.replay.map((x) => x.start)).toEqual(['2022-06-01', '2023-06-01'])
  })
})

describe('valid-date checks', () => {
  it('accepts the replay windows', () => {
    expect(dateKind('2022-06-01', TODAY, API)).toBe('replay')
    expect(dateKind('2023-07-20', TODAY, API)).toBe('replay')
    expect(dateKind('2023-09-30', TODAY, API)).toBe('replay')
  })

  it('accepts the live horizon from the API', () => {
    expect(dateKind('2026-09-25', TODAY, API)).toBe('live')
    expect(dateKind('2026-10-11', TODAY, API)).toBe('live')
    const short: DateCalendar = { ...API, liveBack: 0, liveAhead: 3 }
    expect(dateKind('2026-09-25', TODAY, short)).toBe('unavailable')
    expect(dateKind('2026-09-29', TODAY, short)).toBe('live')
  })

  it('rejects everything else', () => {
    expect(isServableDate('2022-05-31', TODAY, API)).toBe(false)
    expect(isServableDate('2023-01-15', TODAY, API)).toBe(false)
    expect(isServableDate('2026-09-24', TODAY, API)).toBe(false)
    expect(isServableDate('2026-10-12', TODAY, API)).toBe(false)
    expect(isServableDate('2023-02-30', TODAY, API)).toBe(false)
    expect(isIsoDate('2023-7-20')).toBe(false)
  })

  it('serves the dry season as soon as the API lists it', () => {
    const cal: DateCalendar = { ...API, replay: [...API.replay, w('2022-10-01', '2023-05-31')] }
    expect(dateKind('2023-01-15', TODAY, cal)).toBe('replay')
  })
})

describe('stepDate', () => {
  it('moves one day inside a window', () => {
    expect(stepDate('2023-07-20', 1, TODAY, API)).toBe('2023-07-21')
    expect(stepDate('2023-07-20', -1, TODAY, API)).toBe('2023-07-19')
  })

  it('jumps the gap between seasons instead of landing on a refused day', () => {
    expect(stepDate('2022-09-30', 1, TODAY, API)).toBe('2023-06-01')
    expect(stepDate('2023-06-01', -1, TODAY, API)).toBe('2022-09-30')
    expect(stepDate('2023-09-30', 1, TODAY, API)).toBe('2026-09-25')
  })

  it('finds the nearest window from an unavailable date', () => {
    expect(stepDate('2023-01-15', 1, TODAY, API)).toBe('2023-06-01')
    expect(stepDate('2023-01-15', -1, TODAY, API)).toBe('2022-09-30')
  })

  it('stops at the ends', () => {
    expect(stepDate('2022-06-01', -1, TODAY, API)).toBeNull()
    expect(stepDate('2026-10-11', 1, TODAY, API)).toBeNull()
    expect(stepDate('garbage', 1, TODAY, API)).toBeNull()
  })

  it('only steps through live days when there is no history', () => {
    const cal: DateCalendar = { ...API, replay: [] }
    expect(stepDate('2026-09-25', -1, TODAY, cal)).toBeNull()
    expect(stepDate('2023-07-20', 1, TODAY, cal)).toBe('2026-09-25')
  })
})

describe('pastSeasonExample', () => {
  it('prefers 20 Jul 2023 while it is served', () => {
    expect(pastSeasonExample(API)).toBe('2023-07-20')
  })

  it('otherwise picks the middle of the latest window', () => {
    expect(pastSeasonExample({ ...API, replay: [w('2024-06-01', '2024-09-30')] })).toBe('2024-07-31')
  })

  it('is null without history', () => {
    expect(pastSeasonExample({ ...API, replay: [] })).toBeNull()
  })
})

describe('describing the calendar', () => {
  it('writes the current API answer in one short line', () => {
    expect(describeCalendar(API)).toBe('Replay: Jun–Sep 2022 & 2023 · Live: yesterday to +15 days')
  })

  it('omits replay when there is none', () => {
    expect(describeCalendar({ ...API, replay: [] })).toBe('Live: yesterday to +15 days')
  })

  it('merges back-to-back seasons into one run', () => {
    expect(
      describeReplay([w('2022-06-01', '2022-09-30'), w('2022-10-01', '2023-05-31'), w('2023-06-01', '2023-09-30')]),
    ).toBe('Jun 2022–Sep 2023')
  })

  it('groups same-month seasons by year and keeps others apart', () => {
    expect(
      describeReplay([w('2022-06-01', '2022-09-30'), w('2023-06-01', '2023-09-30'), w('2023-11-01', '2024-04-30')]),
    ).toBe('Jun–Sep 2022 & 2023, Nov–Apr 2023–24')
    expect(describeReplay([w('2019-06-01', '2019-09-30'), w('2021-06-01', '2021-09-30'), w('2023-06-01', '2023-09-30')])).toBe(
      'Jun–Sep 2019, 2021 & 2023',
    )
    expect(
      describeReplay(['2019', '2020', '2021', '2022'].map((y) => w(`${y}-06-01`, `${y}-09-30`))),
    ).toBe('Jun–Sep 2019–2022')
  })

  it('collapses many different windows to a count and span', () => {
    expect(
      describeReplay([
        w('2018-01-01', '2018-02-28'),
        w('2019-04-01', '2019-05-31'),
        w('2020-07-01', '2020-08-31'),
        w('2021-10-01', '2021-11-30'),
      ]),
    ).toBe('4 seasons, Jan 2018–Nov 2021')
  })

  it('handles a single month and an empty list', () => {
    expect(describeReplay([w('2023-07-01', '2023-07-31')])).toBe('Jul 2023')
    expect(describeReplay([])).toBeNull()
  })

  it('words the live horizon', () => {
    expect(describeLive({ ...API, liveBack: 0, liveAhead: 1 })).toBe('today to tomorrow')
    expect(describeLive({ ...API, liveBack: 0, liveAhead: 0 })).toBe('today only')
    expect(describeLive({ ...API, liveBack: 3, liveAhead: 7 })).toBe('−3 days to +7 days')
  })
})
