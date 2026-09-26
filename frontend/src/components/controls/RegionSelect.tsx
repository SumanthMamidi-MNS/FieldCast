import { useId } from 'react'
import type { RegionInfo } from '../../types/api'
import { regionName } from '../../lib/evidence'
import { Icon } from '../common/Icon'

interface RegionSelectProps {
  regions: RegionInfo[]
  value: string
  onChange: (key: string) => void
  loading: boolean
}

/**
 * Native select: it is the most dependable control on a low-end phone, and
 * a region changes rarely. Regions without their own trained models are listed
 * but disabled, because serving them would mean serving a model the transfer
 * test showed to be worse than the block value for rainfall.
 */
export function RegionSelect({ regions, value, onChange, loading }: RegionSelectProps) {
  const id = useId()
  const known = regions.some((r) => r.key === value)
  return (
    <div className="control control-region">
      <label className="control-label" htmlFor={id}>
        Region
      </label>
      <div className="select-wrap">
        <select
          id={id}
          className="select"
          value={value}
          disabled={loading && regions.length === 0}
          onChange={(e) => onChange(e.target.value)}
        >
          {!known && <option value={value}>{loading ? 'Loading…' : regionName(value)}</option>}
          {regions.map((r) => (
            <option key={r.key} value={r.key} disabled={!r.served}>
              {r.state}
              {r.served ? '' : ' (coming soon)'}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} className="select-chevron" />
      </div>
    </div>
  )
}
