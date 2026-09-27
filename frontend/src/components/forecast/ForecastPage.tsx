import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_DATE, DEFAULT_REGION, api } from '../../api/client'
import { useAsync } from '../../hooks/useAsync'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { MOBILE_QUERY, prefersReducedMotion, useMediaQuery } from '../../hooks/useMediaQuery'
import { calendarFromRegion, dateKind, pastSeasonExample, todayIso } from '../../lib/dates'
import { blockScale, blockValueOf, type BlockScale } from '../../lib/mapScale'
import { VARIABLE_ORDER, VARIABLES, isVariableKey, type VariableKey } from '../../lib/variables'
import { ControlBar } from '../controls/ControlBar'
import { BulletinDialog } from '../controls/BulletinDialog'
import { VillageDetail } from '../village/VillageDetail'
import { BlockSummary } from './BlockSummary'
import { EmptyCard, ErrorCard, LoadingCard, SidebarGuide, SidebarSkeleton } from './ForecastStates'
import { MapPanel } from './MapPanel'

/** Terrain for this block is cached, so it is the instant example. */
const EXAMPLE_BLOCK = 'IND.20.1.1_1'

const STORE_REGION = 'fieldcast.region'
const STORE_BLOCK = 'fieldcast.block'
const STORE_VARIABLE = 'fieldcast.variable'

