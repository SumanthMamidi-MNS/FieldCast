import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { DEFAULT_DATE, USING_MOCK, api } from './api/client'
import { useAsync } from './hooks/useAsync'
import { useLocalStorage } from './hooks/useLocalStorage'
import { buildScale, isDiverging, niceDomain } from './lib/colorScale'
import { VARIABLES, isVariableKey, type VariableKey } from './lib/variables'
import { BlockSelector } from './components/BlockSelector'
import { BulletinForm } from './components/BulletinForm'
import { DatePicker } from './components/DatePicker'
import { MapLegend } from './components/MapLegend'
import { MapView } from './components/MapView'
import { PanchayatDetail } from './components/PanchayatDetail'
import { PanchayatList } from './components/PanchayatList'
import { Skeleton, SkeletonText } from './components/Skeleton'
import { VariableSwitcher } from './components/VariableSwitcher'
import './styles/app.css'

// Recharts is only needed on the comparison screen; keep it off the first load.
const ComparisonView = lazy(() =>
  import('./components/ComparisonView').then((m) => ({ default: m.ComparisonView })),
)

type ViewMode = 'map' | 'compare'

const STORAGE_BLOCK = 'pdd.block'
const STORAGE_VARIABLE = 'pdd.variable'

/** Shown while a slow first request (lazy terrain fetch) is in flight. */
function SlowNotice({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <p className="slow-notice" role="status">
      Preparing this block for the first time — terrain data for every village is being fetched.
      This can take a minute or two on the first visit and is quick afterwards. You can switch
      blocks meanwhile.
    </p>
  )
}

