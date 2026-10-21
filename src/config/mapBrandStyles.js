export const DEFAULT_MARKER_COLOR = '#64748B'

export function normalizeBrand(brand) {
  return typeof brand === 'string'
    ? brand.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '')
    : ''
}

// Map presentation only: does not add fields to station or database records.
// Don Arturo / UNO: blue references from their public logos, not brand manuals.
// https://somosdonarturo.gt/ | https://www.uno.com.gt/
// METRO has no verified palette; keep the neutral fallback.
const definitions = [
  { key: 'shell', label: 'Shell', color: '#F5C400', aliases: ['Shell'] },
  { key: 'puma', label: 'Puma Energy', color: '#D9272E', aliases: ['Puma', 'Puma Energy'] },
  { key: 'texaco', label: 'Texaco', color: '#E32636', aliases: ['Texaco'] },
  { key: 'pegaso', label: 'Pegaso', color: '#1769C2', aliases: ['Pegaso'] },
  { key: 'mobil', label: 'Mobil', color: '#244A9B', aliases: ['Mobil'] },
  { key: 'donarturo', label: 'Don Arturo', color: '#00549F', aliases: ['Don Arturo', 'Gasolineras Don Arturo'] },
  { key: 'uno', label: 'UNO', color: '#052D6B', aliases: ['Uno', 'Uno Guatemala'] },
  { key: 'metro', label: 'METRO', color: DEFAULT_MARKER_COLOR, aliases: ['Metro'] },
  { key: 'independiente', label: 'Independiente', color: DEFAULT_MARKER_COLOR,
    aliases: ['Independiente', 'Independientes', 'Gasolinera independiente', 'Gasolineras independientes', 'Sin marca'] },
]

const stylesByAlias = new Map(definitions.flatMap((definition) =>
  definition.aliases.map((alias) => [normalizeBrand(alias), Object.freeze({
    key: definition.key, label: definition.label, color: definition.color,
  })])))

export function getMapBrandStyle(brand) {
  const key = normalizeBrand(brand)
  return stylesByAlias.get(key) ?? {
    key: key || 'independiente',
    label: typeof brand === 'string' && brand.trim() ? brand.trim().replace(/\s+/g, ' ') : 'Independiente',
    color: DEFAULT_MARKER_COLOR,
  }
}

export function getMapMarkerStyle(brand, selected = false) {
  return {
    radius: selected ? 12 : 9,
    pathOptions: {
      color: selected ? '#123047' : '#ffffff',
      weight: selected ? 4 : 2,
      fillColor: getMapBrandStyle(brand).color,
      fillOpacity: 0.9,
    },
  }
}

export function getVisibleBrandLegend(stations, isVisible = () => true) {
  const brands = new Map()
  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng) || !isVisible(station)) continue
    const style = getMapBrandStyle(station.brand)
    brands.set(style.key, style)
  }
  return [...brands.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'))
}
