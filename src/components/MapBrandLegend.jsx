import { useEffect, useRef, useState } from 'react'
import { DomEvent } from 'leaflet'
import { useMap, useMapEvents } from 'react-leaflet'
import { getVisibleBrandLegend } from '../config/mapBrandStyles'

export default function MapBrandLegend({ stations }) {
  const map = useMap()
  const control = useRef(null)
  const [bounds, setBounds] = useState(() => map.getBounds())
  useMapEvents({
    moveend: () => setBounds(map.getBounds()),
    zoomend: () => setBounds(map.getBounds()),
    resize: () => setBounds(map.getBounds()),
  })

  const brands = getVisibleBrandLegend(stations, (station) => bounds.contains([station.lat, station.lng]))
  const visible = brands.length > 0

  useEffect(() => {
    const element = control.current
    if (!element) return
    DomEvent.disableClickPropagation(element)
    DomEvent.disableScrollPropagation(element)
    return () => { DomEvent.off(element) }
  }, [visible])

  if (!visible) return null
  return (
    <div className="leaflet-bottom leaflet-right">
      <aside ref={control} className="leaflet-control map-brand-legend" aria-label="Marcas visibles en el mapa">
        <strong>Marcas</strong>
        <ul>
          {brands.map((brand) => (
            <li key={brand.key}><span className="map-brand-swatch" style={{ backgroundColor: brand.color }} aria-hidden="true" />{brand.label}</li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
