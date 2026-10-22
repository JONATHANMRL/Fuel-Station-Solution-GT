import assert from 'node:assert/strict'
import test from 'node:test'
import { createStationLoader } from '../src/services/stationLoader.js'
import { stationsResponse } from './fixtures/oracleApi.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('initial asynchronous load moves loading to ready with Oracle metadata', async () => {
  const states = []
  const loader = createStationLoader(async () => stationsResponse(), (state) => states.push(state))
  await loader.refresh()
  assert.equal(states[0].status, 'loading')
  assert.deepEqual(states[0].stations, [])
  assert.equal(states[1].status, 'ready')
  assert.equal(states[1].stations.length, 25)
  assert.equal(states[1].fetchedAt, stationsResponse().fetchedAt)
})

test('failed refresh clears old prices and a retry recovers', async () => {
  const states = []
  let fail = false
  const loader = createStationLoader(async () => {
    if (fail) throw new Error('Oracle no disponible')
    return stationsResponse()
  }, (state) => states.push(state))
  await loader.refresh()
  fail = true
  await loader.refresh()
  assert.equal(states.at(-1).status, 'error')
  assert.equal(states.at(-1).error, 'Oracle no disponible')
  assert.deepEqual(states.at(-1).stations, [])
  assert.equal(states.at(-1).fetchedAt, null)
  fail = false
  await loader.refresh()
  assert.equal(states.at(-1).stations.length, 25)
})

test('older response cannot overwrite newer data even if abort is ignored', async () => {
  const first = deferred(), second = deferred(), states = [], signals = []
  const loader = createStationLoader(({ signal }) => {
    signals.push(signal)
    return signals.length === 1 ? first.promise : second.promise
  }, (state) => states.push(state))
  const one = loader.refresh(), two = loader.refresh()
  assert.equal(signals[0].aborted, true)
  second.resolve(stationsResponse())
  await two
  first.resolve({ stations: [], fetchedAt: 'old' })
  await one
  assert.equal(states.at(-1).stations.length, 25)
})

test('late error after a successful retry cannot clear the new results', async () => {
  const first = deferred(), states = []
  let calls = 0
  const loader = createStationLoader(() => ++calls === 1 ? first.promise : Promise.resolve(stationsResponse()), (state) => states.push(state))
  const pending = loader.refresh()
  await loader.refresh()
  first.reject(new Error('late failure'))
  await pending
  assert.equal(states.at(-1).status, 'ready')
})

test('cleanup prevents updates and supports StrictMode cleanup/restart', async () => {
  const first = deferred(), states = []
  let calls = 0
  const loader = createStationLoader(() => ++calls === 1 ? first.promise : Promise.resolve(stationsResponse()), (state) => states.push(state))
  const pending = loader.refresh()
  loader.cancel()
  first.resolve(stationsResponse())
  await pending
  assert.equal(states.length, 1)
  await loader.refresh()
  assert.equal(states.at(-1).status, 'ready')
})
