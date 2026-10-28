import assert from 'node:assert/strict'
import test from 'node:test'
import { apiClient, createApiClient } from '../src/services/apiClient.js'
import * as service from '../src/services/oracleOperationsService.js'
import { createNotificationLoader } from '../src/services/notificationLoader.js'
import { createStationLoader } from '../src/services/stationLoader.js'
import { getStationSnapshot } from '../src/services/gasolinaService.js'
import { getCheapestStation } from '../src/utils/stationUtils.js'
import { jsonResponse, stationsResponse } from './fixtures/oracleApi.mjs'

const notice = (id = '1') => ({ id, source: 'oracle', stationId: '1', fuel: 'regular', title: 'Station',
  message: 'Bajó el precio', previousPrice: 30, newPrice: 29, type: 'down', read: false, createdAt: '2026-10-26T12:00:00-06:00' })
const envelope = (key, rows, extra = {}) => ({ source: 'oracle', count: rows.length, fetchedAt: '2026-10-26T18:00:00Z', [key]: rows, ...extra })
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { resolve, promise } }

test('operations HTTP preserves cookies, HTTPS, CSRF and the existing public read contract', async (context) => {
  const calls = [], catalog = stationsResponse()
  const body = { station_id: '1', fuel: 'regular', price: '29.00', expected_price_id: '100', request_id: '00000000-0000-4000-8000-000000000001' }
  const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/stations')) return jsonResponse(catalog)
    if (url.endsWith('/read')) return new Response(null, { status: 204 })
    if (url.includes('/notifications?')) return jsonResponse(envelope('notifications', [notice()], { userId: '22' }))
    if (url.includes('/history?')) return jsonResponse(envelope('history', [{ ...notice(), stationName: 'Station', updatedAt: notice().createdAt, administrator: null }]))
    if (url.endsWith('/capabilities')) return jsonResponse({ priceWrites: true, history: true, notifications: true, historyAdministratorAvailable: false })
    if (options.method === 'POST') {
      catalog.stations[0].prices.regular = 29
      return jsonResponse({ source: 'oracle', priceId: '101', stationId: '1', fuel: 'regular', previousPrice: 30, newPrice: 29,
        updatedAt: notice().createdAt, replayed: false })
    }
    return jsonResponse(envelope('prices', [{ stationId: '1', fuel: 'regular', available: true, priceId: '100', price: 30 }]))
  } })
  context.mock.method(apiClient, 'operations', client.operations)
  context.mock.method(apiClient, 'stations', client.stations)
  assert.equal((await service.getCapabilities()).priceWrites, true)
  assert.equal((await service.getPriceStates()).prices[0].priceId, '100')
  const states = []
  const loader = createStationLoader(getStationSnapshot, (state) => states.push(state))
  await loader.refresh()
  await service.saveOraclePrice(body)
  await loader.refresh()
  assert.equal(states.at(-1).stations[0].prices.regular, 29)
  assert.equal(getCheapestStation(states.at(-1).stations.map((station) => ({ ...station, price: station.prices.regular }))).id, '1')
  assert.equal((await service.getOracleHistory()).history[0].administrator, null)
  assert.equal((await service.getOracleNotifications()).userId, '22')
  await service.markOracleNotificationRead('1')
  for (const { url, options } of calls) {
    assert.equal(options.credentials, url.endsWith('/stations') ? 'omit' : 'include')
    if (options.method === 'POST') assert.equal(options.headers['X-Admin-Request'], '1')
    assert.equal(options.cache, 'no-store')
  }
  const saved = calls.find(({ url, options }) => url.endsWith('/admin/prices') && options.method === 'POST')
  assert.deepEqual(JSON.parse(saved.options.body), body)
  assert.ok(!('user' in JSON.parse(saved.options.body)))
  await assert.rejects(createApiClient({ baseUrl: 'http://api.test.invalid' }).operations('/admin/prices'), { code: 'HTTPS_REQUIRED' })
})

test('unsafe or incompatible Oracle payloads cannot be presented as authenticated operations', async (context) => {
  for (const bad of [
    envelope('notifications', [notice(), notice()], { userId: '22' }),
    envelope('notifications', [{ ...notice(), source: 'local' }], { userId: '22' }),
    envelope('notifications', [{ ...notice(), newPrice: 0 }], { userId: '22' }),
    envelope('notifications', [notice()], { userId: 'demo-user' }),
  ]) {
    context.mock.method(apiClient, 'operations', async () => bad)
    await assert.rejects(service.getOracleNotifications(), { code: 'INVALID_RESPONSE' })
  }
  context.mock.method(apiClient, 'operations', async () => ({ source: 'demo', priceWrites: 'true' }))
  await assert.rejects(service.getCapabilities(), { code: 'INVALID_RESPONSE' })
})

