export const hasPrice = (value) => Number.isFinite(value) && value > 0

export const hasAvailablePrice = (station, fuel) => hasPrice(station.prices?.[fuel]) &&
  station.stationStatus === 'ACTIVA' && station.availability?.[fuel] === 'DISPONIBLE'

export const getAvailabilityLabel = (station, fuel) => {
  if (station.stationStatus === 'INACTIVA') return 'Estación inactiva'
  if (station.availability?.[fuel] === 'AGOTADO') return 'Agotado'
  return hasAvailablePrice(station, fuel) ? 'Disponible' : 'Sin precio disponible'
}

export const hasCoordinates = (station) =>
  Number.isFinite(station.lat) && Math.abs(station.lat) <= 90 &&
  Number.isFinite(station.lng) && Math.abs(station.lng) <= 180 &&
  station.locationStatus === 'verified'

export const canDisplayOnMap = (station, demoMode = false) => hasCoordinates(station) ||
  (demoMode === true && station.source === 'oracle' && station.locationStatus === 'pending' &&
   Number.isFinite(station.lat) && Math.abs(station.lat) <= 90 &&
   Number.isFinite(station.lng) && Math.abs(station.lng) <= 180)

const comparable = (station) => hasPrice(station.price) && station.available !== false

export function comparePrices(a, b, order = 'asc') {
  if (!comparable(a)) return comparable(b) ? 1 : 0
  if (!comparable(b)) return -1
  return order === 'asc' ? a.price - b.price : b.price - a.price
}

export function getCheapestStation(rows) {
  return rows.filter(comparable)
    .sort((a, b) => a.price - b.price)[0]
}

export function getPriceDifference(stations, fuel) {
  if (stations.length !== 2 || stations.some((station) => !hasAvailablePrice(station, fuel))) return null
  return Math.abs(stations[0].prices[fuel] - stations[1].prices[fuel])
}
