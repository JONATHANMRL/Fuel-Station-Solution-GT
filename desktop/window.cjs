const path = require('node:path')
const { createGateway } = require('./gateway.cjs')
const { INDEX_PATH, navigationAllowed, networkAllowed } = require('./security.cjs')
const { installNotificationPermissions } = require('./notification-permissions.cjs')

async function createDesktopWindow({ BrowserWindow, session, shell, screen, dialog, Notification }, config, { distDir, show = true, partition = 'persist:gasolinagt', consentFile } = {}) {
  const ses = session.fromPartition(partition)
  installNotificationPermissions(ses, { config, dialog, BrowserWindow, Notification, consentFile })
  ses.on('will-download', (event) => event.preventDefault())
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !networkAllowed(details.url, details.method, config) }))
  ses.protocol.handle('https', createGateway({ config, distDir,
    fetchRemote: (request) => ses.fetch(request, { bypassCustomProtocolHandlers: true, redirect: 'error' }),
  }))
  const area = screen?.getPrimaryDisplay().workAreaSize || { width: 1366, height: 850 }
  const win = new BrowserWindow({ title: 'GasolinaGT', width: Math.min(1366, area.width), height: Math.min(850, area.height), minWidth: Math.min(1024, area.width), minHeight: Math.min(700, area.height),
    show: false, backgroundColor: '#F8FAFC', icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false },
  })
  const copyright = 'https://www.openstreetmap.org/copyright'
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === copyright) shell.openExternal(copyright)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!navigationAllowed(url, config)) { event.preventDefault(); if (url === copyright) shell.openExternal(copyright) }
  })
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  if (show) win.once('ready-to-show', () => win.show())
  await win.loadURL(`${config.origin}${INDEX_PATH}#inicio`)
  return { win, ses }
}

module.exports = { createDesktopWindow }