test('write errors keep safe conflict/uncertainty codes; no mutation is retried automatically', async () => {
  for (const code of ['PRICE_CONFLICT', 'COMMIT_UNCERTAIN', 'REQUEST_UNRESOLVED', 'PRICE_WRITES_DISABLED']) {
    let calls = 0
    const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async () => {
      calls++; return jsonResponse({ detail: { code, message: 'PRIVATE DSN' } }, code.startsWith('PRICE_') && code !== 'PRICE_WRITES_DISABLED' ? 409 : 503)
    } })
    await assert.rejects(client.operations('/admin/prices', { method: 'POST', body: {} }), (error) =>
      error.code === code && !error.message.includes('PRIVATE'))
    assert.equal(calls, 1)
  }
})

function harness(fetch) {
  const states = [], timers = []
  const loader = createNotificationLoader({ getOracleNotifications: fetch }, (state) => states.push(state), {
    schedule: (callback, delay) => { timers.push({ callback, delay }); return timers.length }, unschedule: () => {},
  })
  return { loader, states, timers }
}

test('notification polling never overlaps, deduplicates Oracle IDs and propagates read changes', async () => {
  const pending = deferred()
  let calls = 0, read = false
  const { loader, states, timers } = harness(async () => {
    calls++
    if (calls === 1) await pending.promise
    return envelope('notifications', [{ ...notice(), read }], { userId: '22' })
  })
  const first = loader.start('22')
  const duplicate = loader.refresh()
  assert.equal(calls, 1)
  pending.resolve()
  await Promise.all([first, duplicate])
  assert.equal(states.at(-1).notifications.length, 1)
  assert.equal(timers.at(-1).delay, 30000)
  read = true
  await timers.at(-1).callback()
  assert.equal(states.at(-1).notifications.length, 1)
  assert.equal(states.at(-1).notifications[0].read, true)
})

test('logout/account switch and queued old timers cannot restore another user notifications', async () => {
  const old = deferred()
  let calls = 0
  const { loader, states, timers } = harness(async () => {
    if (++calls === 1) return old.promise
    return envelope('notifications', [], { userId: '23' })
  })
  const pending = loader.start('22')
  await loader.start('23')
  const timer = timers.at(-1).callback
  old.resolve(envelope('notifications', [notice()], { userId: '22' }))
  await pending
  assert.equal(states.at(-1).userId, '23')
  assert.deepEqual(states.at(-1).notifications, [])
  loader.cancel()
  await timer()
  assert.equal(calls, 2)
  await loader.start(null)
  assert.deepEqual(states.at(-1).notifications, [])
})

test('refresh after marking read cannot reuse a snapshot fetched before the acknowledgement', async () => {
  const old = deferred()
  let calls = 0
  const { loader, states } = harness(async () => {
    if (++calls === 1) return old.promise
    return envelope('notifications', [{ ...notice(), read: true }], { userId: '22' })
  })
  const initial = loader.start('22')
  const afterRead = loader.refresh()
  old.resolve(envelope('notifications', [notice()], { userId: '22' }))
  await Promise.all([initial, afterRead])
  assert.equal(calls, 2)
  assert.equal(states.at(-1).notifications[0].read, true)
})

test('notification failures never fall back to local/demo notices and can recover', async () => {
  let fail = true
  const { loader, states } = harness(async () => {
    if (fail) throw new Error('HTTP_503')
    return envelope('notifications', [notice()], { userId: '22' })
  })
  await loader.start('22')
  assert.deepEqual(states.at(-1).notifications, [])
  assert.equal(states.at(-1).error, 'HTTP_503')
  fail = false
  await loader.refresh()
  assert.equal(states.at(-1).notifications[0].source, 'oracle')
  assert.equal(states.at(-1).error, '')
})

test('pagination does not duplicate notices and full refresh discards displaced old pages', async () => {
  let refresh = false
  const { loader, states } = harness(async ({ offset }) => envelope('notifications', offset === 0
    ? (refresh ? [notice('999')] : Array.from({ length: 50 }, (_, index) => notice(String(index + 1))))
    : [notice('50'), notice('51')], { userId: '22' }))
  await loader.start('22')
  assert.equal(states.at(-1).hasMore, true)
  await loader.more()
  assert.equal(states.at(-1).notifications.length, 51)
  refresh = true
  await loader.refresh()
  assert.deepEqual(states.at(-1).notifications.map((row) => row.id), ['999'])
})
