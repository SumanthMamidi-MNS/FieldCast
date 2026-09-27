import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BlockSummary } from '../../types/api'
import { normalise } from '../../lib/villageList'
import { formatUnitCount } from '../../lib/format'
import { Icon } from '../common/Icon'

interface BlockComboboxProps {
  blocks: BlockSummary[]
  selectedId: string | null
  onSelect: (blockId: string) => void
  loading: boolean
}

interface Group {
  district: string
  blocks: BlockSummary[]
}

function groupByDistrict(blocks: BlockSummary[]): Group[] {
  const map = new Map<string, BlockSummary[]>()
  for (const b of blocks) {
    const list = map.get(b.district) ?? []
    list.push(b)
    map.set(b.district, list)
  }
  return [...map.entries()]
    .map(([district, list]) => ({
      district,
      blocks: [...list].sort((a, b) => a.block_name.localeCompare(b.block_name)),
    }))
    .sort((a, b) => a.district.localeCompare(b.district))
}

/**
 * Searchable, district-grouped block picker with the keyboard contract of a
 * select: type to filter, arrows to move, Enter to choose, Escape to back out.
 */
export function BlockCombobox({ blocks, selectedId, onSelect, loading }: BlockComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const uid = useId().replace(/:/g, '')
  const listboxId = `${uid}-list`
  const optionId = (i: number) => `${uid}-opt-${i}`

  const selected = blocks.find((b) => b.block_id === selectedId) ?? null

  const filtered = useMemo(() => {
    const q = normalise(query)
    if (!q) return blocks
    return blocks.filter(
      (b) => normalise(b.block_name).includes(q) || normalise(b.district).includes(q),
    )
  }, [blocks, query])

  const groups = useMemo(() => groupByDistrict(filtered), [filtered])
  const flat = useMemo(() => groups.flatMap((g) => g.blocks), [groups])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Start on the current block so Enter keeps it and arrows move from it.
  useEffect(() => {
    if (!open) return
    const i = flat.findIndex((b) => b.block_id === selectedId)
    setActiveIndex(i >= 0 ? i : 0)
    inputRef.current?.focus()
    // Only when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  })

  // Keep the active option in view while arrowing through a long list. Scrolls
  // the listbox only: scrollIntoView would also scroll the page and the
  // overflow-hidden app shell.
  useEffect(() => {
    const list = listRef.current
    const el = open ? document.getElementById(optionId(activeIndex)) : null
    if (!list || !el) return
    const listBox = list.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const stickyHeader = 28
    if (box.top < listBox.top + stickyHeader) list.scrollTop -= listBox.top + stickyHeader - box.top
    else if (box.bottom > listBox.bottom) list.scrollTop += box.bottom - listBox.bottom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, open])

  function close(returnFocus: boolean) {
    setOpen(false)
    setQuery('')
    if (returnFocus) requestAnimationFrame(() => buttonRef.current?.focus())
  }

  const choose = (block: BlockSummary | undefined) => {
    if (!block) return
    onSelect(block.block_id)
    close(true)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(flat[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  let renderIndex = -1

  return (
    <div className="control control-block" ref={wrapRef}>
      <span className="control-label" id={`${uid}-label`}>
        Block
      </span>

      <button
        ref={buttonRef}
        type="button"
        className={`combo-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${uid}-label ${uid}-value`}
        disabled={loading && blocks.length === 0}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="combo-value" id={`${uid}-value`}>
          {selected ? (
            <>
              <span className="combo-name">{selected.block_name}</span>
              <span className="combo-meta">{selected.district}</span>
            </>
          ) : (
            <span className="combo-placeholder">
              {loading ? 'Loading blocks…' : 'Choose a block'}
            </span>
          )}
        </span>
        <Icon name="chevron-down" size={16} className="combo-chevron" />
      </button>

      {open && (
        <div className="combo-popup">
          <div className="combo-search">
            <Icon name="search" size={16} />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search blocks or districts"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length > 0 ? optionId(activeIndex) : undefined}
              placeholder={`Search ${blocks.length} blocks or districts`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul id={listboxId} ref={listRef} role="listbox" aria-label="Blocks by district" className="combo-list">
            {groups.length === 0 && (
              <li className="combo-empty" role="presentation">
                No block or district matches “{query}”.
              </li>
            )}
            {groups.map((group) => (
              <li key={group.district} role="presentation">
                <p className="combo-group" id={`${uid}-g-${group.district.replace(/\W/g, '')}`}>
                  {group.district}
                  <span className="combo-group-count">{group.blocks.length}</span>
                </p>
                <ul role="group" aria-labelledby={`${uid}-g-${group.district.replace(/\W/g, '')}`}>
                  {group.blocks.map((block) => {
                    renderIndex += 1
                    const index = renderIndex
                    const isSelected = block.block_id === selectedId
                    return (
                      <li
                        key={block.block_id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={isSelected}
                        className={`combo-option${index === activeIndex ? ' is-active' : ''}${
                          isSelected ? ' is-selected' : ''
                        }`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(block)}
                      >
                        <span className="combo-option-name">{block.block_name}</span>
                        <span className="combo-option-count num">{formatUnitCount(block.panchayat_count, true)}</span>
                        {isSelected && <Icon name="check" size={16} className="combo-check" />}
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
