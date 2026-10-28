import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { realStations } from '../src/realStations.js'
import { apiClient } from '../src/services/apiClient.js'
import { createApiClient } from '../src/services/apiClient.js'
import { createStationLoader } from '../src/services/stationLoader.js'
import * as service from '../src/services/gasolinaService.js'
import { normalizeOracleId } from '../src/utils/oracleIdentity.js'
import { canDisplayOnMap, comparePrices, getAvailabilityLabel, getCheapestStation, getPriceDifference, hasAvailablePrice, hasCoordinates } from '../src/utils/stationUtils.js'
import { brandsResponse, jsonResponse, pricesResponse, stationsResponse } from './fixtures/oracleApi.mjs'

let storage, writes, reads

test.beforeEach(() => {
  storage = new Map()
  writes = []
  reads = []
  globalThis.window = { localStorage: {
    getItem(key) { reads.push(key); return storage.get(key) ?? null },
    setItem(key, value) { writes.push(key); storage.set(key, value) },
  } }
})
test.afterEach(() => { delete globalThis.window })
const put = (key, value) => storage.set(key, JSON.stringify(value))

test('reference catalogue remains intact with eight verified and nine pending locations', () => {
  assert.equal(realStations.length, 17)
  assert.equal(realStations.filter(hasCoordinates).length, 8)
  assert.equal(realStations.filter((station) => !hasCoordinates(station)).length, 9)
  for (const station of realStations) {
    assert.ok(Object.values(station.prices).every((value) => value === null))
    assert.equal(station.updatedAt, null)
  }
})

test('async services consume API objects without reading or writing stored station prices', async (context) => {
  put('gasolina-gt:stations', [{ id: '1', prices: { regular: 0.01 } }])
  context.mock.method(apiClient, 'stations', async () => stationsResponse())
  context.mock.method(apiClient, 'brands', async () => brandsResponse())
  context.mock.method(apiClient, 'prices', async ({ fuel }) => pricesResponse(fuel))
  const stations = await service.getStations()
  assert.equal(stations.length, 25)
  assert.equal(stations[0].prices.regular, 31.25)
  assert.equal((await service.getBrands()).length, 7)
  assert.equal((await service.getPrices('regular')).length, 25)
  assert.deepEqual(reads, [])
  assert.deepEqual(writes, [])
})

test('failed HTTP service rejects even if old local station records are available', async (context) => {
  put('gasolina-gt:stations', realStations)
  context.mock.method(apiClient, 'stations', async () => { throw new Error('HTTP_503') })
  await assert.rejects(service.getStations(), /HTTP_503/)
  assert.deepEqual(reads, [])
})

test('HTTP-to-service-to-loader workflow refreshes availability, preserves favorites, clears failures and retries', async (context) => {
  let unavailable = false
  const data = stationsResponse()
  put('gasolina-gt:stations', [{ id: '1', prices: { regular: 0.01 } }])
  const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async () =>
    unavailable ? jsonResponse({ detail: 'private driver error' }, 503) : jsonResponse(data) })
  context.mock.method(apiClient, 'stations', client.stations)
  const states = []
  const loader = createStationLoader(service.getStationSnapshot, (state) => states.push(state))
  await loader.refresh()
  assert.equal(states.at(-1).stations.length, 25)
  service.saveFavorites(['1', '40'])
  data.stations[0].availability.regular = 'AGOTADO'
  data.stations[0].prices.regular = 1
  await loader.refresh()
  const rows = states.at(-1).stations.map((station) => ({ ...station,
    price: station.prices.regular, available: hasAvailablePrice(station, 'regular') }))
  assert.equal(rows[0].price, 1)
  assert.equal(getCheapestStation(rows).id, '2')
  unavailable = true
  await loader.refresh()
  assert.equal(states.at(-1).status, 'error')
  assert.deepEqual(states.at(-1).stations, [])
  assert.deepEqual(service.getFavorites(), ['1', '40'])
  assert.deepEqual(writes, ['gasolina-gt:oracle:favorites'])
  assert.ok(!reads.includes('gasolina-gt:stations'))
  unavailable = false
  await loader.refresh()
  assert.equal(states.at(-1).status, 'ready')
  assert.equal(states.at(-1).stations[0].locationStatus, 'pending')
})

test('favorites use a distinct Oracle namespace and never convert reference/demo IDs', () => {
  const old = ['hue-real-01', 'hue-real-17', 'est-1']
  put('gasolina-gt:favorites', old)
  assert.deepEqual(service.getFavorites(), [])
  assert.deepEqual(service.getLegacyFavorites(), ['hue-real-01', 'hue-real-17'])
  service.saveFavorites(['1', 40, '040', '9999', 'hue-real-01', 'est-1', '0', null])
  assert.deepEqual(service.getFavorites(), ['1', '40', '9999'])
  assert.deepEqual(JSON.parse(storage.get('gasolina-gt:favorites')), old)
  assert.deepEqual(writes, ['gasolina-gt:oracle:favorites'])
})

