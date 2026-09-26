/**
 * A small, consistent line-icon set (20-unit grid, 1.75 stroke). Inline SVG so
 * there is no icon-font request and every icon inherits `currentColor`.
 * Icons are decorative by default; pass `label` when one stands alone.
 */

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'arrow-left'
  | 'search'
  | 'print'
  | 'info'
  | 'close'
  | 'calendar'
  | 'file'
  | 'alert'
  | 'refresh'
  | 'layers'
  | 'map-pin'
  | 'gauge'
  | 'mountain'
  | 'check'

const PATHS: Record<IconName, string> = {
  'chevron-left': 'M12.5 4.5 7 10l5.5 5.5',
  'chevron-right': 'M7.5 4.5 13 10l-5.5 5.5',
  'chevron-down': 'M5 7.5 10 12.5l5-5',
  'arrow-left': 'M16 10H4m0 0 5-5m-5 5 5 5',
  search: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.6-1.9L17.5 17.5',
  print: 'M5.5 7.5V3h9v4.5M5.5 14.5h-2v-6a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v6h-2M6 11.5h8V17H6z',
  info: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 9v4.5M10 6.5v.01',
  close: 'M5 5l10 10M15 5 5 15',
  calendar: 'M3.5 5.5h13v11h-13zM3.5 8.5h13M7 3.5v3M13 3.5v3',
  file: 'M11.5 2.5H5.5v15h9V5.5zM11.5 2.5v3h3M8 10h4.5M8 13h4.5',
  alert: 'M10 3 18 17H2zM10 8.5v3.5M10 14.5v.01',
  refresh: 'M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.5h-3.5',
  layers: 'm10 3 7.5 4L10 11 2.5 7zM2.5 10.5 10 14.5l7.5-4M2.5 14 10 18l7.5-4',
  'map-pin': 'M10 17.5s5.5-5 5.5-9.5a5.5 5.5 0 1 0-11 0c0 4.5 5.5 9.5 5.5 9.5ZM10 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  gauge: 'M3 14a7 7 0 1 1 14 0M10 14l3.5-4M3 14h1.5M15.5 14H17M10 7V8.5',
  mountain: 'M1.5 16.5 7.5 6l3.5 6 2-3 5.5 7.5z',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
}

export function Icon({
  name,
  size = 18,
  label,
  className,
}: {
  name: IconName
  size?: number
  label?: string
  className?: string
}) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
