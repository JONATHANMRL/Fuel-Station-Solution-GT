import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const sources = ['src/data.js', 'src/realStations.js', 'src/utils/stationUtils.js',
  'src/services/adminAuthService.js', 'src/services/gasolinaService.js']
  .map((path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '').replace(/^export /gm, ''))
  .join('\n')

function load(stored = {}) {
  const storage = new Map(Object.entries(stored).map(([key, value]) => [key, JSON.stringify(value)]))
  let writes = 0
  const context = vm.createContext({ console, window: { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { writes++; storage.set(key, value) },
  } } })
  vm.runInContext(sources, context)
  const api = vm.runInContext('({ realStations, getStations, getBrands, getFavorites, saveFavorites, getNotifications, saveNotifications, markNotificationsRead, getHistory, updatePrice, signInAdmin, hasPrice, hasCoordinates, comparePrices, getCheapestStation, getPriceDifference })', context)
  return { api, storage, writes: () => writes }
}

test('only the 17 real references are loaded, without invented prices', () => {
  const { api, writes } = load()
  const stations = api.getStations()
  assert.equal(stations.length, 17)
  assert.equal(new Set(stations.map((station) => station.id)).size, 17)
  assert.equal(api.realStations.length, 17)
  assert.ok(!stations.some((station) => /Pegaso.*Chiantla/i.test(station.name)))
  for (const station of api.realStations) {
    for (const fuel of ['premium', 'regular', 'diesel']) assert.equal(station.prices[fuel], null)
    assert.equal(station.updatedAt, null)
    assert.equal(station.isDemo, false)
  }
  assert.equal(api.getFavorites().length, 0)
  assert.equal(api.getNotifications().length, 0)
  assert.equal(api.getHistory().length, 0)
  assert.equal(writes(), 0)
})

test('eight corroborated coordinates, nine pending; no fabricated markers', () => {
  const { api } = load()
  assert.equal(api.realStations.filter(api.hasCoordinates).length, 8)
  assert.equal(api.realStations.filter((station) => !api.hasCoordinates(station)).length, 9)
  for (const station of api.realStations) {
    if (api.hasCoordinates(station)) {
      assert.ok(station.sources.length > 0)
      assert.ok(station.lat > 15 && station.lat < 16 && station.lng > -92 && station.lng < -91)
    } else {
      assert.equal(station.lat, null)
      assert.equal(station.lng, null)
    }
  }
  assert.equal(api.hasCoordinates({ lat: 15.3, lng: -91.4, isDemo: false, locationStatus: 'pending' }), false)
})

test('legacy fixtures are excluded while valid real station records are preserved', () => {
  const initial = load().api
  const saved = JSON.parse(JSON.stringify(initial.realStations))
  saved[0].prices.regular = 40.25
  saved[0].updatedAt = '2026-10-20T08:00:00Z'
  saved.push({ id: 'est-1', name: 'Demo Shell', isDemo: true, prices: { regular: 33.9 } })
  const preferences = { priceChanges: false, favoritesOnly: true }
  const env = load({ 'gasolina-gt:stations': saved, 'gasolina-gt:favorites': ['est-2', 'hue-real-01', 'hue-real-01'],
    'gasolina-gt:notification-preferences': preferences,
    'gasolina-gt:history': [
      { id: 'retired-change', stationId: 'est-1', source: 'demo', newPrice: 33.9 },
      { id: 'real-change', stationId: 'hue-real-01', source: 'local', newPrice: 40.25 },
    ], 'gasolina-gt:notifications': [
      { id: 'retired-notification', stationId: 'est-1', source: 'demo', title: 'Demo', message: 'Prueba' },
      { id: 'real-notification', stationId: 'hue-real-01', source: 'local', title: 'Actualización de precios', message: 'Precio registrado' },
    ] })
  const stations = env.api.getStations()
  assert.equal(stations.length, 17)
  assert.equal(stations[0].prices.regular, 40.25)
  assert.equal(env.api.getFavorites().join(','), 'hue-real-01')
  assert.equal(env.api.getHistory().length, 1)
  assert.equal(env.api.getHistory()[0].id, 'real-change')
  assert.equal(env.api.getNotifications().length, 1)
  assert.equal(env.api.getNotifications()[0].id, 'real-notification')
  env.storage.set('gasolina-gt:stations', JSON.stringify(stations))
  assert.equal(env.api.getStations().length, 17)
  assert.equal(env.writes(), 0)
})

