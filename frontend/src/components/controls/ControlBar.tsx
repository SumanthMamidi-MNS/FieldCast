import { useId, useState } from 'react'
import type { BlockSummary, RegionInfo } from '../../types/api'
import { formatLongDate, stepDate } from '../../lib/dates'
import { Icon } from '../common/Icon'
import { BlockCombobox } from './BlockCombobox'
import { DateControl } from './DateControl'
import { RegionSelect } from './RegionSelect'

export interface ControlBarProps {
  regions: RegionInfo[]
  regionsLoading: boolean
  region: string
  onRegion: (key: string) => void
  blocks: BlockSummary[]
  blocksLoading: boolean
  blockId: string | null
  onBlock: (id: string) => void
  date: string
  today: string
  onDate: (date: string) => void
  bulletinActive: boolean
  bulletinDisabled: boolean
  onOpenBulletin: () => void
  /** Phone layout: one summary row that expands into the full controls. */
  compact: boolean
}

function BulletinButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`btn ${active ? 'btn-accent' : 'btn-secondary'} bulletin-btn`}
      disabled={disabled}
      onClick={onClick}
      aria-haspopup="dialog"
    >
      <Icon name="file" size={17} />
      {active ? 'Bulletin applied' : 'Use official bulletin'}
    </button>
  )
}

export function ControlBar(props: ControlBarProps) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const block = props.blocks.find((b) => b.block_id === props.blockId) ?? null

  const full = (
    <>
      <RegionSelect
        regions={props.regions}
        value={props.region}
        onChange={props.onRegion}
        loading={props.regionsLoading}
      />
      <BlockCombobox
        blocks={props.blocks}
        selectedId={props.blockId}
        onSelect={(id) => {
          props.onBlock(id)
          if (props.compact) setExpanded(false)
        }}
        loading={props.blocksLoading}
      />
      <DateControl value={props.date} today={props.today} onChange={props.onDate} />
      <div className="control control-action">
        <BulletinButton
          active={props.bulletinActive}
          disabled={props.bulletinDisabled}
          onClick={props.onOpenBulletin}
        />
      </div>
    </>
  )

  if (!props.compact) {
    return (
      <div className="controlbar" role="region" aria-label="Forecast controls">
        {full}
      </div>
    )
  }

  const prev = stepDate(props.date, -1, props.today)
  const next = stepDate(props.date, 1, props.today)

  return (
    <div className="controlbar is-compact" role="region" aria-label="Forecast controls">
      <div className="compact-row">
        <button
          type="button"
          className="compact-summary"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="compact-summary-text">
            <span className="compact-block">{block ? block.block_name : 'Choose a block'}</span>
            <span className="compact-meta">
              {formatLongDate(props.date)}
              {props.bulletinActive ? ' · your bulletin' : ''}
            </span>
          </span>
          <span className="compact-edit">
            {expanded ? 'Done' : 'Change'}
            <Icon name="chevron-down" size={16} className={expanded ? 'is-flipped' : undefined} />
          </span>
        </button>
        <div className="date-stepper compact-stepper">
          <button
            type="button"
            className="icon-btn"
            disabled={!prev}
            onClick={() => prev && props.onDate(prev)}
            aria-label="Previous day"
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!next}
            onClick={() => next && props.onDate(next)}
            aria-label="Next day"
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
      <div id={panelId} className="compact-panel" hidden={!expanded}>
        {full}
      </div>
    </div>
  )
}
