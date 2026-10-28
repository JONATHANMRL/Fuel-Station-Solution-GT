import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { apiClient, createApiClient } from '../src/services/apiClient.js'
import { getPublicPriceAlerts } from '../src/services/publicPriceAlertsService.js'
import { createPublicPriceAlertsLoader } from '../src/services/publicPriceAlertsLoader.js'
import { jsonResponse } from './fixtures/oracleApi.mjs'

const row = (priceId = '8', changes = {}) => ({ id: `public-price:${priceId}`, priceId, source: 'oracle',
  stationId: '1', stationName: 'Station fixture', brand: 'Shell', fuel: 'regular', previousPrice: 30.55,
  newPrice: 30.53, difference: -0.02, type: 'down', createdAt: '2026-10-27T12:00:00.000001-06:00', context: 'unclassified', ...changes })
const page = (alerts = [row()], nextCursor = null, activatedAt = null) => ({ source: 'oracle', alerts,
  count: alerts.length, limit: 25, fetchedAt: '2026-10-27T18:01:00Z', nextCursor, activatedAt })
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { promise, resolve } }

test('public HTTP uses GET without cookies, credentials, session, CSRF marker or write capability', async (context) => {
  const calls = []
  const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return jsonResponse(page())
  } })
  context.mock.method(apiClient, 'publicPriceAlerts', client.publicPriceAlerts)
  assert.equal((await getPublicPriceAlerts()).alerts[0].difference, -0.02)
  await client.publicPriceAlerts({ cursor: 'abc_123-DEF', limit: 10 })
  for (const { url, options } of calls) {
    assert.ok(url.includes('/public/price-alerts?'))
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.body, undefined)
    assert.deepEqual(options.headers, { Accept: 'application/json' })
  }
  assert.ok(calls[1].url.includes('limit=10&cursor=abc_123-DEF'))
  await assert.rejects(client.publicPriceAlerts({ limit: 101 }), { code: 'INVALID_PUBLIC_PAGE' })
  await assert.rejects(client.publicPriceAlerts({ cursor: 'bad&path=admin' }), { code: 'INVALID_PUBLIC_PAGE' })
})

test('public contract accepts both signs and explicit activation, keeping personal ID namespace separate', async (context) => {
  for (const alert of [row(), row('9', { previousPrice: 31.5, newPrice: 31.75, difference: 0.25, type: 'up' })]) {
    context.mock.method(apiClient, 'publicPriceAlerts', async () => page([alert]))
    const result = await getPublicPriceAlerts()
    assert.equal(result.alerts[0].id.startsWith('public-price:'), true)
    assert.equal(Object.hasOwn(result.alerts[0], 'read'), false)
  }
  context.mock.method(apiClient, 'publicPriceAlerts', async () => page([row('9', { context: 'after_activation' })], null, '2026-10-27T18:00:00Z'))
  assert.equal((await getPublicPriceAlerts()).alerts[0].context, 'after_activation')
})

test('invalid/equal/first-price, conflicting signs, duplicate IDs and invented provenance cannot be displayed', async (context) => {
  const badPages = [
    page([null]), page([row(), row()]), page([row('8', { newPrice: 30.55, difference: 0 })]),
    page([row('8', { previousPrice: null })]), page([row('8', { type: 'up' })]),
    page([row('8', { difference: 0.02 })]), page([row('8', { id: '8' })]),
    page([row('8', { source: 'local' })]), page([row('8', { context: 'after_activation' })]),
    page([row('8', { createdAt: 'not-a-date' })]), page([row('8', { newPrice: 0 })]),
    page([row('8', { context: 'verified' })]),
  ]
  for (const bad of badPages) {
    context.mock.method(apiClient, 'publicPriceAlerts', async () => bad)
    await assert.rejects(getPublicPriceAlerts(), { code: 'INVALID_RESPONSE' })
  }
})

function harness(fetch) {
  const states = [], timers = []
  const loader = createPublicPriceAlertsLoader(fetch, (state) => states.push(state), {
    schedule: (callback, delay) => { timers.push({ callback, delay }); return timers.length }, unschedule: () => {},
  })
  return { loader, states, timers }
}

