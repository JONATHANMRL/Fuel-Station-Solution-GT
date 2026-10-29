const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installNotificationPermissions } = require('../notification-permissions.cjs')
const config = { origin: 'https://api.example.invalid' }
const url = `${config.origin}/__gasolinagt_desktop__/index.html#notificaciones`
const contents = { getURL: () => url, isDestroyed: () => false }
const details = { isMainFrame: true, requestingUrl: url }

function setup(options = {}) {
  let request, check, prompts = 0
  installNotificationPermissions({ setPermissionRequestHandler(fn) { request = fn }, setPermissionCheckHandler(fn) { check = fn } }, {
    config, BrowserWindow: { fromWebContents: () => ({}) },
    dialog: { async showMessageBox() { prompts++; return { response: options.response ?? 0 } } },
    Notification: { isSupported: () => options.supported !== false }, ...options,
  })
  return { check: (...args) => check(...args), prompts: () => prompts,
    request: (permission = 'notifications', source = contents, frame = details) => new Promise((resolve) => request(source, permission, resolve, frame)) }
}

test('notification permission requires explicit consent; all other permissions and origins remain denied', async () => {
  const policy = setup()
  assert.equal(policy.check(contents, 'notifications', config.origin, details), false)
  for (const permission of ['media', 'geolocation', 'display-capture', 'clipboard-read', 'usb', 'unknown']) {
    assert.equal(await policy.request(permission), false)
    assert.equal(policy.check(contents, permission, config.origin, details), false)
  }
  assert.equal(await policy.request('notifications', contents, { ...details, isMainFrame: false }), false)
  assert.equal(await policy.request('notifications', { ...contents, getURL: () => 'https://evil.invalid' }), false)
  assert.equal(await policy.request('notifications', contents, { ...details, requestingUrl: `${config.origin}/auth/login` }), false)
  assert.equal(policy.prompts(), 0)
  assert.equal(await policy.request(), true)
  assert.equal(policy.prompts(), 1)
  assert.equal(policy.check(contents, 'notifications', config.origin, details), true)
  assert.equal(policy.check(contents, 'notifications', config.origin + '/', details), true)
  assert.equal(policy.check(null, 'notifications', config.origin, {}), true)
  assert.equal(policy.check(null, 'notifications', 'https://evil.invalid', {}), false)
  assert.equal(await policy.request(), true)
  assert.equal(policy.prompts(), 1)
})

test('denied, unsupported or failed permission requests never grant notifications', async () => {
  assert.equal(await setup({ response: 1 }).request(), false)
  const unsupported = setup({ supported: false })
  assert.equal(await unsupported.request(), false)
  assert.equal(unsupported.prompts(), 0)
  assert.equal(await setup({ dialog: { showMessageBox() { throw new Error('Unavailable') } } }).request(), false)
})

test('consent persists only for the exact configured origin and invalid files fail closed', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gasolinagt-notifications-'))
  const consentFile = path.join(folder, 'consent.json')
  try {
    assert.equal(await setup({ consentFile }).request(), true)
    const restored = setup({ consentFile })
    assert.equal(restored.check(null, 'notifications', config.origin), true)
    assert.equal(await restored.request(), true)
    assert.equal(restored.prompts(), 0)
    assert.equal(setup({ consentFile, config: { origin: 'https://new.invalid' } }).check(null, 'notifications', 'https://new.invalid'), false)
    fs.writeFileSync(consentFile, '{invalid')
    assert.equal(setup({ consentFile }).check(null, 'notifications', config.origin), false)
  } finally { fs.rmSync(folder, { recursive: true }) }
})
