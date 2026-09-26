import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { PanchayatForecast, PanchayatGeometry } from '../types/api'
import type { ColorScale } from '../lib/colorScale'
import { NO_DATA_COLOR, readableInk } from '../lib/colorScale'
import { FILL_OPACITY, confidenceStyle } from '../lib/confidenceTexture'
import { buildHatchPattern, buildStipplePattern } from '../lib/mapPatterns'
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
  labelInk: string
  valueText: string
}

function buildFeatureCollection(
  geometry: PanchayatGeometry[],
  forecasts: PanchayatForecast[],
  variableKey: VariableKey,
  scale: ColorScale,
) {
  const byId = new Map(forecasts.map((f) => [f.panchayat_id, f]))
  return {
    type: 'FeatureCollection' as const,
    features: geometry.map((g) => {
      const forecast = byId.get(g.panchayat_id)
      const variable = forecast?.variables[variableKey]
      const value = variable?.value ?? Number.NaN
      const fillColor = Number.isFinite(value) ? scale.color(value) : NO_DATA_COLOR
      const support = variable?.confidence.support ?? 'low'
      const props: FeatureProps = {
        id: g.panchayat_id,
        name: g.panchayat_name,
        value,
        fillColor,
        support,
        labelInk: readableInk(fillColor),
        valueText: variable ? formatValue(value, variableKey, variable.unit) : 'no data',
      }
      return { type: 'Feature' as const, id: g.panchayat_id, properties: props, geometry: g.geometry }
    }),
  }
}

function boundsOf(geometry: PanchayatGeometry[]): LngLatBoundsLike | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  const visit = (coords: number[]) => {
    const lon = coords[0] as number
    const lat = coords[1] as number
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }

  for (const g of geometry) {
    const rings =
      g.geometry.type === 'Polygon' ? g.geometry.coordinates : g.geometry.coordinates.flat()
    for (const ring of rings) for (const pt of ring) visit(pt)
  }

  if (!Number.isFinite(west) || !Number.isFinite(east)) return null
  return [
    [west, south],
    [east, north],
  ]
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
  const markersRef = useRef<maplibregl.Marker[]>([])
  const selectRef = useRef(onSelect)
  const [ready, setReady] = useState(false)

  selectRef.current = onSelect

  const data = useMemo(
    () => buildFeatureCollection(geometry, forecasts, variableKey, scale),
    [geometry, forecasts, variableKey, scale],
  )

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

      map.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

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

      // 3. Outlines — a third, redundant confidence cue.
      map.addLayer({
        id: 'panchayat-outline',
        type: 'line',
        source: SOURCE,
        paint: { 'line-color': '#ffffff', 'line-width': 1.2 },
      })
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
      map.addLayer({
        id: 'panchayat-selected',
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'id'], '__none__'],
        paint: { 'line-color': '#0f4c8a', 'line-width': 4 },
      })

      map.on('click', 'panchayat-fill', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') selectRef.current(id)
      })
      map.on('mouseenter', 'panchayat-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'panchayat-fill', () => {
        map.getCanvas().style.cursor = ''
      })

      setReady(true)
    })

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // --- Data + labels. ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const source = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(data)

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    // Labels are HTML markers, not a symbol layer: a symbol layer needs a hosted
    // glyph endpoint, which would reintroduce exactly the keyed dependency the
    // basemap choice avoids.
    for (const feature of data.features) {
      const props = feature.properties
      const forecast = forecasts.find((f) => f.panchayat_id === props.id)
      if (!forecast) continue

      const el = document.createElement('div')
      el.className = 'map-label'
      el.setAttribute('aria-hidden', 'true')
      el.style.setProperty('--label-ink', props.labelInk)

      const name = document.createElement('span')
      name.className = 'map-label-name'
      name.textContent = props.name

      const value = document.createElement('span')
      value.className = 'map-label-value'
      value.textContent = props.valueText

      el.append(name, value)

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([forecast.longitude, forecast.latitude])
        .addTo(map)
      markersRef.current.push(marker)
    }
  }, [data, forecasts, ready])

  // --- Fit to the selected block. ------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || geometry.length === 0) return
    const bounds = boundsOf(geometry)
    if (bounds) map.fitBounds(bounds, { padding: 56, duration: 600, maxZoom: 12 })
  }, [geometry, ready])

  // --- Selection highlight. ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('panchayat-selected')) return
    map.setFilter('panchayat-selected', ['==', ['get', 'id'], selectedId ?? '__none__'])
  }, [selectedId, ready])

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-canvas" />
      {!ready && <div className="map-loading">Loading map…</div>}
    </div>
  )
}