test('missing prices always sort last and never participate in minima or differences', () => {
  const { api } = load()
  const rows = [{ id: 'missing', price: null }, { id: 'higher', price: 36 }, { id: 'lower', price: 30 }]
  assert.equal([...rows].sort((a, b) => api.comparePrices(a, b, 'asc'))[2].id, 'missing')
  assert.equal([...rows].sort((a, b) => api.comparePrices(a, b, 'desc'))[2].id, 'missing')
  assert.equal(api.getCheapestStation(rows).id, 'lower')
  assert.equal(api.getCheapestStation([{ price: null }, { price: 0 }, { price: NaN }]), undefined)
  assert.equal(api.getPriceDifference([{ prices: { regular: null } }, { prices: { regular: 30 } }], 'regular'), null)
  assert.equal(api.getPriceDifference([{ prices: { regular: 30 } }, { prices: { regular: 30 } }], 'regular'), 0)
  assert.equal(api.getPriceDifference([{ prices: { regular: 30 } }, { prices: { regular: 36 } }], 'regular'), 6)
})

test('brands and favorites include new stations, including pending locations', () => {
  const { api } = load()
  const brands = api.getBrands()
  for (const name of ['Pegaso', 'METRO', 'Don Arturo', 'Uno']) assert.ok(brands.some((brand) => brand.name === name))
  assert.equal(brands.length, 7)
  assert.equal(brands.find((brand) => brand.name === 'Shell').count, 6)
  assert.equal(brands.find((brand) => brand.name === 'Puma').count, 3)
  for (const name of ['Mobil', 'Total', 'Independiente']) assert.ok(!brands.some((brand) => brand.name === name))
  api.saveFavorites(['hue-real-01', 'hue-real-08'])
  assert.equal(api.getFavorites().join(','), 'hue-real-01,hue-real-08')
})

test('authentication still blocks every new station before any write', () => {
  const { api, writes } = load()
  for (const station of api.realStations) {
    for (const fuel of ['premium', 'regular', 'diesel']) {
      assert.throws(() => api.updatePrice({ stationId: station.id, fuel, price: 30 }), /Acceso administrativo no disponible/)
    }
  }
  assert.equal(writes(), 0)
})

test('retired notifications never reappear and read state still persists', () => {
  const { api } = load({ 'gasolina-gt:notifications': [
    { id: 'old', stationId: 'hue-real-01', source: 'demo', title: 'Cambio', message: 'Prueba' },
    { id: 'old-title', stationId: 'hue-real-01', title: 'Actualización demo', message: 'Prueba' },
    { id: 'actual', stationId: 'hue-real-01', title: 'Precio actualizado', message: 'Cambio registrado', read: false },
  ] })
  assert.equal(api.getNotifications().length, 1)
  api.markNotificationsRead()
  assert.equal(api.getNotifications()[0].id, 'actual')
  assert.equal(api.getNotifications()[0].read, true)
})

test('invalid local prices cannot create prices or dates and login never grants access', () => {
  const { api, writes } = load({ 'gasolina-gt:stations': [
    { id: 'hue-real-01', prices: { premium: '36', regular: 0, diesel: -1 }, updatedAt: '2026-10-20' },
    { id: 'hue-real-02', source: 'demo', prices: { regular: 30 } },
  ] })
  for (const station of api.getStations()) {
    assert.ok(Object.values(station.prices).every((value) => value === null))
    assert.equal(station.updatedAt, null)
  }
  assert.throws(() => api.signInAdmin({ username: 'admin', password: 'not-a-real-password' }), /Acceso administrativo no disponible/)
  assert.equal(writes(), 0)
})

test('screens contain no fixture labels or integration banners and keep the access gate', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const login = readFileSync(new URL('../src/components/AdminAccessGate.jsx', import.meta.url), 'utf8')
  const prohibited = /\bDemo\b|demostraci[oó]n|Estaci[oó]n ficticia|Ubicaci[oó]n ficticia|Integraci[oó]n pendiente|Formulario preparado|Sin base de datos|Pendiente de conectar/i
  assert.ok(!prohibited.test(app))
  assert.ok(!prohibited.test(login))
  assert.ok(app.includes('<AdminAccessGate>'))
  assert.ok(login.includes('signInAdmin({ username, password })'))
  assert.ok(app.includes('No tienes notificaciones.'))
  assert.ok(app.includes('unreadCount > 0 && <span className="notification-count">'))
  assert.ok(!login.includes('{children}'))
})