test('arbitrary valid Oracle IDs remain favorites regardless of loaded catalogue size', () => {
  service.saveFavorites(['101', '90001'])
  assert.deepEqual(service.getFavorites(), ['101', '90001'])
  assert.equal(normalizeOracleId('hue-real-01'), null)
  assert.equal(normalizeOracleId('100000000000000000000'), '100000000000000000000')
  assert.equal(normalizeOracleId(Number.MAX_SAFE_INTEGER + 1), null)
})

test('missing, corrupt or denied local storage does not prevent reading defaults', () => {
  storage.set('gasolina-gt:oracle:favorites', '{bad json')
  assert.deepEqual(service.getFavorites(), [])
  put('gasolina-gt:notification-preferences', null)
  assert.deepEqual(service.getNotificationPreferences(), { priceChanges: true, favoritesOnly: false })
  window.localStorage.getItem = () => { throw new Error('Storage denied') }
  assert.deepEqual(service.getFavorites(), [])
})

test('exhausted and inactive stations keep prices but cannot win, sort first or be compared', () => {
  const stations = stationsResponse().stations
  stations[0].prices.regular = 0.01
  stations[0].availability.regular = 'AGOTADO'
  stations[1].stationStatus = 'INACTIVA'
  const rows = stations.map((station) => ({ ...station, price: station.prices.regular, available: hasAvailablePrice(station, 'regular') }))
  assert.equal(getCheapestStation(rows).id, '3')
  assert.equal([...rows].sort((a, b) => comparePrices(a, b, 'asc'))[0].id, '3')
  assert.equal([...rows].sort((a, b) => comparePrices(a, b, 'desc')).at(-1).available, false)
  assert.equal(getPriceDifference([stations[0], stations[2]], 'regular'), null)
  assert.equal(getPriceDifference([stations[1], stations[2]], 'regular'), null)
  assert.equal(getAvailabilityLabel(stations[0], 'regular'), 'Agotado')
  assert.equal(getAvailabilityLabel(stations[1], 'regular'), 'Estación inactiva')
  assert.equal(getPriceDifference([stations[2], stations[3]], 'regular'), 1)
})

test('missing prices sort last and never produce a minimum or comparison', () => {
  const stations = stationsResponse().stations
  stations[0].prices.regular = null
  assert.equal(hasAvailablePrice(stations[0], 'regular'), false)
  assert.equal(getPriceDifference(stations.slice(0, 2), 'regular'), null)
  assert.equal(getCheapestStation([{ price: null }, { price: 0 }, { price: NaN }, { price: 1, available: false }]), undefined)
  assert.equal(comparePrices({ price: null }, { price: 30 }), 1)
})

test('Oracle pending coordinates require explicit map demo and remain pending', () => {
  const station = stationsResponse().stations[0]
  assert.equal(hasCoordinates(station), false)
  assert.equal(canDisplayOnMap(station), false)
  assert.equal(canDisplayOnMap(station, false), false)
  assert.equal(canDisplayOnMap(station, 'true'), false)
  assert.equal(canDisplayOnMap(station, true), true)
  assert.equal(station.locationStatus, 'pending')
  assert.equal(canDisplayOnMap({ ...station, lat: null }, true), false)
  assert.equal(canDisplayOnMap({ ...station, lat: 100 }, true), false)
  assert.equal(canDisplayOnMap({ ...station, source: 'demo' }, true), false)
})

test('legacy local notices and preferences persist without linking IDs to another station', () => {
  put('gasolina-gt:notifications', [
    { id: 'old-demo', stationId: 'est-1', source: 'demo', title: 'Cambio', message: 'Prueba' },
    { id: 'local', stationId: 'hue-real-01', source: 'local', title: 'Precio registrado', message: 'Aviso guardado', read: false },
  ])
  assert.equal(service.getNotifications().length, 1)
  service.markNotificationsRead()
  assert.equal(service.getNotifications()[0].stationId, 'hue-real-01')
  assert.equal(service.getNotifications()[0].read, true)
  service.saveNotificationPreferences({ priceChanges: false, favoritesOnly: true })
  assert.deepEqual(service.getNotificationPreferences(), { priceChanges: false, favoritesOnly: true })
})

test('price writes stay blocked for every Oracle station and fuel', () => {
  for (const station of stationsResponse().stations) {
    for (const fuel of ['premium', 'regular', 'diesel']) {
      assert.throws(() => service.updatePrice({ stationId: station.id, fuel, price: 30 }), /Acceso administrativo no disponible/)
    }
  }
  assert.deepEqual(writes, [])
})

test('seven sections and admin gate are retained with a clean public presentation', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const login = readFileSync(new URL('../src/components/AdminAccessGate.jsx', import.meta.url), 'utf8')
  for (const id of ['inicio', 'mapa', 'marcas', 'comparar', 'favoritos', 'notificaciones', 'admin']) {
    assert.ok(app.includes(`id="${id}"`))
  }
  assert.ok(app.includes('<AdminAccessGate>'))
  assert.ok(app.includes('Explorar gasolineras'))
  assert.ok(!app.includes('Modo de demostración:'))
  assert.ok(app.includes('No tienes notificaciones.'))
  assert.ok(login.includes('if (session)'))
  assert.ok(login.includes('{children}'))
})
