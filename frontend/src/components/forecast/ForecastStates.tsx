import { describeLive, describeReplay, formatLongDate, formatMediumDate, type DateCalendar } from '../../lib/dates'
import { Icon } from '../common/Icon'
import { Skeleton, SkeletonText } from '../common/Skeleton'
import { StatusCard } from '../common/StatusCard'

/** Floating card while a block or date loads; the terrain notice appears after 2 s. */
export function LoadingCard({ blockName, slow }: { blockName: string | null; slow: boolean }) {
  return (
    <div className="loading-card" role="status">
      <span className="spinner" aria-hidden />
      <div>
        <p className="loading-title">Loading {blockName ? `${blockName} block` : 'the forecast'}…</p>
        {slow && (
          <p className="loading-sub">
            First load of a block fetches terrain — about 30 seconds. It is quick after that.
          </p>
        )}
      </div>
    </div>
  )
}

export function EmptyCard({
  exampleName,
  onExample,
}: {
  exampleName: string | null
  onExample: (() => void) | null
}) {
  return (
    <StatusCard
      tone="empty"
      title="Choose a block to begin"
      actions={
        onExample && exampleName ? (
          <button type="button" className="btn btn-primary" onClick={onExample}>
            Open {exampleName} block
          </button>
        ) : null
      }
    >
      <p>
        Pick a block from the bar above. FieldCast will refine its official forecast to every
        gram panchayat inside it.
        {exampleName && ` ${exampleName} loads instantly.`}
      </p>
    </StatusCard>
  )
}

function availabilityText(calendar: DateCalendar): string {
  const replay = describeReplay(calendar.replay)
  const live = `live forecasts from ${describeLive(calendar)}`
  return replay
    ? `Forecasts exist for recorded past seasons (${replay}) and ${live}.`
    : `This region has no recorded past seasons yet; there are ${live}.`
}

export function ErrorCard({
  status,
  message,
  date,
  calendar,
  exampleDate,
  onRetry,
  onExampleDate,
  onToday,
}: {
  status: number | null
  message: string
  date: string
  calendar: DateCalendar
  exampleDate: string | null
  onRetry: () => void
  onExampleDate: (date: string) => void
  onToday: () => void
}) {
  const dateProblem = status === 422
  const offline = status === 0
  const title = dateProblem
    ? `No forecast for ${formatLongDate(date)}`
    : offline
      ? 'Cannot reach the forecast service'
      : 'The forecast could not be loaded'
  const text = message.charAt(0).toUpperCase() + message.slice(1)
  return (
    <StatusCard
      tone="error"
      title={title}
      live
      actions={
        dateProblem ? (
          <>
            {exampleDate && date !== exampleDate && (
              <button type="button" className="btn btn-primary" onClick={() => onExampleDate(exampleDate)}>
                Go to {formatMediumDate(exampleDate)}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onToday}>
              Go to today
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <Icon name="refresh" size={16} /> Try again
          </button>
        )
      }
    >
      <p className="status-detail">{text}</p>
      {dateProblem && (
        <p>{availabilityText(calendar)}</p>
      )}
    </StatusCard>
  )
}

/** Same footprint as the block summary, so nothing jumps when data lands. */
export function SidebarSkeleton() {
  return (
    <div className="summary" aria-hidden>
      <div className="panel-head">
        <Skeleton height="0.8rem" width="45%" />
        <Skeleton height="1.6rem" width="60%" />
        <Skeleton height="0.9rem" width="40%" />
      </div>
      <div className="panel-section">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height="2rem" radius="8px" />
        ))}
      </div>
      <div className="panel-section">
        <SkeletonText lines={2} />
      </div>
      <div className="panel-section">
        <Skeleton height="3rem" radius="8px" />
        <Skeleton height="3rem" radius="8px" />
      </div>
    </div>
  )
}

/** Shown beside the map whenever there is no forecast to summarise. */
export function SidebarGuide() {
  return (
    <div className="guide">
      <p className="eyebrow">How to use FieldCast</p>
      <h2 className="panel-title">Gram-panchayat weather for this week&rsquo;s advice</h2>
      <ol className="guide-steps">
        <li>
          <strong>Pick a block and a date.</strong> FieldCast takes the official block forecast and
          refines it to every gram panchayat inside the block.
        </li>
        <li>
          <strong>Read the map.</strong> Colour shows how each panchayat differs from the block
          forecast. The pattern shows how sure we are.
        </li>
        <li>
          <strong>Pick a panchayat.</strong> See what to tell farmers about spraying, irrigation,
          harvest and fertiliser, and print it for the noticeboard.
        </li>
      </ol>
      <a className="guide-link" href="#/how-it-works">
        How FieldCast works <Icon name="chevron-right" size={16} />
      </a>
    </div>
  )
}
