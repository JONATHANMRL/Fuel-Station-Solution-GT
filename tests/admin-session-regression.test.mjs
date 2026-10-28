import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminSessionController } from '../src/services/adminSessionController.js'
import { apiClient, createApiClient } from '../src/services/apiClient.js'
import * as authService from '../src/services/adminAuthService.js'
import { jsonResponse } from './fixtures/oracleApi.mjs'

const valid = () => ({ authenticated: true, user: { id: '22', email: 'admin@example.invalid', role: 'admin' },
  expiresAt: '2026-10-22T10:30:00+00:00' })

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness(service) {
  const states = [], timers = []
  const controller = createAdminSessionController(service, (state) => states.push(state), {
    schedule: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    // Deliberately do not remove callbacks: stale callbacks must guard themselves.
    unschedule: () => {},
  })
  return { controller, states, timers }
}

test('a server-confirmed session is accepted even when the Windows clock is ahead', async (context) => {
  context.mock.method(Date, 'now', () => Date.parse('2026-10-23T10:00:00Z'))
  const { controller, states } = harness({ signInAdmin: async () => valid() })
  await controller.signIn({ username: 'admin@example.invalid', password: 'SIMULATED' })
  assert.equal(states.at(-1).session?.user.id, '22')
  assert.equal(states.at(-1).error, '')
})

test('a focus check during login cannot cancel or supersede its session confirmation', async () => {
  const login = deferred()
  let checks = 0
  const { controller, states } = harness({ signInAdmin: () => login.promise,
    getAdminSession: async () => { checks++; return null } })
  const pending = controller.signIn({})
  const focus = controller.check()
  login.resolve(valid())
  await Promise.all([pending, focus])
  assert.equal(checks, 0)
  assert.equal(states.at(-1).session?.user.id, '22')
})

test('an expiry callback from an older session cannot cancel a successful new login', async () => {
  const login = deferred()
  const { controller, states, timers } = harness({ getAdminSession: async () => valid(), signInAdmin: () => login.promise })
  await controller.check()
  const previousTimer = timers.at(-1).callback
  const pending = controller.signIn({})
  previousTimer()
  login.resolve(valid())
  await pending
  assert.equal(states.at(-1).session?.user.id, '22')
  assert.equal(states.at(-1).error, '')
})

test('late SESSION_INVALID from the initial check cannot discard a newer login', async () => {
  const initial = deferred()
  const { controller, states } = harness({ getAdminSession: () => initial.promise, signInAdmin: async () => valid() })
  const pending = controller.check()
  await controller.signIn({})
  initial.reject(Object.assign(new Error('SESSION_INVALID'), { code: 'HTTP_401' }))
  await pending
  assert.equal(states.at(-1).session.user.id, '22')
  assert.equal(states.at(-1).error, '')
})

test('Comprobar sesión recovers from an earlier error with a confirmed session', async () => {
  let fail = true
  const { controller, states } = harness({ getAdminSession: async () => {
    if (fail) throw new Error('SESSION_INVALID anterior')
    return valid()
  } })
  await controller.check()
  assert.equal(states.at(-1).session, null)
  fail = false
  await controller.check()
  assert.equal(states.at(-1).session.user.id, '22')
  assert.equal(states.at(-1).busy, false)
  assert.equal(states.at(-1).error, '')
})

test('timer checks with FastAPI; only confirmed loss of the session returns to login', async (context) => {
  context.mock.method(Date, 'now', () => Date.parse('2027-10-22T10:00:00Z'))
  let authenticated = true
  const { controller, states, timers } = harness({ getAdminSession: async () => authenticated ? valid() : null })
  await controller.check()
  await timers.at(-1).callback()
  assert.equal(states.at(-1).session.user.id, '22')
  assert.equal(states.at(-1).error, '')
  authenticated = false
  await timers.at(-1).callback()
  assert.equal(states.at(-1).session, null)
  assert.match(states.at(-1).error, /vencido o ya no está disponible/)
})

