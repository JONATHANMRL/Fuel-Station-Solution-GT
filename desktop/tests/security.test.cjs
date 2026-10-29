const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { validateConfig, loadClientConfig } = require('../client-config.cjs')
const { INDEX_PATH, apiAllowed, networkAllowed, navigationAllowed, contentSecurityPolicy } = require('../security.cjs')
const { createGateway } = require('../gateway.cjs')
const config = validateConfig({ apiBaseUrl: 'https://api.example.invalid' })

test('runtime configuration accepts HTTPS origins only and never silently replaces invalid configuration', () => {
  for (const apiBaseUrl of ['http://api.invalid', 'file:///tmp/test', 'https://u:p@api.invalid', 'https://api.invalid/path', 'https://api.invalid?x=1']) {
    assert.throws(() => validateConfig({ apiBaseUrl }))
  }
  assert.throws(() => validateConfig({ apiBaseUrl: config.origin, password: 'FORBIDDEN' }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gasolinagt-config-'))
  try {
    const defaults = path.join(dir, 'defaults.json'), user = path.join(dir, 'user')
    fs.writeFileSync(defaults, JSON.stringify({ apiBaseUrl: config.origin }))
    assert.equal(loadClientConfig(user, defaults).origin, config.origin)
    fs.writeFileSync(path.join(user, 'client-config.json'), '{invalid')
    assert.throws(() => loadClientConfig(user, defaults))
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('navigation and network allow only packaged application, API operations and known HTTPS tiles', () => {
  assert.ok(navigationAllowed(`${config.origin}${INDEX_PATH}#admin`, config))
  for (const value of ['file:///C:/secret', 'https://evil.invalid', `${config.origin}/admin/prices`, 'javascript:alert(1)']) {
    assert.equal(navigationAllowed(value, config), false)
  }
  assert.ok(apiAllowed(new URL(`${config.origin}/auth/login`), 'POST', config))
  assert.ok(apiAllowed(new URL(`${config.origin}/notifications/22/read`), 'POST', config))
  assert.equal(apiAllowed(new URL(`${config.origin}/admin/prices`), 'DELETE', config), false)
  assert.equal(networkAllowed('https://evil.invalid/stations', 'GET', config), false)
  assert.equal(networkAllowed('http://a.tile.openstreetmap.org/1/1/1.png', 'GET', config), false)
  assert.ok(networkAllowed('https://a.tile.openstreetmap.org/13/1/1.png', 'GET', config))
  assert.ok(contentSecurityPolicy(config).includes("script-src 'self'"))
  assert.ok(contentSecurityPolicy(config).includes("worker-src 'none'"))
})

test('gateway serves local files, blocks traversal and does not expose secrets through runtime config', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gasolinagt-assets-'))
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<title>PACKAGED</title>')
    let forwarded = 0
    const gateway = createGateway({ config, distDir: dir, fetchRemote: async () => { forwarded++; return new Response('{}') } })
    const html = await gateway(new Request(`${config.origin}${INDEX_PATH}`))
    assert.match(await html.text(), /PACKAGED/)
    assert.ok(html.headers.has('Content-Security-Policy'))
    const runtime = await gateway(new Request(`${config.origin}/__gasolinagt_desktop__/runtime-config.js`))
    assert.match(await runtime.text(), /apiBaseUrl/)
    for (const suffix of ['%2e%2e%2fsecret.html', '%5csecret.html', 'index.html%00', 'main.cjs', 'missing.html']) {
      assert.ok((await gateway(new Request(`${config.origin}/__gasolinagt_desktop__/${suffix}`))).status >= 400)
    }
    assert.equal(forwarded, 0)
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('gateway preserves request cookies/CSRF/origin, rejects foreign/missing origin and sanitizes network errors', async () => {
  let received
  const gateway = createGateway({ config, distDir: '.', fetchRemote: async (request) => { received = request; return new Response('{}') } })
  const body = JSON.stringify({ email: 'admin@example.invalid', password: 'SIMULATED' })
  const request = new Request(`${config.origin}/auth/login`, { method: 'POST', body,
    headers: { Origin: config.origin, 'X-Admin-Request': '1', Cookie: 'SIMULATED_COOKIE' } })
  assert.equal((await gateway(request)).status, 200)
  assert.equal(received, request)
  assert.equal(await received.text(), body)
  for (const origin of [undefined, 'https://other.invalid', 'null']) {
    assert.equal((await gateway(new Request(`${config.origin}/auth/login`, { method: 'POST', body,
      headers: { ...(origin ? { Origin: origin } : {}), 'X-Admin-Request': '1' } }))).status, 403)
  }
  const browserRequest = new Request(`${config.origin}/auth/logout`, { method: 'POST', body: '{}',
    headers: { 'X-Admin-Request': '1' } })
  Object.defineProperty(browserRequest, 'initiatorOrigin', { value: config.origin })
  assert.equal((await gateway(browserRequest)).status, 200)
  assert.equal(received.headers.get('Origin'), config.origin)
  const foreign = new Request(`${config.origin}/auth/logout`, { method: 'POST', body: '{}',
    headers: { Origin: config.origin, 'X-Admin-Request': '1' } })
  Object.defineProperty(foreign, 'initiatorOrigin', { value: 'https://evil.invalid' })
  assert.equal((await gateway(foreign)).status, 403)
  const offline = createGateway({ config, distDir: '.', fetchRemote: () => { throw new Error('PRIVATE TLS INFORMATION') } })
  const result = await offline(new Request(`${config.origin}/stations`))
  assert.equal(result.status, 503)
  assert.ok(!(await result.text()).includes('PRIVATE'))
})

test('packaging uses an allowlist, NSIS x64, no publication and no backend runtime', () => {
  const build = require('../builder.cjs')
  assert.deepEqual(build.win.target[0], { target: 'nsis', arch: ['x64'] })
  assert.equal(build.publish, null)
  assert.equal(build.nsis.perMachine, false)
  assert.equal(build.nsis.createDesktopShortcut, true)
  assert.equal(build.nsis.createStartMenuShortcut, true)
  assert.equal(build.extraMetadata.dependencies, null)
  const main = fs.readFileSync(path.join(__dirname, '..', 'window.cjs'), 'utf8')
  for (const setting of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true', 'backgroundThrottling: false']) assert.ok(main.includes(setting))
  assert.ok(!main.includes('ipcMain'))
  assert.ok(!main.includes('setCertificateVerifyProc'))
})
