interface SkeletonProps {
  /** CSS height, e.g. '1rem' or '220px'. */
  height?: string
  width?: string
  radius?: string
}

/**
 * Placeholder block. Sized to the content it replaces so nothing shifts when
 * real data lands — an officer should never have a number move under their
 * finger mid-tap.
 */
export function Skeleton({ height = '1rem', width = '100%', radius = '6px' }: SkeletonProps) {
  return <span className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden />
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-stack">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height="0.9rem" width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </div>
  )
}