test('queued timer and focus cannot reopen the panel during or after logout', async () => {
  const logout = deferred()
  let checks = 0
  const { controller, states, timers } = harness({ getAdminSession: async () => { checks++; return valid() },
    signOutAdmin: () => logout.promise })
  await controller.check()
  const timer = timers.at(-1).callback
  const pending = controller.signOut()
  const focus = controller.check()
  await timer()
  logout.resolve()
  await Promise.all([pending, focus])
  await timer()
  assert.equal(checks, 1)
  assert.equal(states.at(-1).session, null)
  assert.equal(states.at(-1).error, '')
})

test('StrictMode setup-cleanup-setup ignores the disposed request and timer', async () => {
  const first = deferred()
  let calls = 0, firstSignal
  const { controller, states, timers } = harness({ getAdminSession: ({ signal }) => {
    if (++calls === 1) { firstSignal = signal; return first.promise }
    return Promise.resolve(valid())
  } })
  const old = controller.check()
  controller.cancel()
  assert.equal(firstSignal.aborted, true)
  await controller.check()
  first.resolve(null)
  await old
  assert.equal(states.at(-1).session.user.id, '22')
  const timer = timers.at(-1).callback
  const count = states.length
  controller.cancel()
  await timer()
  assert.equal(states.length, count)
})

test('network failure closes the panel without claiming that the session expired', async () => {
  let offline = false
  const { controller, states, timers } = harness({ getAdminSession: async () => {
    if (offline) throw new Error('No fue posible acceder a FastAPI.')
    return valid()
  } })
  await controller.check()
  offline = true
  await timers.at(-1).callback()
  assert.equal(states.at(-1).session, null)
  assert.match(states.at(-1).error, /FastAPI/)
  assert.doesNotMatch(states.at(-1).error, /vencido/)
  offline = false
  await controller.check()
  assert.equal(states.at(-1).session.user.id, '22')
  assert.equal(states.at(-1).error, '')
})

test('HTTP login 200 + cookie confirmation 200 reaches authenticated UI state, then real 401 and logout', async (context) => {
  context.mock.method(Date, 'now', () => Date.parse('2027-10-22T10:00:00Z'))
  const calls = []
  let authenticated = false
  const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/login')) { authenticated = true; return jsonResponse(valid()) }
    if (url.endsWith('/logout')) { authenticated = false; return new Response(null, { status: 204 }) }
    return authenticated ? jsonResponse(valid()) : jsonResponse({ detail: { code: 'SESSION_INVALID' } }, 401)
  } })
  for (const method of ['signIn', 'adminSession', 'signOut']) context.mock.method(apiClient, method, client[method])
  const { controller, states, timers } = harness(authService)
  await controller.check()
  assert.equal(states.at(-1).session, null)
  await controller.signIn({ username: 'admin@example.invalid', password: 'SIMULATED' })
  assert.equal(states.at(-1).session.user.id, '22')
  assert.equal(states.at(-1).error, '')
  assert.ok(calls.at(-2).url.endsWith('/login'))
  assert.ok(calls.at(-1).url.endsWith('/session'))
  authenticated = false // The server expires/revokes the session.
  await timers.at(-1).callback()
  assert.equal(states.at(-1).session, null)
  assert.match(states.at(-1).error, /vencido/)
  await controller.signIn({ username: 'admin@example.invalid', password: 'SIMULATED' })
  await controller.signOut()
  assert.equal(states.at(-1).session, null)
  assert.equal(states.at(-1).error, '')
  assert.ok(calls.every(({ options }) => options.credentials === 'include'))
})

test('the real auth contract accepts Oracle IDs and UTC offsets without trusting invalid permissions', async () => {
  const response = valid()
  const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async () => jsonResponse(response) })
  response.user.id = 22
  assert.deepEqual((await client.adminSession()).user, { id: '22', email: 'admin@example.invalid', role: 'admin' })
  response.expiresAt = '2026-10-22T04:30:00-06:00'
  assert.equal((await client.adminSession()).authenticated, true)
  for (const invalid of [
    { ...valid(), authenticated: false },
    { ...valid(), user: { ...valid().user, role: 'user' } },
    { ...valid(), user: { ...valid().user, email: undefined } },
    { ...valid(), expiresAt: 'not-a-date' },
  ]) {
    const broken = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async () => jsonResponse(invalid) })
    await assert.rejects(broken.adminSession(), (error) => error.code === 'INVALID_RESPONSE' &&
      error.message.includes('autenticación') && !error.message.includes('vencido'))
  }
})