export default function App() {
  const [storedBlock, setStoredBlock] = useLocalStorage(STORAGE_BLOCK, '')
  const [storedVariable, setStoredVariable] = useLocalStorage(STORAGE_VARIABLE, 'precip')
  const [selectedPanchayat, setSelectedPanchayat] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('map')
  const [date, setDate] = useState(DEFAULT_DATE)
  /** Officer-entered bulletin values; null means the standard forecast. */
  const [bulletin, setBulletin] = useState<Record<string, number> | null>(null)

  const variableKey: VariableKey = isVariableKey(storedVariable) ? storedVariable : 'precip'

  const blocks = useAsync(() => api.getBlocks(), [])
  const blockList = useMemo(() => blocks.data ?? [], [blocks.data])

  // Remembered block, falling back to the first one the API offers.
  const blockId = useMemo(() => {
    if (blockList.length === 0) return null
    const remembered = blockList.find((b) => b.block_id === storedBlock)
    return remembered?.block_id ?? blockList[0]?.block_id ?? null
  }, [blockList, storedBlock])
  const blockName = blockList.find((b) => b.block_id === blockId)?.block_name ?? null

  const geometry = useAsync(
    () => api.getBlockGeometry(blockId as string),
    [blockId],
    blockId !== null,
  )
  // Sequenced after the outlines on purpose: the first /panchayats call for a
  // block fetches terrain lazily, and a forecast requested in parallel during
  // that warm-up gets a 422 that wrongly reads as "bad date".
  // `loading` matters: during a block switch the previous block's outlines are
  // still in `data`, and they must not release the new block's forecast early.
  const geometryReady = !geometry.loading && geometry.data !== null
  const forecast = useAsync(
    () =>
      bulletin
        ? api.postBlockForecast(blockId as string, { date, block_values: bulletin })
        : api.getBlockForecast(blockId as string, date),
    [blockId, date, bulletin, geometryReady],
    blockId !== null && geometryReady,
  )
  const baselines = useAsync(() => api.getBaselines(), [])

  // A bulletin belongs to one block on one day; changing either discards it.
  useEffect(() => {
    setSelectedPanchayat(null)
    setBulletin(null)
  }, [blockId])
  useEffect(() => {
    setBulletin(null)
  }, [date])

  const panchayats = useMemo(() => forecast.data?.panchayats ?? [], [forecast.data])

  const availableVariables = useMemo(() => {
    const keys = new Set<string>()
    for (const p of panchayats) for (const k of Object.keys(p.variables)) keys.add(k)
    return keys
  }, [panchayats])

  const scale = useMemo(() => {
    const meta = VARIABLES[variableKey]
    const values = panchayats
      .map((p) => p.variables[variableKey]?.value)
      .filter((v): v is number => v !== undefined && Number.isFinite(v))
    const blockValue = panchayats[0]?.variables[variableKey]?.block_value
    const domain = niceDomain(values, {
      zeroAnchored: meta.zeroAnchored,
      diverging: isDiverging(meta.scale),
      ...(blockValue !== undefined ? { blockValue } : {}),
    })
    return buildScale(meta.scale, domain)
  }, [panchayats, variableKey])

  const selectedForecast = panchayats.find((p) => p.panchayat_id === selectedPanchayat) ?? null
  const sampleVariable = panchayats[0]?.variables[variableKey]
  const unit = sampleVariable?.unit ?? VARIABLES[variableKey].fallbackUnit
  const blockValue = sampleVariable?.block_value ?? 0

  const loadingCore =
    forecast.loading ||
    geometry.loading ||
    blocks.loading ||
    (blockId !== null && !geometryReady && !geometry.error)
  const slow = forecast.slow || geometry.slow
  // Structural failures (no blocks / no outlines) block the whole page. A
  // forecast failure — usually a date outside the available windows — does
  // not: the controls stay usable so the officer can pick another date.
  const fatalError = blocks.error ?? geometry.error
  const forecastError = forecast.error

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to forecast
      </a>

      <header className="app-header">
        <div className="app-brand">
          <h1 className="app-title">Panchayat Forecast</h1>
          <p className="app-tagline">
            Block forecasts, refined to village level — with how much to trust each one.
          </p>
        </div>

        <div className="app-controls">
          <BlockSelector
            blocks={blockList}
            selectedId={blockId}
            onSelect={setStoredBlock}
            loading={blocks.loading}
          />
          <DatePicker value={date} onChange={setDate} />
          <div className="view-toggle" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'map'}
              className={`view-tab${view === 'map' ? ' is-selected' : ''}`}
              onClick={() => setView('map')}
            >
              Map
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'compare'}
              className={`view-tab${view === 'compare' ? ' is-selected' : ''}`}
              onClick={() => setView('compare')}
            >
              Why not the block value?
            </button>
          </div>
        </div>
      </header>

      {USING_MOCK && (
        <p className="mock-banner" role="status">
          <strong>Demo data.</strong> Running on the built-in mock (VITE_USE_MOCK=true) — these
          numbers are generated locally, not issued by IMD or the downscaling model.
        </p>
      )}

      <main id="main" className="app-main">
        {!fatalError && blockId !== null && (
          <BulletinForm
            key={`${blockId}-${date}`}
            blockName={blockName}
            date={date}
            active={bulletin !== null}
            submitting={bulletin !== null && forecast.loading}
            onSubmit={setBulletin}
            onClear={() => setBulletin(null)}
          />
        )}

        {bulletin && forecast.data && !forecastError && (
          <p className="bulletin-banner" role="status">
            Showing <strong>your bulletin values</strong> downscaled to each village — not the
            system&rsquo;s own block forecast.
          </p>
        )}

        {fatalError && (
          <div className="error-panel" role="alert">
            <h2>Could not load the block</h2>
            <p>{fatalError}</p>
          </div>
        )}

        {!fatalError && forecastError && !forecast.loading && (
          <div className="error-panel error-panel-soft" role="alert">
            <h2>
              {forecast.status === 422
                ? 'No forecast for that date'
                : 'Could not load the forecast'}
            </h2>
            <p className="error-detail">
              {forecastError.charAt(0).toUpperCase() + forecastError.slice(1)}
            </p>
            {forecast.status === 422 && (
              <p>
                Try a date between 1 June and 30 September in 2022 or 2023, or from yesterday up to
                15 days ahead.{' '}
                {date !== DEFAULT_DATE && (
                  <button type="button" className="btn btn-link" onClick={() => setDate(DEFAULT_DATE)}>
                    Go to {DEFAULT_DATE}
                  </button>
                )}
              </p>
            )}
          </div>
        )}

        {!fatalError && !forecastError && view === 'map' && (
          <div className="map-layout">
            <section className="map-column" aria-label="Panchayat map" aria-busy={loadingCore}>
              <div className="map-toolbar">
                <VariableSwitcher
                  value={variableKey}
                  onChange={(k) => setStoredVariable(k)}
                  available={availableVariables}
                />
                {forecast.data && (
                  <p className="map-date">
                    {forecast.data.block_name}, {forecast.data.district} ·{' '}
                    <time dateTime={forecast.data.date}>{forecast.data.date}</time>
                  </p>
                )}
              </div>

              <SlowNotice show={loadingCore && slow} />

              {loadingCore ? (
                <Skeleton height="clamp(320px, 52vh, 620px)" radius="12px" />
              ) : (
                <MapView
                  geometry={geometry.data ?? []}
                  forecasts={panchayats}
                  variableKey={variableKey}
                  scale={scale}
                  selectedId={selectedPanchayat}
                  onSelect={setSelectedPanchayat}
                />
              )}

              {loadingCore ? (
                <SkeletonText lines={4} />
              ) : (
                <MapLegend
                  variableKey={variableKey}
                  unit={unit}
                  scale={scale}
                  blockValue={blockValue}
                />
              )}

              {!loadingCore && panchayats.length > 0 && (
                <PanchayatList
                  forecasts={panchayats}
                  variableKey={variableKey}
                  scale={scale}
                  selectedId={selectedPanchayat}
                  onSelect={setSelectedPanchayat}
                />
              )}
            </section>

            <div className="detail-column">
              {loadingCore ? (
                <div className="detail detail-loading">
                  <Skeleton height="1.6rem" width="55%" />
                  <SkeletonText lines={3} />
                  <Skeleton height="120px" radius="10px" />
                  <SkeletonText lines={4} />
                </div>
              ) : (
                <PanchayatDetail
                  forecast={selectedForecast}
                  onClose={() => setSelectedPanchayat(null)}
                />
              )}
            </div>
          </div>
        )}

        {!fatalError && !forecastError && view === 'compare' && (
          <div className="compare-layout" aria-busy={loadingCore}>
            <div className="map-toolbar">
              <VariableSwitcher
                value={variableKey}
                onChange={(k) => setStoredVariable(k)}
                available={availableVariables}
              />
            </div>
            <SlowNotice show={loadingCore && slow} />
            {loadingCore || !forecast.data ? (
              <>
                <Skeleton height="2rem" width="45%" />
                <SkeletonText lines={5} />
                <Skeleton height="260px" radius="12px" />
              </>
            ) : (
              <Suspense fallback={<Skeleton height="420px" radius="12px" />}>
              <ComparisonView
                forecast={forecast.data}
                baselines={baselines.data ?? []}
                baselinesLoading={baselines.loading}
                baselinesError={baselines.error}
                variableKey={variableKey}
                scale={scale}
                selectedId={selectedPanchayat}
                onSelect={(id) => {
                  setSelectedPanchayat(id)
                  setView('map')
                }}
              />
              </Suspense>
            )}
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Downscaled from block-level forecasts. Village-scale values are tier T3 — inferred below
          the validated scale — and every number on this page carries its evidence tier.
        </p>
        {forecast.data && <p className="app-footer-meta">Model {forecast.data.model_version}</p>}
      </footer>
    </div>
  )
}
