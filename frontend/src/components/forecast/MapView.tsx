import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { PanchayatForecast, PanchayatGeometry } from '../types/api'
import type { ColorScale } from '../lib/colorScale'
import { NO_DATA_COLOR } from '../lib/colorScale'
import { FILL_OPACITY, confidenceStyle } from '../lib/confidenceTexture'
import { buildHatchPattern, buildStipplePattern } from '../lib/mapPatterns'
import { buildFocusLabel, buildValueLabel } from '../lib/mapLabels'
import { boundsOf, fitPadding, labelImageId, labelSortKey } from '../lib/mapGeometry'
import { formatValue, type VariableKey } from '../lib/variables'

interface MapViewProps {
  geometry: PanchayatGeometry[]
  forecasts: PanchayatForecast[]
  variableKey: VariableKey
  scale: ColorScale
  selectedId: string | null
  onSelect: (panchayatId: string) => void
}

const SOURCE = 'panchayats'
const LABEL_SOURCE = 'panchayat-labels'
const NONE = '__none__'

/** Dark ink used for boundaries and the selection ring; matches --ink. */
const INK = '#10151b'
const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

/**
 * Keyless raster basemap.
 *
 * A vector style would look better but every free one needs an API key, and a
 * demo that dies when a key expires — or when venue wifi blocks the key server —
 * is not a demo. OSM raster tiles need no key. Attribution is mandatory under
 * the OSM tile usage policy and is always on screen, never behind a toggle;
 * `maxzoom` is capped and the basemap is desaturated so the choropleth reads on
 * a projector.
 *
 * For anything beyond a pilot, this should move to a self-hosted or commercial
 * tile source — the OSM tile CDN is not for production traffic.
 */
const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: OSM_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-saturation': -0.55, 'raster-contrast': -0.08, 'raster-opacity': 0.9 },
    },
  ],
}

interface FeatureProps {
  id: string
  name: string
  value: number
  fillColor: string
  support: string
}

interface LabelProps {
  id: string
  valueImage: string
  focusImage: string
  sortKey: number
}

interface LabelImage {
  id: string
  build: () => ReturnType<typeof buildValueLabel>
}

