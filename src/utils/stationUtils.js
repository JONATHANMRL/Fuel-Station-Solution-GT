export const hasPrice = (value) => Number.isFinite(value) && value > 0

export const hasCoordinates = (station) =>
  Number.isFinite(station.lat) && Math.abs(station.lat) <= 90 &&
  Number.isFinite(station.lng) && Math.abs(station.lng) <= 180 &&
  station.locationStatus === 'verified'

export function comparePrices(a, b, order = 'asc') {
  if (!hasPrice(a.price)) return hasPrice(b.price) ? 1 : 0
  if (!hasPrice(b.price)) return -1
  return order === 'asc' ? a.price - b.price : b.price - a.price
}

export function getCheapestStation(rows) {
  return rows.filter((station) => hasPrice(station.price))
    .sort((a, b) => a.price - b.price)[0]
}

export function getPriceDifference(stations, fuel) {
  if (stations.length !== 2 || stations.some((station) => !hasPrice(station.prices[fuel]))) return null
  return Math.abs(stations[0].prices[fuel] - stations[1].prices[fuel])
}
