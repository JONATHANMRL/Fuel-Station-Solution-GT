import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildMapMarkers, fuelMarkerSvg, getIllustratedPosition } from '../src/utils/mapPresentation.js'
import { navigation, navigationLabel } from '../src/config/navigation.js'
import { activatePublicPriceAlerts, createPublicPriceAlertsLoader } from '../src/services/publicPriceAlertsLoader.js'
import { createStationLoader } from '../src/services/stationLoader.js'
import { getAvailabilityLabel } from '../src/utils/stationUtils.js'
import { stationsResponse } from './fixtures/oracleApi.mjs'

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const publicPage = (id = '10') => ({ alerts: [{ id: `public-price:${id}`, priceId: id }], nextCursor: null,
  activatedAt: null, fetchedAt: '2026-10-28T18:00:00Z' })
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { promise, resolve } }

test('25 Oracle stations produce exactly 25 distinct markers without modifying data or verification', () => {
  const data = stationsResponse().stations
  const before = structuredClone(data)
  const markers = buildMapMarkers(data)
  assert.equal(markers.length, 25)
  assert.equal(new Set(markers.map((marker) => marker.id)).size, 25)
  assert.equal(new Set(markers.map((marker) => `${marker.position.lat}:${marker.position.lng}`)).size, 25)
  markers.forEach((marker, index) => {
    assert.equal(marker.station, data[index])
    assert.equal(marker.id, marker.station.id)
    assert.equal(marker.position.simulated, true)
    assert.equal(marker.position.source, 'presentation')
    assert.equal(marker.station.locationStatus, 'pending')
    assert.ok(marker.position.lat >= 15.285 && marker.position.lat < 15.35)
    assert.ok(marker.position.lng >= -91.522 && marker.position.lng < -91.427)
  })
  assert.deepEqual(data, before)
  let separation = Infinity
  for (let i = 0; i < markers.length; i++) for (let j = 0; j < i; j++) {
    const a = markers[i].position, b = markers[j].position
    separation = Math.min(separation, Math.hypot((a.lat - b.lat) / 0.065, (a.lng - b.lng) / 0.095))
  }
  assert.ok(separation > 0.08, 'the existing catalogue is distributed across the map rather than stacked')
})

test('positions stay stable across order, filters, new/missing stations and price changes', () => {
  const data = stationsResponse().stations
  const initial = new Map(buildMapMarkers(data).map((marker) => [marker.id, marker.position]))
  const changed = [...data].reverse().map((station) => ({ ...station, lat: null, lng: null,
    prices: { ...station.prices, regular: 21 } }))
  changed.push({ ...data[0], id: '9999999999999999999999999999' })
  for (const marker of buildMapMarkers(changed)) {
    if (initial.has(marker.id)) assert.deepEqual(marker.position, initial.get(marker.id))
  }
  const filtered = data.filter((station) => station.brand === 'Shell')
  assert.deepEqual(buildMapMarkers(filtered).map((marker) => marker.position), filtered.map((station) => initial.get(station.id)))
  assert.equal(buildMapMarkers(data.slice(1)).some((marker) => marker.id === data[0].id), false)
  assert.deepEqual(getIllustratedPosition('9999999999999999999999999999'), getIllustratedPosition('9999999999999999999999999999'))
})

test('no local catalogue, invalid IDs, duplicates or invented stations enter the map', () => {
  const oracle = stationsResponse().stations[0]
  const markers = buildMapMarkers([oracle, oracle, { ...oracle, source: 'local', id: '777' },
    { ...oracle, id: 'hue-real-01' }, { ...oracle, id: '0' }, null])
  assert.deepEqual(markers.map((marker) => marker.id), [oracle.id])
  assert.deepEqual(buildMapMarkers([]), [])
})

test('map price refresh keeps selection ID and position, while failures never show stale catalogue prices', async () => {
  const data = stationsResponse()
  let fail = false
  const states = []
  const loader = createStationLoader(async () => { if (fail) throw new Error('Connection unavailable'); return data }, (state) => states.push(state))
  await loader.refresh()
  const selectedId = data.stations[0].id
  const original = buildMapMarkers(states.at(-1).stations).find((marker) => marker.id === selectedId)
  data.stations[0].prices.regular = 22.15
  data.stations[0].availability.regular = 'AGOTADO'
  await loader.refresh()
  const selected = buildMapMarkers(states.at(-1).stations).find((marker) => marker.id === selectedId)
  assert.deepEqual(selected.position, original.position)
  assert.equal(selected.station.prices.regular, 22.15)
  assert.equal(getAvailabilityLabel(selected.station, 'regular'), 'Agotado')
  fail = true
  await loader.refresh()
  assert.equal(states.at(-1).status, 'error')
  assert.deepEqual(buildMapMarkers(states.at(-1).stations), [])
})

