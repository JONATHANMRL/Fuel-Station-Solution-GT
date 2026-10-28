import { useMemo } from 'react'
import { divIcon } from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import { fuelLabels } from '../data'
import { getMapBrandStyle } from '../config/mapBrandStyles.js'
import { fuelMarkerSvg } from '../utils/mapPresentation.js'
import { getAvailabilityLabel, hasPrice } from '../utils/stationUtils.js'

export default function StationMapMarker({ marker, selected, onSelect, formatMoney }) {
  const { station, position } = marker
  const color = getMapBrandStyle(station.brand).color
  const icon = useMemo(() => divIcon({
    className: `station-map-icon${selected ? ' is-selected' : ''}`,
    html: fuelMarkerSvg(color, selected), iconSize: [34, 42], iconAnchor: [17, 42], popupAnchor: [0, -38],
  }), [color, selected])
  return <Marker position={[position.lat, position.lng]} icon={icon} title={station.name}
    alt={`Gasolinera ${station.name}`} keyboard zIndexOffset={selected ? 1000 : 0}
    eventHandlers={{ click: () => onSelect(marker.id) }}>
    <Popup><div className="popup-card">
      <strong>{station.name}</strong><span>{station.brand}</span>
      <small>{station.address} · {station.municipality}</small>
      <ul>{['regular', 'premium', 'diesel'].map((fuel) => <li key={fuel} className={`fuel-${fuel}`}>
        <span>{fuelLabels[fuel]} · {getAvailabilityLabel(station, fuel)}</span>
        <strong className={!hasPrice(station.prices[fuel]) ? 'price-unavailable' : undefined}>{formatMoney(station.prices[fuel])}</strong>
      </li>)}</ul>
      <div className="popup-actions"><button type="button" onClick={() => onSelect(marker.id)}>Ver detalles</button></div>
    </div></Popup>
  </Marker>
}
