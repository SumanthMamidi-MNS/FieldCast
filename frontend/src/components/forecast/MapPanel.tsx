import type { ReactNode } from 'react'
import type { PanchayatForecast, PanchayatGeometry } from '../../types/api'
import type { BlockScale } from '../../lib/mapScale'
import type { VariableKey } from '../../lib/variables'
import { MapLegend } from './MapLegend'
import { MapView } from './MapView'
import { VariableSegmented } from './VariableSegmented'

interface MapPanelProps {
  geometry: PanchayatGeometry[]
  forecasts: PanchayatForecast[]
  variableKey: VariableKey
  onVariable: (key: VariableKey) => void
  available: Set<string>
  blockScale: BlockScale
  unit: string
  selectedId: string | null
  onSelect: (id: string) => void
  showControls: boolean
  compact: boolean
  /** Loading, empty or error card drawn over the map. */
  overlay?: ReactNode
  busy: boolean
}

const DESKTOP_PADDING = { top: 52, bottom: 8, left: 272, right: 44 }
/** Phone: clear the switcher on top and the collapsed legend below. */
const PHONE_PADDING = { top: 40, bottom: 44, left: 0, right: 0 }

export function MapPanel(props: MapPanelProps) {
  return (
    <section className="map-panel" aria-label="Map" aria-busy={props.busy}>
      <MapView
        geometry={props.geometry}
        forecasts={props.forecasts}
        variableKey={props.variableKey}
        scale={props.blockScale.scale}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        overlayPadding={props.compact ? PHONE_PADDING : DESKTOP_PADDING}
      />
      {props.showControls && (
        <>
          <div className="map-overlay map-overlay-top">
            <VariableSegmented
              value={props.variableKey}
              onChange={props.onVariable}
              available={props.available}
            />
          </div>
          <div className="map-overlay map-overlay-legend">
            <MapLegend
              key={props.compact ? 'c' : 'd'}
              variableKey={props.variableKey}
              unit={props.unit}
              scale={props.blockScale.scale}
              domain={props.blockScale.domain}
              defaultOpen={!props.compact}
            />
          </div>
        </>
      )}
      {props.overlay && <div className="map-overlay map-overlay-center">{props.overlay}</div>}
    </section>
  )
}
