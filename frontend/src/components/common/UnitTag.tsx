import type { UnitType } from '../../types/api'

/**
 * A quiet marker for units that are not official gram panchayats. Real gram
 * panchayats get nothing extra: the tag exists only to flag the approximation.
 */
export function UnitTag({ unitType }: { unitType: UnitType }) {
  if (unitType === 'gram_panchayat') return null
  return (
    <span className="unit-tag" title="Village cluster: about six neighbouring villages, approximate boundary">
      cluster
    </span>
  )
}
