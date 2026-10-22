import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiClient } from '../src/services/apiClient.js'
import { brandsResponse, jsonResponse, pricesResponse, stationsResponse } from './fixtures/oracleApi.mjs'

const baseUrl = 'https://api.test.invalid/fuel/'

test('HTTP stations contract accepts 25 Oracle IDs and never assumes 17 rows', async () => {
  const calls = []
  const client = createApiClient({ baseUrl, fetchImpl: async (...args) => {
    calls.push(args)
    return jsonResponse(stationsResponse())
  } })
  const result = await client.stations()
  assert.equal(result.stations.length, 25)
  assert.equal(result.stations.at(-1).id, '40')
  assert.equal(result.stations[0].prices.regular, 31.25)
  assert.equal(result.stations[0].locationStatus, 'pending')
  assert.equal(calls[0][0], 'https://api.test.invalid/fuel/stations')
  assert.equal(calls[0][1].method, 'GET')
  assert.equal(calls[0][1].credentials, 'omit')
  assert.equal(calls[0][1].cache, 'no-store')
  assert.equal(calls[0][1].redirect, 'error')
})

test('brands and prices use existing endpoints including regular query', async () => {
  const calls = []
  const client = createApiClient({ baseUrl, fetchImpl: async (url) => {
    calls.push(url)
    return jsonResponse(url.endsWith('/brands') ? brandsResponse()
      : pricesResponse(url.includes('?fuel=regular') ? 'regular' : undefined))
  } })
  assert.equal((await client.brands()).brands.length, 7)
  assert.equal((await client.prices()).prices.length, 75)
  assert.equal((await client.prices({ fuel: 'regular' })).prices.length, 25)
  assert.equal(calls.at(-1), 'https://api.test.invalid/fuel/prices?fuel=regular')
})

test('missing or unsafe URL and invalid timeout fail before HTTP', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; throw new Error('unexpected HTTP') }
  for (const url of [undefined, '', 'oracle://db/SERVICE', 'http://user:secret@host.invalid', 'https://api.invalid?q=secret', 'https://api.invalid/#x']) {
    await assert.rejects(createApiClient({ baseUrl: url, fetchImpl }).stations(), { code: 'API_NOT_CONFIGURED' })
  }
  await assert.rejects(createApiClient({ baseUrl, fetchImpl, timeoutMs: NaN }).stations(), { code: 'API_NOT_CONFIGURED' })
  assert.equal(calls, 0)
})

test('HTTP 503 and other errors do not expose backend internals or supply fallback data', async () => {
  for (const status of [503, 403, 500]) {
    const client = createApiClient({ baseUrl, fetchImpl: async () => jsonResponse({ password: 'sensitive-driver-details' }, status) })
    await assert.rejects(client.stations(), (error) => error.code === `HTTP_${status}` && !error.message.includes('sensitive'))
  }
})

test('network failures and invalid JSON produce explicit errors', async () => {
  await assert.rejects(createApiClient({ baseUrl, fetchImpl: async () => { throw new TypeError('fetch failed') } }).stations(), { code: 'NETWORK_ERROR' })
  await assert.rejects(createApiClient({ baseUrl, fetchImpl: async () => new Response('<html>Login</html>') }).stations(), { code: 'INVALID_RESPONSE' })
})

test('incompatible source, prices, IDs, coordinates and verification are rejected', async () => {
  const mutations = [
    (data) => { data.source = 'demo' },
    (data) => { data.count = 17 },
    (data) => { data.stations[0].id = 'hue-real-01' },
    (data) => { data.stations[1].id = '1' },
    (data) => { data.stations[0].prices.regular = '30.00' },
    (data) => { data.stations[0].prices.diesel = 0 },
    (data) => { delete data.stations[0].availability },
    (data) => { data.stations[0].lat = 181 },
    (data) => { data.stations[0].locationStatus = 'verified' },
    (data) => { data.stations[0].isDemo = true },
  ]
  for (const mutate of mutations) {
    const data = stationsResponse()
    mutate(data)
    await assert.rejects(createApiClient({ baseUrl, fetchImpl: async () => jsonResponse(data) }).stations(), { code: 'INVALID_RESPONSE' })
  }
})

test('empty database and null prices/coordinates are legitimate responses', async () => {
  const data = stationsResponse()
  data.stations[0].prices.diesel = null
  data.stations[0].availability.diesel = 'NO_REGISTRADO'
  data.stations[0].lat = data.stations[0].lng = null
  const client = createApiClient({ baseUrl, fetchImpl: async () => jsonResponse(data) })
  assert.equal((await client.stations()).stations[0].prices.diesel, null)
  data.stations = []
  data.count = 0
  assert.deepEqual((await client.stations()).stations, [])
})

test('requests can be aborted and timeout explicitly', async () => {
  let calls = 0
  const fetchImpl = async (_, { signal }) => {
    calls++
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  }
  const before = new AbortController()
  before.abort()
  await assert.rejects(createApiClient({ baseUrl, fetchImpl }).stations({ signal: before.signal }), { name: 'AbortError' })
  assert.equal(calls, 0)
  await assert.rejects(createApiClient({ baseUrl, fetchImpl, timeoutMs: 15 }).stations(), { code: 'TIMEOUT' })
  const active = new AbortController()
  const pending = createApiClient({ baseUrl, fetchImpl }).stations({ signal: active.signal })
  active.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('unknown fuel is rejected before any request', async () => {
  const client = createApiClient({ baseUrl, fetchImpl: async () => { throw new Error('Must not fetch') } })
  await assert.rejects(client.prices({ fuel: 'superior' }), { code: 'INVALID_FUEL' })
})
