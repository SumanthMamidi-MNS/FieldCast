import { memo, useId, useMemo, useState } from 'react'
import type { PanchayatForecast } from '../../types/api'
import type { ColorScale } from '../../lib/colorScale'
import { SORT_LABELS, searchVillages, sortVillages, type VillageSort } from '../../lib/villageList'
import { deltaClass, formatDelta, formatUnitCount, formatValue } from '../../lib/format'
import { variableMeta, type VariableKey } from '../../lib/variables'
import { Icon } from '../common/Icon'
import { SupportChip, TextureSwatch } from '../common/TextureSwatch'
import { UnitTag } from '../common/UnitTag'

interface VillageListProps {
  villages: PanchayatForecast[]
  variableKey: VariableKey
  scale: ColorScale
  selectedId: string | null
  onSelect: (id: string) => void
}

interface VillageRowProps {
  village: PanchayatForecast
  variableKey: VariableKey
  color: string | undefined
  selected: boolean
  onSelect: (id: string) => void
}

/**
 * One row, memoised on plain props: sorting, searching or selecting in a
 * 257-panchayat block then re-renders only the rows whose content changed,
 * and React just moves the rest.
 */
const VillageRow = memo(function VillageRow({ village: v, variableKey, color, selected, onSelect }: VillageRowProps) {
  const variable = v.variables[variableKey]
  const value = variable?.value ?? Number.NaN
  return (
    <li>
      <button
        type="button"
        className={`village-row${selected ? ' is-selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(v.panchayat_id)}
      >
        {variable ? (
          <TextureSwatch support={variable.confidence.support} color={color} size={20} />
        ) : (
          <span className="swatch-empty" aria-hidden />
        )}
        <span className="village-row-main">
          <span className="village-row-title">
            <span className="village-row-name">{v.panchayat_name}</span>
            <UnitTag unitType={v.unit_type} />
          </span>
          {variable && <SupportChip support={variable.confidence.support} compact />}
        </span>
        <span className="village-row-nums">
          <span className="village-row-value num">{formatValue(value, variableKey, variable?.unit)}</span>
          {variable && (
            <span className={`delta num${deltaClass(variable.value, variable.block_value, variableKey)}`}>
              {formatDelta(variable.value, variable.block_value, variableKey, variable.unit)}
              <span className="visually-hidden"> compared with the block forecast</span>
            </span>
          )}
        </span>
      </button>
    </li>
  )
})

/**
 * The map's keyboard-accessible twin, and on a phone the faster way to work:
 * every gram panchayat is a real button with the map's colour, texture and value, and
 * its difference from the block forecast.
 */
export function VillageList({ villages, variableKey, scale, selectedId, onSelect }: VillageListProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<VillageSort>('value-desc')
  const id = useId()
  const meta = variableMeta(variableKey)

  const rows = useMemo(
    () => sortVillages(searchVillages(villages, query), sort, variableKey),
    [villages, query, sort, variableKey],
  )

  return (
    <section className="village-list" aria-labelledby={`${id}-title`}>
      <div className="village-list-head">
        <h3 id={`${id}-title`} className="section-title">
          Gram panchayats <span className="count num">{villages.length}</span>
        </h3>
        <div className="village-tools">
          <label className="search">
            <Icon name="search" size={16} />
            <span className="visually-hidden">Search gram panchayats</span>
            <input
              type="search"
              value={query}
              placeholder="Search names"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="sort">
            <span className="visually-hidden">Sort gram panchayats</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as VillageSort)}>
              {(Object.keys(SORT_LABELS) as VillageSort[]).map((k) => (
                <option key={k} value={k}>
                  {k === 'name' ? SORT_LABELS[k] : `${meta.shortLabel}: ${SORT_LABELS[k].toLowerCase()}`}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" size={14} className="select-chevron" />
          </label>
        </div>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {query ? `${rows.length} of ${formatUnitCount(villages.length)} match.` : ''}
      </p>

      {rows.length === 0 ? (
        <p className="village-empty">
          No panchayat matches “{query}”.{' '}
          <button type="button" className="link-btn" onClick={() => setQuery('')}>
            Clear search
          </button>
        </p>
      ) : (
        <ol className="village-rows">
          {rows.map((v) => {
            const value = v.variables[variableKey]?.value
            return (
              <VillageRow
                key={v.panchayat_id}
                village={v}
                variableKey={variableKey}
                color={value !== undefined ? scale.color(value) : undefined}
                selected={v.panchayat_id === selectedId}
                onSelect={onSelect}
              />
            )
          })}
        </ol>
      )}
    </section>
  )
}
