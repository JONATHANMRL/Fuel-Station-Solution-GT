// Explicit optional REAL read-only integration check. No credentials or mutations.
const { app, BrowserWindow, session, shell } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { validateConfig } = require('../client-config.cjs')
const root = path.join(__dirname, '..', '..')
const appRoot = process.argv.includes('--packaged') ? path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar') : root
const { createDesktopWindow } = require(path.join(appRoot, 'desktop', 'window.cjs'))
const userData = path.join(root, 'desktop', '.test-runtime', 'central-user-data')
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.enableSandbox()
app.whenReady().then(async () => {
  const config = validateConfig(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'default-client.json'))))
  let win
  let failed = false
  try {
    const desktop = await createDesktopWindow({ BrowserWindow, session, shell }, config,
      { distDir: path.join(appRoot, 'dist-desktop'), show: false, partition: 'gasolinagt-real-read-check' })
    win = desktop.win
    const evaluate = (body) => win.webContents.executeJavaScript(`(async()=>{${body}})()`)
    let stationCount = 0
    for (const [route, key] of [['/stations', 'stations'], ['/brands', 'brands'], ['/prices', 'prices']]) {
      const result = await evaluate(`const response=await fetch(${JSON.stringify(route)},{credentials:'omit',signal:AbortSignal.timeout(12000)}); const data=await response.json(); return {status:response.status,source:data.source,count:data.count,length:data[${JSON.stringify(key)}]?.length};`)
      assert.equal(result.status, 200)
      assert.equal(result.source, 'oracle')
      assert.equal(result.count, result.length)
      if (key === 'stations') stationCount = result.count
      process.stdout.write(`REAL ${route}: HTTP ${result.status}, ${result.count} registros Oracle.\n`)
    }
    async function waitFor(body, message) {
      for (let i = 0; i < 240; i++) {
        if (await evaluate(body)) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error(message)
    }
    await waitFor(`return document.body.innerText.includes('${stationCount} gasolineras')`, 'React no mostró el catálogo real.')
    await evaluate("location.hash='#mapa'")
    await waitFor(`return document.querySelectorAll('.leaflet-marker-icon').length === ${stationCount}`, 'El mapa no mostró todos los marcadores Oracle.')
    process.stdout.write(`REAL React ${process.argv.includes('--packaged') ? 'desde ASAR' : 'desde build local'}: catálogo HTTPS cargado y ${stationCount} marcadores Leaflet. No se realizaron login ni escrituras reales.\n`)
  } catch (error) { process.stderr.write(`Lectura real pendiente/fallida: ${error.message}\n`); failed = true }
  win?.destroy()
  app.exit(failed ? 1 : 0)
})