export function ForecastPage({ active }: { active: boolean }) {
  const compact = useMediaQuery(MOBILE_QUERY)
  const [today] = useState(() => todayIso())

  const [region, setRegion] = useLocalStorage(STORE_REGION, DEFAULT_REGION)
  const [storedBlock, setStoredBlock] = useLocalStorage(STORE_BLOCK, '')
  const [storedVariable, setStoredVariable] = useLocalStorage(STORE_VARIABLE, 'precip')
  const [date, setDate] = useState(DEFAULT_DATE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bulletin, setBulletin] = useState<Record<string, number> | null>(null)
  const [bulletinOpen, setBulletinOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  const variableKey: VariableKey = isVariableKey(storedVariable) ? storedVariable : 'precip'

  // --- Data ------------------------------------------------------------------
  const regions = useAsync(() => api.getRegions(), [])
  const calendar = useMemo(
    () => calendarFromRegion(regions.data?.find((r) => r.key === region)),
    [regions.data, region],
  )
  const exampleDate = pastSeasonExample(calendar)
  const blocks = useAsync(() => api.getBlocks(region), [region])
  const blockList = useMemo(() => blocks.data ?? [], [blocks.data])
  const block = blockList.find((b) => b.block_id === storedBlock) ?? null
  const blockId = block?.block_id ?? null

  const geometry = useAsync(() => api.getBlockGeometry(region, blockId as string), [region, blockId], blockId !== null)
  // Sequenced after the outlines on purpose: the first /panchayats call for a
  // block fetches terrain lazily, and a forecast requested in parallel during
  // that warm-up can fail. `loading` matters: during a block switch the old
  // block's outlines are still in `data` and must not release the forecast early.
  const geometryReady = !geometry.loading && geometry.data !== null
  const forecast = useAsync(
    () =>
      bulletin
        ? api.postBlockForecast(region, blockId as string, { date, block_values: bulletin })
        : api.getBlockForecast(region, blockId as string, date),
    [region, blockId, date, bulletin, geometryReady],
    blockId !== null && geometryReady,
  )

  // A bulletin belongs to one block on one day; a new block also drops the village.
  useEffect(() => {
    setSelectedId(null)
    setBulletin(null)
  }, [blockId])
  useEffect(() => {
    setBulletin(null)
  }, [date])

  // Only trust a forecast that belongs to the block on screen.
  const current = forecast.data && forecast.data.block_id === blockId ? forecast.data : null
  const panchayats = useMemo(() => current?.panchayats ?? [], [current])

  const available = useMemo(() => {
    const keys = new Set<string>()
    for (const p of panchayats) for (const k of Object.keys(p.variables)) keys.add(k)
    return keys
  }, [panchayats])

  const scales = useMemo(() => {
    const out: Partial<Record<VariableKey, BlockScale>> = {}
    for (const k of VARIABLE_ORDER) out[k] = blockScale(panchayats, k)
    return out
  }, [panchayats])
  const activeScale = scales[variableKey] ?? blockScale(panchayats, variableKey)
  const unit = panchayats[0]?.variables[variableKey]?.unit ?? VARIABLES[variableKey].fallbackUnit

  const selected = panchayats.find((p) => p.panchayat_id === selectedId) ?? null

  // --- Derived UI state ------------------------------------------------------
  const structuralError = blocks.error ?? geometry.error
  const structuralStatus = blocks.error ? blocks.status : geometry.status
  const loading =
    blocks.loading || geometry.loading || forecast.loading || (blockId !== null && !geometryReady && !geometry.error)
  const slow = blocks.slow || geometry.slow || forecast.slow
  const error = structuralError ?? (forecast.loading ? null : forecast.error)
  const errorStatus = structuralError ? structuralStatus : forecast.status
  const retry = structuralError ? (blocks.error ? blocks.reload : geometry.reload) : forecast.reload

  const sourceLabel = bulletin
    ? 'Your bulletin'
    : dateKind(date, today, calendar) === 'live'
      ? 'Live forecast'
      : 'Past-season replay'

  // --- Handlers --------------------------------------------------------------
  const selectVillage = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (compact) {
        requestAnimationFrame(() =>
          sidebarRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }),
        )
      }
    },
    [compact],
  )

  const back = useCallback(() => setSelectedId(null), [])

  // Each sidebar view starts at its top.
  useEffect(() => {
    if (!compact && sidebarRef.current) sidebarRef.current.scrollTop = 0
  }, [selectedId, compact])

  // Escape leaves the village view (unless a dialog or popup is handling it).
  useEffect(() => {
    if (!active || !selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || bulletinOpen) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, select, textarea, [role="combobox"], [role="listbox"]')) return
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, selectedId, bulletinOpen])

  const exampleBlock = blockList.find((b) => b.block_id === EXAMPLE_BLOCK) ?? blockList[0] ?? null

  // --- Overlay card on the map ----------------------------------------------
  let overlay: React.ReactNode = null
  if (!blocks.loading && !structuralError && blockId === null) {
    overlay = (
      <EmptyCard
        exampleName={exampleBlock?.block_name ?? null}
        onExample={exampleBlock ? () => setStoredBlock(exampleBlock.block_id) : null}
      />
    )
  } else if (error) {
    overlay = (
      <ErrorCard
        status={errorStatus}
        message={error}
        date={date}
        calendar={calendar}
        exampleDate={exampleDate}
        onRetry={retry}
        onExampleDate={(d) => setDate(d)}
        onToday={() => setDate(today)}
      />
    )
  } else if (loading && blockId !== null) {
    overlay = <LoadingCard blockName={block?.block_name ?? null} slow={slow} />
  }

  // --- Sidebar ---------------------------------------------------------------
  let sidebar: React.ReactNode
  if (current && !error) {
    sidebar = selected ? (
      <VillageDetail village={selected} district={current.district} sourceLabel={sourceLabel} onBack={back} />
    ) : (
      <BlockSummary
        forecast={current}
        sourceLabel={sourceLabel}
        variableKey={variableKey}
        onVariable={(k) => setStoredVariable(k)}
        scales={scales}
        scale={activeScale.scale}
        metric={activeScale.metric}
        selectedId={selectedId}
        onSelect={selectVillage}
      />
    )
  } else if (loading && blockId !== null && !error) {
    sidebar = <SidebarSkeleton />
  } else {
    sidebar = <SidebarGuide />
  }

  return (
    <div className="forecast">
      <ControlBar
        regions={regions.data ?? []}
        regionsLoading={regions.loading}
        region={region}
        onRegion={(r) => {
          setRegion(r)
          setStoredBlock('')
        }}
        blocks={blockList}
        blocksLoading={blocks.loading}
        blockId={blockId}
        onBlock={setStoredBlock}
        date={date}
        today={today}
        calendar={calendar}
        onDate={setDate}
        bulletinActive={bulletin !== null}
        bulletinDisabled={blockId === null}
        onOpenBulletin={() => setBulletinOpen(true)}
        compact={compact}
      />

      {bulletin && current && !error && (
        <div className="bulletin-banner" role="status">
          <span>
            Showing <strong>your bulletin values</strong>, refined to each gram panchayat.
          </span>
          <button type="button" className="link-btn" onClick={() => setBulletin(null)}>
            Back to standard forecast
          </button>
        </div>
      )}

      <main id="main" className="forecast-body" tabIndex={-1}>
        <MapPanel
          geometry={blockId ? (geometry.data ?? []) : []}
          forecasts={panchayats}
          variableKey={variableKey}
          onVariable={(k) => setStoredVariable(k)}
          available={available}
          blockScale={activeScale}
          unit={activeScale.metric === 'chance' ? '%' : unit}
          blockAmount={blockValueOf(panchayats, variableKey)}
          selectedId={selectedId}
          onSelect={selectVillage}
          showControls={current !== null && !error}
          compact={compact}
          overlay={overlay}
          busy={loading}
        />
        <aside
          ref={sidebarRef}
          className={`sidebar${loading && current ? ' is-refreshing' : ''}`}
          aria-label={selected ? `${selected.panchayat_name} details` : 'Block summary'}
          aria-busy={loading}
        >
          {sidebar}
        </aside>
      </main>

      <BulletinDialog
        key={`${blockId}-${date}`}
        open={bulletinOpen}
        blockName={block?.block_name ?? null}
        date={date}
        active={bulletin !== null}
        onSubmit={setBulletin}
        onClear={() => setBulletin(null)}
        onClose={() => setBulletinOpen(false)}
      />
    </div>
  )
}
