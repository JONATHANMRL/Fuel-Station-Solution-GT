const { app, BrowserWindow, session, shell, dialog, Menu, screen, Notification } = require('electron')
const path = require('node:path')
const { loadClientConfig } = require('./client-config.cjs')
const { createDesktopWindow } = require('./window.cjs')
const { configureWindowsNotifications } = require('./windows-notifications.cjs')

app.setName('GasolinaGT')
app.setPath('userData', path.join(app.getPath('appData'), app.isPackaged ? 'GasolinaGT' : 'GasolinaGT-Development'))
app.enableSandbox()
let mainWindow
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    app.setAppUserModelId('gt.gasolinagt.desktop')
    configureWindowsNotifications({ app, shell })
    try {
      const config = loadClientConfig(app.getPath('userData'), path.join(__dirname, 'default-client.json'))
      const desktop = await createDesktopWindow({ BrowserWindow, session, shell, screen, dialog, Notification }, config,
        { distDir: path.join(__dirname, '..', 'dist-desktop'),
          consentFile: path.join(app.getPath('userData'), 'notification-consent.json') })
      mainWindow = desktop.win
    } catch (error) {
      dialog.showErrorBox('GasolinaGT', `No se pudo abrir la aplicación. Revisa client-config.json o vuelve a instalar.\n${error.message}`)
      app.quit()
    }
  })
  app.on('window-all-closed', () => app.quit())
}
