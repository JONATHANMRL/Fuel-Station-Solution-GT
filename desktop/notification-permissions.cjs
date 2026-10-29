const fs = require('node:fs')
const path = require('node:path')
const { navigationAllowed } = require('./security.cjs')

// Only notification consent is persisted, scoped to the configured HTTPS origin.
function installNotificationPermissions(ses, { config, dialog, BrowserWindow, Notification, consentFile }) {
  let granted = false, pending
  try {
    const saved = JSON.parse(fs.readFileSync(consentFile, 'utf8'))
    granted = saved.origin === config.origin && saved.notifications === true
  } catch { /* No consent, unreadable or invalid file: deny until explicitly requested. */ }
  const trusted = (contents) => contents && !contents.isDestroyed() && navigationAllowed(contents.getURL(), config)
  const sameOrigin = (value) => {
    try {
      const url = new URL(value)
      return url.origin === config.origin && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash
    } catch { return false }
  }
  ses.setPermissionCheckHandler((contents, permission, origin, details = {}) =>
    permission === 'notifications' && granted && sameOrigin(origin) &&
    (!contents || (trusted(contents) && details.isMainFrame !== false &&
      (!details.requestingUrl || navigationAllowed(details.requestingUrl, config)))))
  ses.setPermissionRequestHandler((contents, permission, callback, details = {}) => {
    const allowedDocument = () => trusted(contents) && details.isMainFrame === true &&
      (!details.requestingUrl || navigationAllowed(details.requestingUrl, config))
    if (permission !== 'notifications' || !allowedDocument() || Notification?.isSupported() === false) return callback(false)
    if (granted) return callback(true)
    if (!pending) pending = (async () => {
      try {
        const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(contents), {
          type: 'question', title: 'Notificaciones de GasolinaGT',
          message: '¿Permitir notificaciones de GasolinaGT en Windows?',
          detail: 'Se mostrarán avisos de nuevos cambios de precios mientras la aplicación los consulta. Puedes desactivarlos en la configuración de notificaciones de Windows.',
          buttons: ['Permitir', 'Ahora no'], defaultId: 1, cancelId: 1, noLink: true,
        })
        if (result.response !== 0 || !allowedDocument()) return false
        if (consentFile) {
          fs.mkdirSync(path.dirname(consentFile), { recursive: true })
          fs.writeFileSync(consentFile, JSON.stringify({ origin: config.origin, notifications: true }) + '\n', { mode: 0o600 })
        }
        granted = true
        return true
      } catch { return false }
      finally { pending = null }
    })()
    pending.then((allowed) => callback(allowed && allowedDocument()))
  })
}

module.exports = { installNotificationPermissions }