test('fuel marker SVG is uniform, selected and safe without inserting station data into HTML', () => {
  const plain = fuelMarkerSvg('#F5C400')
  const selected = fuelMarkerSvg('#F5C400', true)
  for (const svg of [plain, selected]) assert.ok(svg.includes('width="34" height="42"'))
  assert.notEqual(plain, selected)
  assert.ok(!fuelMarkerSvg('<script>unsafe()</script>').includes('<script>'))
  const marker = read('components/StationMapMarker.jsx')
  assert.ok(marker.includes('onSelect(marker.id)'))
  assert.ok(marker.includes("['regular', 'premium', 'diesel']"))
  assert.ok(marker.includes('getAvailabilityLabel'))
  assert.ok(!marker.includes('maps/dir'))
})

test('administrative link stays last and changes with authenticated session/logout only', () => {
  const admin = navigation.at(-1)
  assert.equal(navigation.length, 7)
  assert.equal(admin.id, 'admin')
  assert.equal(navigationLabel(admin, null), 'Acceso administrativo')
  assert.equal(navigationLabel(admin, { authenticated: true, user: { id: '22', role: 'admin' } }), 'Panel admin')
  assert.equal(navigationLabel(admin, { authenticated: true, user: { role: 'user' } }), 'Acceso administrativo')
  assert.equal(navigationLabel(admin, null), 'Acceso administrativo')
  assert.ok(read('App.jsx').includes('<AdminAccessGate>'))
  assert.ok(read('components/AdminAccessGate.jsx').includes('controller.signOut'))
})

test('only the active notifications section starts polling; StrictMode and navigation clean up old timers', async () => {
  const tasks = [], states = [], timers = new Map()
  let calls = 0, timerId = 0
  const loader = createPublicPriceAlertsLoader(async () => { calls++; return publicPage(String(calls)) }, (state) => states.push(state), {
    schedule: (callback, delay) => { assert.equal(delay, 30000); timers.set(++timerId, callback); return timerId },
    unschedule: (id) => timers.delete(id),
  })
  const inactive = activatePublicPriceAlerts(loader, false, (callback) => tasks.push(callback))
  assert.equal(tasks.length, 0)
  inactive()
  const discarded = activatePublicPriceAlerts(loader, true, (callback) => tasks.push(callback))
  discarded() // StrictMode's discarded setup.
  let cleanup = activatePublicPriceAlerts(loader, true, (callback) => tasks.push(callback))
  for (const task of tasks.splice(0)) task()
  await loader.refresh()
  assert.equal(calls, 1)
  assert.equal(timers.size, 1)
  for (let i = 0; i < 3; i++) {
    cleanup()
    assert.equal(timers.size, 0)
    cleanup = activatePublicPriceAlerts(loader, true, (callback) => tasks.push(callback))
    tasks.shift()()
    await loader.refresh()
    assert.equal(timers.size, 1)
  }
  const queuedOld = [...timers.values()][0]
  cleanup()
  const count = states.length
  await queuedOld()
  assert.equal(timers.size, 0)
  assert.equal(states.length, count)
  const hook = read('hooks/usePublicPriceAlerts.js')
  assert.ok(!hook.includes("addEventListener('focus'"))
})

test('leaving the section aborts its request and ignores late responses after returning', async () => {
  const request = deferred()
  let calls = 0, oldSignal
  const states = []
  const loader = createPublicPriceAlertsLoader(async ({ signal }) => {
    if (++calls === 1) { oldSignal = signal; return request.promise }
    return publicPage('20')
  }, (state) => states.push(state), { schedule: () => 1, unschedule: () => {} })
  const initial = loader.start()
  loader.cancel()
  assert.equal(oldSignal.aborted, true)
  await loader.start()
  request.resolve(publicPage('1'))
  await initial
  assert.equal(states.at(-1).alerts[0].priceId, '20')
})

test('public JSX contains useful data and errors without technical warnings or GPS claims', () => {
  const components = ['App.jsx', 'components/PublicPriceAlerts.jsx', 'components/StationMapMarker.jsx']
  for (const file of components) {
    const source = read(file)
    for (const text of ['origen sin verificar', 'Sin fecha de activación', 'Modo de demostración',
      'Coordenadas pendientes', 'Ubicación verificada', 'almacenados en Oracle', 'cada 30 segundos',
      'maps/dir', 'la más cercana a ti']) assert.ok(!source.includes(text), `${file}: ${text}`)
  }
  const alerts = read('components/PublicPriceAlerts.jsx')
  assert.ok(alerts.includes('alert.createdAt'))
  assert.ok(alerts.includes('alert.previousPrice'))
  assert.ok(alerts.includes('alert.newPrice'))
  assert.ok(alerts.includes('role="alert"'))
  assert.ok(read('App.jsx').includes('loadError'))
  // The provenance validator and payload are preserved, just not rendered as copy.
  assert.ok(read('services/publicPriceAlertsService.js').includes('after_activation'))
})
