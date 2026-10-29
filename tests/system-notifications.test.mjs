import test from 'node:test'
import assert from 'node:assert/strict'
import { createSystemNotifier } from '../src/services/systemNotifications.js'

const row = (id) => ({ id, stationName: 'Estación de prueba', fuel: 'regular', type: 'down', newPrice: 30.25 })
function setup(permission = 'granted') {
  const notices = []
  class API {
    static permission = permission
    static async requestPermission() { return this.permission }
    constructor(title, options) { notices.push({ title, ...options }); this.close = () => {} }
  }
  return { API, notices, notifier: createSystemNotifier({ getAPI: () => API }) }
}

test('activation requests permission and sends a test toast only after permission is granted', async () => {
  for (const permission of ['granted', 'denied', 'default']) {
    const { notifier, notices } = setup(permission)
    assert.equal(await notifier.activate(), permission)
    assert.equal(notices.length, permission === 'granted' ? 1 : 0)
  }
  await assert.rejects(createSystemNotifier({ getAPI: () => undefined }).activate(), /no admite/)
})

test('initial history is silent; new changes emit one bounded toast and repeated snapshots do not repeat it', () => {
  const { notifier, notices } = setup()
  notifier.observe([row('1')])
  assert.equal(notices.length, 0)
  notifier.observe([row('3'), row('2'), row('1')])
  assert.equal(notices.length, 1)
  assert.match(notices[0].body, /Q30.25/)
  assert.match(notices[0].body, /2 cambios nuevos/)
  notifier.observe([row('3'), row('2'), row('1')])
  assert.equal(notices.length, 1)
})

test('denied permissions and native delivery errors do not interrupt in-app data', async () => {
  const { notifier, notices, API } = setup('denied')
  notifier.observe([])
  notifier.observe([row('1')])
  assert.equal(notices.length, 0)
  API.permission = 'granted'
  await notifier.activate()
  notifier.observe([row('1')])
  assert.equal(notices.length, 1) // Only the explicit activation test; no old events replayed.
  const broken = createSystemNotifier({ getAPI: () => class {
    static permission = 'granted'
    static async requestPermission() { return 'granted' }
    constructor() { throw new Error('OS unavailable') }
  } })
  let errors = 0
  await assert.rejects(broken.activate(() => errors++), /notificación de prueba/)
  assert.equal(errors, 1)
  assert.doesNotThrow(() => { broken.observe([]); broken.observe([row('2')]) })
})
