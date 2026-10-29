const fs = require('node:fs')
const path = require('node:path')
const APP_ID = 'gt.gasolinagt.desktop'
const TOAST_CLSID = '{DA7420F7-1055-4961-A65D-799342AD97B7}'

function configureWindowsNotifications({ app, shell, platform = process.platform, execPath = process.execPath }) {
  if (platform !== 'win32' || !app.isPackaged) return 'not-packaged'
  // Keep the native activator stable across launches. Update only our existing
  // per-user installer shortcut; never change another app or create a new one.
  app.setToastActivatorCLSID(TOAST_CLSID)
  const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'GasolinaGT.lnk')
  if (!fs.existsSync(shortcut)) return 'missing-shortcut'
  try {
    const current = shell.readShortcutLink(shortcut)
    if (path.resolve(current.target).toLowerCase() !== path.resolve(execPath).toLowerCase() || current.appUserModelId !== APP_ID) return 'different-shortcut'
    return shell.writeShortcutLink(shortcut, 'update', { appUserModelId: APP_ID, toastActivatorClsid: TOAST_CLSID }) ? 'updated' : 'failed'
  } catch { return 'failed' }
}

module.exports = { configureWindowsNotifications, APP_ID, TOAST_CLSID }
