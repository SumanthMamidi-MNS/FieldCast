import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BlockSummary } from '../types/api'

interface BlockSelectorProps {
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
 * Searchable, district-grouped block picker.
 *
 * Implemented as a real combobox rather than a styled `<select>` because the
 * list is grouped and searchable, but it keeps the keyboard contract a select
 * has: type to filter, arrows to move, Enter to choose, Escape to back out.
 */
export function BlockSelector({ blocks, selectedId, onSelect, loading }: BlockSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-opt-${i}`

  const selected = blocks.find((b) => b.block_id === selectedId) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return blocks
    return blocks.filter(
      (b) =>
        b.block_name.toLowerCase().includes(q) ||
        b.district.toLowerCase().includes(q) ||
        b.state.toLowerCase().includes(q),
    )
  }, [blocks, query])

  const groups = useMemo(() => groupByDistrict(filtered), [filtered])
  /** Flat order matching what is rendered, so arrow keys track the visual list. */
  const flat = useMemo(() => groups.flatMap((g) => g.blocks), [groups])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const choose = (block: BlockSummary | undefined) => {
    if (!block) return
    onSelect(block.block_id)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActiveIndex((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault()
        choose(flat[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    } else if (e.key === 'Home' && open) {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End' && open) {
      e.preventDefault()
      setActiveIndex(Math.max(0, flat.length - 1))
    }
  }

  let renderIndex = -1

  return (
    <div className="block-selector" ref={wrapRef}>
      <label className="field-label" htmlFor={`${listboxId}-input`}>
        Block
      </label>

      {open ? (
        <input
          id={`${listboxId}-input`}
          ref={inputRef}
          className="block-selector-input"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length > 0 ? optionId(activeIndex) : undefined}
          placeholder="Search block or district…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          id={`${listboxId}-input`}
          type="button"
          className="block-selector-button"
          aria-haspopup="listbox"
          aria-expanded="false"
          disabled={loading && blocks.length === 0}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        >
          <span className="block-selector-value">
            {selected ? selected.block_name : loading ? 'Loading blocks…' : 'Choose a block'}
          </span>
          {selected && (
            <span className="block-selector-meta">
              {selected.district} district · {selected.panchayat_count} panchayats
            </span>
          )}
          <svg className="chevron" viewBox="0 0 16 16" aria-hidden focusable="false">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}

      {open && (
        <div className="block-selector-popup">
          <ul id={listboxId} role="listbox" aria-label="Blocks by district" className="block-list">
            {groups.length === 0 && (
              <li className="block-empty" role="presentation">
                No block matches “{query}”.
              </li>
            )}
            {groups.map((group) => (
              <li key={group.district} role="presentation">
                <p className="block-group-label" id={`${listboxId}-g-${group.district}`}>
                  {group.district}
                </p>
                <ul role="group" aria-labelledby={`${listboxId}-g-${group.district}`}>
                  {group.blocks.map((block) => {
                    renderIndex += 1
                    const index = renderIndex
                    const isActive = index === activeIndex
                    return (
                      <li
                        key={block.block_id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={block.block_id === selectedId}
                        className={`block-option${isActive ? ' is-active' : ''}${
                          block.block_id === selectedId ? ' is-selected' : ''
                        }`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(block)}
                      >
                        <span className="block-option-name">{block.block_name}</span>
                        <span className="block-option-count">
                          {block.panchayat_count} panchayats
                        </span>
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
