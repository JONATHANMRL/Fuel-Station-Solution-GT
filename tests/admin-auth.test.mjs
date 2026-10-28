import assert from 'node:assert/strict'
import test from 'node:test'
import { apiClient, ApiError, createApiClient } from '../src/services/apiClient.js'
import { getAdminSession, signInAdmin, signOutAdmin } from '../src/services/adminAuthService.js'
import { createAdminSessionController } from '../src/services/adminSessionController.js'
import { jsonResponse } from './fixtures/oracleApi.mjs'

const profile = () => ({ authenticated: true, user: { id: '42', email: 'admin@example.invalid', role: 'admin' },
  expiresAt: '2099-01-01T00:00:00Z' })

test('auth HTTP uses HTTPS, cookies and CSRF marker, without exposing a session token to React', async () => {
  const calls = []
  const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return url.endsWith('/logout') ? new Response(null, { status: 204 }) : jsonResponse(profile())
  } })
  assert.equal((await client.signIn({ email: 'admin@example.invalid', password: 'SIMULATED-PASSWORD' })).user.id, '42')
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(calls[0].options.headers['X-Admin-Request'], '1')
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'admin@example.invalid', password: 'SIMULATED-PASSWORD' })
  assert.ok(!('Authorization' in calls[0].options.headers))
  await client.adminSession()
  assert.equal(calls[1].options.method, 'GET')
  await client.signOut()
  assert.equal(calls[2].options.method, 'POST')
  assert.equal(calls[2].options.credentials, 'include')
  await assert.rejects(createApiClient({ baseUrl: 'http://api.test.invalid' }).adminSession(), { code: 'HTTPS_REQUIRED' })
})

test('wrong login, expired session and unavailable auth remain distinct', async () => {
  for (const status of [401, 403, 429, 503]) {
    const client = createApiClient({ baseUrl: 'https://api.test.invalid', fetchImpl: async () => jsonResponse({ secret: 'backend-private' }, status) })
    await assert.rejects(client.signIn({ email: 'admin@example.invalid', password: 'wrong' }), (error) =>
      error.code === `HTTP_${status}` && !error.message.includes('backend-private'))
  }
})

test('login verifies cookie round-trip and never trusts the login body alone', async (context) => {
  const calls = []
  context.mock.method(apiClient, 'signIn', async (body) => { calls.push(body); return profile() })
  context.mock.method(apiClient, 'adminSession', async () => profile())
  assert.equal((await signInAdmin({ username: ' admin@example.invalid ', password: 'transient' })).user.id, '42')
  assert.deepEqual(calls[0], { email: 'admin@example.invalid', password: 'transient' })
  context.mock.method(apiClient, 'adminSession', async () => { throw new ApiError('HTTP_401', 'expired') })
  await assert.rejects(signInAdmin({ username: 'admin@example.invalid', password: 'transient' }), { code: 'SESSION_COOKIE_UNAVAILABLE' })
})

test('session 401/403 becomes signed out, but server failures are not silently accepted', async (context) => {
  for (const code of ['HTTP_401', 'HTTP_403']) {
    context.mock.method(apiClient, 'adminSession', async () => { throw new ApiError(code, 'denied') })
    assert.equal(await getAdminSession(), null)
  }
  context.mock.method(apiClient, 'adminSession', async () => { throw new ApiError('HTTP_503', 'unavailable') })
  await assert.rejects(getAdminSession(), { code: 'HTTP_503' })
  context.mock.method(apiClient, 'signOut', async () => { throw new ApiError('NETWORK_ERROR', 'offline') })
  await assert.rejects(signOutAdmin(), { code: 'NETWORK_ERROR' })
})

function controllerHarness(service) {
  const states = [], timers = []
  const controller = createAdminSessionController(service, (state) => states.push(state), {
    schedule: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    unschedule: () => {},
  })
  return { controller, states, timers }
}

test('controller supports login, expiry and confirmed logout without localStorage', async () => {
  const service = { getAdminSession: async () => null, signInAdmin: async () => profile(), signOutAdmin: async () => {} }
  const { controller, states, timers } = controllerHarness(service)
  await controller.check()
  assert.equal(states.at(-1).session, null)
  await controller.signIn({ username: 'admin@example.invalid', password: 'transient' })
  assert.equal(states.at(-1).session.user.id, '42')
  assert.equal(timers.at(-1).delay, 30000)
  await timers.at(-1).callback()
  assert.equal(states.at(-1).session, null)
  assert.match(states.at(-1).error, /vencido/)
  await controller.signIn({})
  await controller.signOut()
  assert.equal(states.at(-1).session, null)
})

test('failed logout does not falsely claim that the server session was revoked', async () => {
  const { controller, states } = controllerHarness({ getAdminSession: async () => profile(),
    signOutAdmin: async () => { throw new Error('No se pudo cerrar sesión') } })
  await controller.check()
  await controller.signOut()
  assert.equal(states.at(-1).session.user.id, '42')
  assert.match(states.at(-1).error, /cerrar sesión/)
})

test('stale session checks cannot reopen the panel after logout or cleanup', async () => {
  let complete
  const { controller, states } = controllerHarness({ getAdminSession: () => new Promise((resolve) => { complete = resolve }),
    signOutAdmin: async () => {} })
  const check = controller.check()
  await controller.signOut()
  complete(profile())
  await check
  assert.equal(states.at(-1).session, null)
  const late = controller.check()
  const count = states.length
  controller.cancel()
  complete(profile())
  await late
  assert.equal(states.length, count)
})
