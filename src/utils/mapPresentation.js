import { normalizeOracleId } from './oracleIdentity.js'

// Presentation-only Halton layout. No Oracle coordinates or quality flags change.
// Stable for each ID, independent of catalogue order, filters, additions and prices.
function radicalInverse(value, base) {
  let fraction = 1 / Number(base), result = 0
  while (value > 0n) {
    result += Number(value % base) * fraction
    value /= base
    fraction /= Number(base)
  }
  return result
}

export function getIllustratedPosition(value) {
  const id = normalizeOracleId(value)
  if (!id) return null
  const number = BigInt(id)
  return Object.freeze({
    lat: 15.285 + radicalInverse(number, 2n) * 0.065,
    lng: -91.522 + radicalInverse(number, 7n) * 0.095,
    simulated: true, source: 'presentation',
  })
}

export function buildMapMarkers(stations) {
  const markers = new Map()
  for (const station of stations) {
    const id = normalizeOracleId(station?.id)
    if (!id || station.source !== 'oracle' || markers.has(id)) continue
    const position = getIllustratedPosition(id)
    markers.set(id, { id, station, position })
  }
  return [...markers.values()]
}

// Static, trusted SVG. No station names, URLs or API data enter the HTML string.
export function fuelMarkerSvg(color, selected = false) {
  const fill = /^#[0-9a-f]{6}$/i.test(color) ? color : '#64748B'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42" aria-hidden="true"><path d="M17 40C13 34 2 26 2 17a15 15 0 1 1 30 0c0 9-11 17-15 23Z" fill="${fill}" stroke="${selected ? '#123047' : '#FFFFFF'}" stroke-width="${selected ? 3 : 2}"/><rect x="8" y="7" width="13" height="22" rx="3" fill="#FFFFFF"/><path d="M10 10h9v8h-9z" fill="#123047"/><path d="M21 14h3v10a2 2 0 0 0 4 0V12l-3-3M6 29h17" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></svg>`
}