test('polling and focus/manual refresh join pending requests; no simultaneous or redundant follow-up calls', async () => {
  const first = deferred()
  let calls = 0
  const { loader, states, timers } = harness(async () => { calls++; return calls === 1 ? first.promise : page([row('9'), row()]) })
  const pending = loader.start()
  const focus = loader.refresh()
  const manual = loader.refresh()
  assert.equal(calls, 1)
  first.resolve(page())
  await Promise.all([pending, focus, manual])
  assert.equal(calls, 1)
  assert.equal(timers.at(-1).delay, 30000)
  await timers.at(-1).callback()
  assert.equal(calls, 2)
  assert.equal(states.at(-1).alerts[0].priceId, '9')
})

test('keyset pagination deduplicates IDs, retains microsecond order and refreshes the newest page', async () => {
  let latest = false
  const cursors = []
  const { loader, states } = harness(async ({ cursor }) => {
    cursors.push(cursor)
    if (cursor) return page([row('10'), row('8')])
    return latest ? page([row('11')]) : page([row('9', { createdAt: '2026-10-27T12:00:00.000999-06:00' }), row('10')], 'next_page')
  })
  await loader.start()
  await loader.more()
  assert.deepEqual(states.at(-1).alerts.map((alert) => alert.priceId), ['9', '10', '8'])
  assert.deepEqual(cursors, [undefined, 'next_page'])
  latest = true
  await loader.refresh()
  assert.deepEqual(states.at(-1).alerts.map((alert) => alert.priceId), ['11'])
  assert.equal(states.at(-1).nextCursor, null)
})

test('StrictMode cleanup, obsolete responses and queued timers cannot republish old pages', async () => {
  const first = deferred()
  let calls = 0, initialSignal
  const { loader, states, timers } = harness(async ({ signal }) => {
    if (++calls === 1) { initialSignal = signal; return first.promise }
    return page([row('9')])
  })
  const initial = loader.start()
  loader.cancel()
  assert.equal(initialSignal.aborted, true)
  await loader.start()
  first.resolve(page())
  await initial
  assert.equal(states.at(-1).alerts[0].priceId, '9')
  const count = states.length
  loader.cancel()
  await timers.at(-1).callback()
  assert.equal(states.length, count)
  assert.equal(calls, 2)
})

test('HTTP failures are safe and polling recovers without any local/demo or personal fallback', async (context) => {
  let offline = true
  const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async () =>
    offline ? jsonResponse({ detail: 'PRIVATE DSN PASSWORD' }, 503) : jsonResponse(page()) })
  context.mock.method(apiClient, 'publicPriceAlerts', client.publicPriceAlerts)
  const { loader, states, timers } = harness(getPublicPriceAlerts)
  await loader.start()
  assert.deepEqual(states.at(-1).alerts, [])
  assert.match(states.at(-1).error, /Oracle/)
  assert.doesNotMatch(states.at(-1).error, /PRIVATE/)
  offline = false
  await timers.at(-1).callback()
  assert.equal(states.at(-1).error, '')
  assert.equal(states.at(-1).alerts[0].source, 'oracle')
})

test('empty history is a successful empty state; public section stays independent from personal controls', async () => {
  const { loader, states } = harness(async () => page([]))
  await loader.start()
  assert.deepEqual(states.at(-1).alerts, [])
  assert.equal(states.at(-1).error, '')
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const publicComponent = readFileSync(new URL('../src/components/PublicPriceAlerts.jsx', import.meta.url), 'utf8')
  assert.ok(app.includes("<PublicPriceAlerts active={activeSection === 'notificaciones'} />"))
  assert.ok(app.includes('Mis notificaciones'))
  assert.ok(publicComponent.includes('Avisos generales'))
  assert.ok(!publicComponent.includes('AdminAccessGate'))
  assert.ok(!publicComponent.includes('requestPermission'))
  assert.ok(!publicComponent.includes('markOracleNotificationRead'))
})
