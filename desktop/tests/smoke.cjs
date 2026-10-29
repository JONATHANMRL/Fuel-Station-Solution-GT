// A hidden REAL Electron window + loopback-only HTTPS fixture. No central server.
const { app, BrowserWindow, session, shell, Notification: NativeNotification } = require('electron')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const root = path.join(__dirname, '..', '..')
const packaged = process.argv.includes('--packaged')
const appRoot = packaged ? path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar') : path.join(root, 'desktop', '..')
const { createDesktopWindow } = require(path.join(appRoot, 'desktop', 'window.cjs'))
const { validateConfig } = require('../client-config.cjs')
const folder = path.join(__dirname, '..', '.test-runtime')
fs.mkdirSync(path.join(folder, 'user-data'), { recursive: true })
app.setPath('userData', path.join(folder, 'user-data'))
app.enableSandbox()
app.whenReady().then(async () => {
  const fixtures = await import(pathToFileURL(path.join(root, 'tests', 'fixtures', 'oracleApi.mjs')).href)
  const cert = fs.readFileSync(path.join(folder, 'cert.pem'))
  const fingerprint = new crypto.X509Certificate(cert).fingerprint256
  let win, server, active = false, rejectOrigin = false, offline = false, permissionPrompts = 0
  let publicRows = []
  const requests = []
  try {
    assert.equal(typeof app.setToastActivatorCLSID, 'function')
    process.stdout.write(`API nativa Windows disponible: ${NativeNotification.isSupported()}. Esto no confirma la visualización de un banner.\n`)
    server = https.createServer({ key: fs.readFileSync(path.join(folder, 'key.pem')), cert }, (req, res) => {
      requests.push({ method: req.method, path: req.url, origin: req.headers.origin, csrf: req.headers['x-admin-request'] })
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      if (offline) { res.statusCode = 503; res.end('{}'); return }
      const cookie = req.headers.cookie?.includes('__Host-fsgt_admin=SIMULATED_SESSION')
      const profile = { authenticated: true, user: { id: '22', email: 'admin@example.invalid', role: 'admin' }, expiresAt: '2099-01-01T00:00:00+00:00' }
      if (req.url === '/auth/login') {
        if (rejectOrigin || !req.headers.origin || req.headers['x-admin-request'] !== '1') { res.statusCode = 403; res.end('{}'); return }
        active = true
        res.setHeader('Set-Cookie', '__Host-fsgt_admin=SIMULATED_SESSION; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=60')
        res.end(JSON.stringify(profile)); return
      }
      if (req.url === '/auth/session') { res.statusCode = active && cookie ? 200 : 401; res.end(JSON.stringify(active && cookie ? profile : {})); return }
      if (req.url === '/auth/logout') {
        active = false; res.setHeader('Set-Cookie', '__Host-fsgt_admin=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0')
        res.statusCode = 204; res.end(); return
      }
      if (req.url === '/stations') { res.end(JSON.stringify(fixtures.stationsResponse())); return }
      if (req.url === '/brands') { res.end(JSON.stringify(fixtures.brandsResponse())); return }
      if (req.url.startsWith('/prices')) { res.end(JSON.stringify(fixtures.pricesResponse(new URL(req.url, 'https://fixture.invalid').searchParams.get('fuel')))); return }
      if (req.url.startsWith('/public/price-alerts')) { res.end(JSON.stringify({ source: 'oracle', count: publicRows.length, alerts: publicRows,
        limit: 25, nextCursor: null, activatedAt: null, fetchedAt: new Date().toISOString() })); return }
      res.statusCode = 404; res.end('{}')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const config = validateConfig({ apiBaseUrl: `https://127.0.0.1:${server.address().port}` })
    const partition = 'gasolinagt-isolated-smoke'
    // Test-only trust of THIS generated certificate on loopback. Production has no
    // certificate overrides, ignore-certificate-errors flags, or custom CA trust.
    const testSession = session.fromPartition(partition)
    testSession.setCertificateVerifyProc((request, callback) => {
      const actual = new crypto.X509Certificate(request.certificate.data).fingerprint256
      callback(request.hostname === '127.0.0.1' && actual === fingerprint ? 0 : -3)
    })
    const desktop = await createDesktopWindow({ BrowserWindow, session, shell,
      dialog: { async showMessageBox() { permissionPrompts++; return { response: 0 } } },
      Notification: { isSupported: () => true } }, config,
      { distDir: path.join(appRoot, 'dist-desktop'), show: false, partition })
    win = desktop.win
    const evaluate = (body) => win.webContents.executeJavaScript(`(async()=>{${body}})()`)
    assert.equal(await evaluate('return location.origin'), config.origin)
    assert.equal(await evaluate('return isSecureContext'), true)
    assert.equal(await evaluate('return typeof require'), 'undefined')
    assert.equal(await evaluate('return typeof process'), 'undefined')
    assert.equal(await evaluate('return typeof globalThis.__GASOLINAGT_CONFIG__.apiBaseUrl'), 'string')
    let loaded = false
    for (let attempt = 0; attempt < 60 && !loaded; attempt++) {
      loaded = await evaluate("return document.body.innerText.includes('25 gasolineras')")
      if (!loaded) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.ok(loaded, 'React debe cargar las 25 estaciones simuladas desde HTTPS')
    // Exercise the real Chromium permission handlers, with a simulated consent
    // dialog. Capture toast construction to avoid claiming visual OS delivery.
    await evaluate(`const Native=window.Notification; window.__testToasts=[];
      function Captured(title,options){ window.__testToasts.push({title,...options}); this.close=()=>{} }
      Object.defineProperty(Captured,'permission',{get:()=>Native.permission});
      Captured.requestPermission=Native.requestPermission.bind(Native); window.Notification=Captured;
      location.hash='#notificaciones';`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await win.webContents.executeJavaScript(`document.querySelectorAll('button').forEach(b=>{if(b.textContent==='Activar notificaciones')b.click()})`, true)
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(permissionPrompts, 1)
    assert.equal(await evaluate('return Notification.permission'), 'granted')
    assert.equal(await evaluate("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Notificaciones activadas')"), true)
    assert.equal(await evaluate('return window.__testToasts.length'), 1)
    publicRows = [{ id: 'public-price:999', priceId: '999', source: 'oracle', stationId: '1', stationName: 'Estación SIMULADA',
      brand: 'Shell', fuel: 'regular', previousPrice: 30.50, newPrice: 30.25, difference: -0.25, type: 'down',
      createdAt: new Date().toISOString(), context: 'unclassified' }]
    await evaluate("document.querySelectorAll('button').forEach(b=>{if(b.textContent==='Actualizar avisos generales')b.click()})")
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(await evaluate('return window.__testToasts.length'), 2)
    await evaluate("document.querySelectorAll('button').forEach(b=>{if(b.textContent==='Actualizar avisos generales')b.click()})")
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(await evaluate('return window.__testToasts.length'), 2)
    const publicCalls = () => requests.filter((r) => r.path.startsWith('/public/price-alerts')).length
    const beforeTimer = publicCalls()
    process.stdout.write('Comprobando polling real de Chromium (30 segundos activo y 30 segundos fuera de la sección)...\n')
    await new Promise((resolve) => setTimeout(resolve, 31000))
    assert.equal(publicCalls(), beforeTimer + 1)
    await evaluate("location.hash='#inicio'")
    await new Promise((resolve) => setTimeout(resolve, 150))
    const stopped = publicCalls()
    await new Promise((resolve) => setTimeout(resolve, 31000))
    assert.equal(publicCalls(), stopped)
    process.stdout.write('PASS permisos Chromium solo de notificaciones, botón React, dos toasts capturados sin duplicar eventos y polling detenido al salir. La visualización de Windows queda para prueba manual.\n')
    assert.equal(await evaluate("return (await fetch('/stations',{credentials:'omit'})).status"), 200)
    rejectOrigin = true
    const login = "return (await fetch('/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Admin-Request':'1'},body:JSON.stringify({email:'admin@example.invalid',password:'SIMULATED'})})).status"
    assert.equal(await evaluate(login), 403)
    rejectOrigin = false
    assert.equal(await evaluate(login), 200)
    assert.equal(await evaluate("return (await fetch('/auth/session',{credentials:'include'})).status"), 200)
    assert.ok(!(await evaluate('return document.cookie')).includes('SIMULATED_SESSION'))
    const cookies = await desktop.ses.cookies.get({ url: config.origin })
    const cookie = cookies.find((entry) => entry.name === '__Host-fsgt_admin')
    assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'no_restriction')
    assert.ok(requests.some((entry) => entry.path === '/auth/login' && entry.origin === config.origin && entry.csrf === '1'))
    await evaluate("return (await fetch('/auth/logout',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Admin-Request':'1'},body:'{}'})).status")
    assert.equal(await evaluate("return (await fetch('/auth/session',{credentials:'include'})).status"), 401)
    offline = true
    assert.equal(await evaluate("return (await fetch('/stations',{credentials:'omit'})).status"), 503)
    assert.equal(win.webContents.getLastWebPreferences().sandbox, true)
    assert.equal(win.webContents.getLastWebPreferences().nodeIntegration, false)
    assert.equal(win.webContents.getBackgroundThrottling(), false)
    process.stdout.write(`PASS Electron real ${packaged ? '(ASAR empaquetado)' : '(build local)'}: React con 25 estaciones simuladas, archivos locales, origen HTTPS, aislamiento, cookies HttpOnly/Secure/SameSite=None, login/session/logout, Origin/CSRF y error de red simulados.\n`)
  } catch (error) { process.stderr.write(`FAIL Electron: ${error.stack}\n`); process.exitCode = 1 }
  finally { win?.destroy(); if (server) await new Promise((resolve) => server.close(resolve)); app.exit(process.exitCode || 0) }
})
