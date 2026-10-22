// Synthetic responses, never imported by src/ or used as a runtime fallback.
export function stationsResponse() {
  const ids = [1, 2, 3, 4, 5, ...Array.from({ length: 20 }, (_, i) => 21 + i)]
  const brands = ['Shell', 'Puma Energy', 'Texaco', 'Pegaso', 'Metro', 'Don Arturo', 'UNO']
  const stations = ids.map((id, i) => ({
    id: String(id), name: `Estación SIMULADA ${id}`, brand: brands[i % 7],
    address: `Dirección SIMULADA, zona ${i + 1}`, municipality: 'Huehuetenango',
    department: 'Huehuetenango', zone: `Zona ${i + 1}`, lat: 15.3, lng: -91.4,
    locationStatus: 'pending', stationStatus: 'ACTIVA', status: 'active', updatedAt: null,
    prices: { premium: 32.25 + i, regular: 31.25 + i, diesel: 30.25 + i },
    availability: { premium: 'DISPONIBLE', regular: 'DISPONIBLE', diesel: 'DISPONIBLE' },
    source: 'oracle', isDemo: false,
  }))
  return { source: 'oracle', count: stations.length, fetchedAt: '2026-10-20T12:00:00Z', stations }
}

export function brandsResponse() {
  const { stations, fetchedAt } = stationsResponse()
  const counts = new Map()
  for (const station of stations) counts.set(station.brand, (counts.get(station.brand) ?? 0) + 1)
  const brands = [...counts].map(([name, count]) => ({ name, count, stations: count }))
  return { source: 'oracle', count: brands.length, fetchedAt, brands }
}

export function pricesResponse(fuel) {
  const { stations, fetchedAt } = stationsResponse()
  const prices = stations.flatMap((station) => ['premium', 'regular', 'diesel']
    .filter((key) => !fuel || key === fuel).map((key) => ({
      stationId: station.id, stationName: station.name, brand: station.brand,
      municipality: station.municipality, zone: station.zone, fuel: key,
      price: station.prices[key], availability: station.availability[key], available: true, updatedAt: null,
    })))
  return { source: 'oracle', count: prices.length, fetchedAt, prices }
}

export function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}