function buildData(
  geometry: PanchayatGeometry[],
  forecasts: PanchayatForecast[],
  variableKey: VariableKey,
  scale: ColorScale,
) {
  const byId = new Map(forecasts.map((f) => [f.panchayat_id, f]))
  const images: LabelImage[] = []
  const seen = new Set<string>()
  const want = (id: string, build: LabelImage['build']) => {
    if (seen.has(id)) return
    seen.add(id)
    images.push({ id, build })
  }

  const polygons = {
    type: 'FeatureCollection' as const,
    features: geometry.map((g) => {
      const variable = byId.get(g.panchayat_id)?.variables[variableKey]
      const value = variable?.value ?? Number.NaN
      const props: FeatureProps = {
        id: g.panchayat_id,
        name: g.panchayat_name,
        value,
        fillColor: Number.isFinite(value) ? scale.color(value) : NO_DATA_COLOR,
        support: variable?.confidence.support ?? 'low',
      }
      return { type: 'Feature' as const, id: g.panchayat_id, properties: props, geometry: g.geometry }
    }),
  }

  // Labels sit on the forecast point, which the backend places inside the
  // panchayat — a bbox centre can fall outside a crescent-shaped village.
  const labels = {
    type: 'FeatureCollection' as const,
    features: forecasts.flatMap((f) => {
      if (!Number.isFinite(f.longitude) || !Number.isFinite(f.latitude)) return []
      const variable = f.variables[variableKey]
      const valueText = variable
        ? formatValue(variable.value, variableKey, variable.unit)
        : 'no data'
      const name = f.panchayat_name
      const valueImage = labelImageId('value', valueText)
      const focusImage = labelImageId('focus', name, valueText)
      want(valueImage, () => buildValueLabel(valueText))
      want(focusImage, () => buildFocusLabel(name, valueText))
      const props: LabelProps = {
        id: f.panchayat_id,
        valueImage,
        focusImage,
        sortKey: labelSortKey(f.area_km2),
      }
      return [
        {
          type: 'Feature' as const,
          properties: props,
          geometry: { type: 'Point' as const, coordinates: [f.longitude, f.latitude] },
        },
      ]
    }),
  }

  return { polygons, labels, images }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Hovered and selected ids, de-duplicated, never empty (MapLibre needs a literal). */
function focusIds(hovered: string | null, selected: string | null): string[] {
  const ids = [hovered, selected].filter((x): x is string => typeof x === 'string')
  return ids.length ? [...new Set(ids)] : [NONE]
}

export function MapView({
  geometry,
  forecasts,
  variableKey,
  scale,
  selectedId,
  onSelect,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const selectRef = useRef(onSelect)
  const hoveredRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(selectedId)
  const geometryRef = useRef(geometry)
  const [ready, setReady] = useState(false)

  selectRef.current = onSelect
  selectedRef.current = selectedId
  geometryRef.current = geometry

  const data = useMemo(
    () => buildData(geometry, forecasts, variableKey, scale),
    [geometry, forecasts, variableKey, scale],
  )

  /** Fit the camera to the whole block, so the block fills the map. */
  const fitToBlock = useCallback((animate: boolean) => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container) return
    const bounds = boundsOf(geometryRef.current)
    if (!bounds) return
    const { clientWidth: w, clientHeight: h } = container
    if (w === 0 || h === 0) return
    map.fitBounds(bounds, {
      padding: fitPadding(w, h),
      maxZoom: 13,
      duration: animate && !prefersReducedMotion() ? 600 : 0,
    })
  }, [])

  /** Point the name label at the hovered / selected village, and hide its value chip. */
  const applyFocus = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('panchayat-label-focus')) return
    const ids = focusIds(hoveredRef.current, selectedRef.current)
    const inFocus: maplibregl.FilterSpecification = ['in', ['get', 'id'], ['literal', ids]]
    map.setFilter('panchayat-label-focus', inFocus)
    map.setFilter('panchayat-label-value', ['!', inFocus])
    map.setFilter('panchayat-hover', ['==', ['get', 'id'], hoveredRef.current ?? NONE])
  }, [])

  // --- Init, once. ---------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [73.85, 18.2],
      zoom: 9,
      attributionControl: false,
      // Stops the map from swallowing page scroll on a phone.
      cooperativeGestures: true,
    })
    mapRef.current = map

    map.addControl(
      new maplibregl.AttributionControl({ compact: false, customAttribution: OSM_ATTRIBUTION }),
      'bottom-right',
    )
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      const hatch = buildHatchPattern()
      const stipple = buildStipplePattern()
      if (hatch && !map.hasImage('confidence-hatch-low')) {
        map.addImage('confidence-hatch-low', hatch, { pixelRatio: hatch.pixelRatio })
      }
      if (stipple && !map.hasImage('confidence-stipple-medium')) {
        map.addImage('confidence-stipple-medium', stipple, { pixelRatio: stipple.pixelRatio })
      }

      const empty = { type: 'FeatureCollection' as const, features: [] }
      map.addSource(SOURCE, { type: 'geojson', data: empty })
      map.addSource(LABEL_SOURCE, { type: 'geojson', data: empty })

      // 1. Value → colour.
      map.addLayer({
        id: 'panchayat-fill',
        type: 'fill',
        source: SOURCE,
        paint: {
          'fill-color': ['get', 'fillColor'],
          // Constant. Confidence is NOT encoded here — see confidenceTexture.ts.
          'fill-opacity': FILL_OPACITY,
        },
      })

      // 2. Confidence → texture, as a separate overlay so it cannot alter hue.
      map.addLayer({
        id: 'panchayat-texture-medium',
        type: 'fill',
        source: SOURCE,
        filter: ['==', ['get', 'support'], 'medium'],
        paint: { 'fill-pattern': 'confidence-stipple-medium', 'fill-opacity': 0.9 },
      })
      map.addLayer({
        id: 'panchayat-texture-low',
        type: 'fill',
        source: SOURCE,
        filter: ['==', ['get', 'support'], 'low'],
        paint: { 'fill-pattern': 'confidence-hatch-low', 'fill-opacity': 0.95 },
      })

      // 3. Boundaries: a two-tone hairline (white casing + dark core), the same
      //    trick the texture uses. The temperature scale is centred on the block
      //    value, so many fills sit near white — a white-only line vanished there.
      map.addLayer({
        id: 'panchayat-outline-casing',
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': 2.4 },
      })
      map.addLayer({
        id: 'panchayat-outline',
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': confidenceStyle('high').outlineColor,
          'line-width': confidenceStyle('high').outlineWidth,
        },
      })
      // Low support: dashed, heavier boundary — a redundant, non-hue cue.
      map.addLayer({
        id: 'panchayat-outline-low',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'support'], 'low'],
        paint: {
          'line-color': confidenceStyle('low').outlineColor,
          'line-width': confidenceStyle('low').outlineWidth,
          'line-dasharray': confidenceStyle('low').outlineDash ?? [1],
        },
      })

      // 4. Hover and selection. Selection is a thick dark ring on a white
      //    casing, so it reads on the palest and the darkest fill alike.
      map.addLayer({
        id: 'panchayat-hover',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'id'], NONE],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': INK, 'line-width': 2.5, 'line-opacity': 0.85 },
      })
      map.addLayer({
        id: 'panchayat-selected-casing',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'id'], NONE],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8 },
      })
      map.addLayer({
        id: 'panchayat-selected',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'id'], NONE],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': INK, 'line-width': 4 },
      })

      // 5. Labels. Symbol collision drops labels that would overlap instead of
      //    piling them up; larger panchayats win (symbol-sort-key), and zooming
      //    in reveals the rest. Names appear only for the hovered / selected
      //    village — the full list is in the side panel.
      map.addLayer({
        id: 'panchayat-label-value',
        type: 'symbol',
        source: LABEL_SOURCE,
        layout: {
          'icon-image': ['get', 'valueImage'],
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
          'icon-padding': 4,
          'symbol-sort-key': ['get', 'sortKey'],
        },
      })
      // Above the value layer, so it is placed first and always wins; any value
      // chip it would cover is dropped rather than stacked under it.
      map.addLayer({
        id: 'panchayat-label-focus',
        type: 'symbol',
        source: LABEL_SOURCE,
        filter: ['in', ['get', 'id'], ['literal', [NONE]]],
        layout: {
          'icon-image': ['get', 'focusImage'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': false,
          'icon-padding': 4,
        },
      })

      map.on('click', 'panchayat-fill', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') selectRef.current(id)
      })
      map.on('mousemove', 'panchayat-fill', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const id = e.features?.[0]?.properties?.id
        const next = typeof id === 'string' ? id : null
        if (next !== hoveredRef.current) {
          hoveredRef.current = next
          applyFocus()
        }
      })
      map.on('mouseleave', 'panchayat-fill', () => {
        map.getCanvas().style.cursor = ''
        hoveredRef.current = null
        applyFocus()
      })

      setReady(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [applyFocus])

  // --- Data + label images. ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    for (const img of data.images) {
      if (map.hasImage(img.id)) continue
      const built = img.build()
      if (built) map.addImage(img.id, built, { pixelRatio: built.pixelRatio })
    }
    const polygons = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
    const labels = map.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined
    polygons?.setData(data.polygons)
    labels?.setData(data.labels)
  }, [data, ready])

  // --- Fit to the block, on load and on every block change. ----------------
  useEffect(() => {
    if (!ready || geometry.length === 0) return
    fitToBlock(true)
  }, [geometry, ready, fitToBlock])

  // --- Refit when the container changes size (rotation, layout reflow). ----
  useEffect(() => {
    const container = containerRef.current
    if (!ready || !container || typeof ResizeObserver === 'undefined') return
    let frame = 0
    let last = `${container.clientWidth}x${container.clientHeight}`
    const ro = new ResizeObserver(() => {
      const size = `${container.clientWidth}x${container.clientHeight}`
      if (size === last) return
      last = size
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        mapRef.current?.resize()
        fitToBlock(false)
      })
    })
    ro.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [ready, fitToBlock])

  // --- Selection highlight. ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('panchayat-selected')) return
    const filter: maplibregl.FilterSpecification = ['==', ['get', 'id'], selectedId ?? NONE]
    map.setFilter('panchayat-selected', filter)
    map.setFilter('panchayat-selected-casing', filter)
    applyFocus()
  }, [selectedId, ready, applyFocus])

  return (
    <div className="map-shell">
      <div
        ref={containerRef}
        className="map-canvas"
        role="region"
        aria-label="Panchayat map. Select a village here or from the list below."
      />
      {!ready && <div className="map-loading">Loading map…</div>}
    </div>
  )
}
