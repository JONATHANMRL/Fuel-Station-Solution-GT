const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

async function boot({ packaged = false, firstInstance = true, invalid = false } = {}) {
  const calls = { events: {}, quit: 0 }
  const folder = packaged ? path.join('installation', 'resources', 'app.asar', 'desktop') : path.resolve('desktop')
  const app = {
    isPackaged: packaged,
    setName(value) { calls.name = value },
    getPath(key) { return calls[key] || path.resolve('test-app-data') },
    setPath(key, value) { calls[key] = value },
    enableSandbox() { calls.sandbox = true },
    requestSingleInstanceLock() { return firstInstance },
    quit() { calls.quit++ },
    on(name, callback) { calls.events[name] = callback },
    whenReady() { return Promise.resolve() },
    setAppUserModelId(value) { calls.appId = value },
  }
  const electron = { app, Menu: { setApplicationMenu() {} }, dialog: { showErrorBox() { calls.error = true } } }
  vm.runInNewContext(fs.readFileSync(path.resolve('desktop/main.cjs'), 'utf8'), {
    __dirname: folder,
    require(id) {
      if (id === 'electron') return electron
      if (id === 'node:path') return path
      if (id === './windows-notifications.cjs') return { configureWindowsNotifications() { calls.nativeNotifications = true } }
      if (id === './client-config.cjs') return { loadClientConfig(userData, defaults) {
        calls.defaults = defaults
        assert.equal(userData, calls.userData)
        if (invalid) throw new Error('Invalid configuration')
        return { origin: 'https://api.example.invalid' }
      } }
      if (id === './window.cjs') return { async createDesktopWindow(_modules, config, options) {
        calls.window = { config, options }
        return { win: {} }
      } }
      throw new Error(`Unexpected import: ${id}`)
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  return { calls, folder }
}

test('real main entry locates local build from script and ASAR, separates profiles and enables sandbox', async () => {
  for (const packaged of [false, true]) {
    const { calls, folder } = await boot({ packaged })
    assert.equal(calls.name, 'GasolinaGT')
    assert.equal(calls.sandbox, true)
    assert.equal(calls.appId, 'gt.gasolinagt.desktop')
    assert.equal(calls.nativeNotifications, true)
    assert.equal(calls.userData, path.resolve('test-app-data', packaged ? 'GasolinaGT' : 'GasolinaGT-Development'))
    assert.equal(calls.defaults, path.join(folder, 'default-client.json'))
    assert.equal(calls.window.options.distDir, path.join(folder, '..', 'dist-desktop'))
    calls.events['window-all-closed']()
    assert.equal(calls.quit, 1)
  }
})

test('a second application instance exits without opening a second session/window', async () => {
  const { calls } = await boot({ firstInstance: false })
  assert.equal(calls.quit, 1)
  assert.equal(calls.window, undefined)
})

test('invalid client configuration stops startup instead of loading a fallback origin', async () => {
  const { calls } = await boot({ invalid: true })
  assert.equal(calls.error, true)
  assert.equal(calls.quit, 1)
  assert.equal(calls.window, undefined)
})
