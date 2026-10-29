// Web Notification is backed by the OS in Electron. No privileged IPC or tokens.
const notificationAPI = () => globalThis.Notification
export const systemNotificationPermission = () => notificationAPI()?.permission ?? 'default'

export function createSystemNotifier({ getAPI = notificationAPI, focus = () => globalThis.window?.focus() } = {}) {
  let initialized = false
  const seen = new Set()
  function show(body, onError = () => {}) {
    const API = getAPI()
    if (!API || API.permission !== 'granted') return false
    try {
      const notice = new API('GasolinaGT', { body, tag: 'gasolinagt-price-changes', icon: '/brand-icon.svg' })
      notice.onclick = () => { focus(); notice.close() }
      notice.onerror = onError
      return true
    } catch { onError(); return false }
  }
  return {
    async activate(onError) {
      const API = getAPI()
      if (!API) throw new Error('Este equipo no admite notificaciones del sistema.')
      const permission = await API.requestPermission()
      if (permission === 'granted' && !show('Las notificaciones de GasolinaGT están habilitadas.', onError)) {
        throw new Error('No fue posible mostrar la notificación de prueba.')
      }
      return permission
    },
    observe(alerts) {
      const fresh = alerts.filter((row) => !seen.has(row.id))
      for (const row of alerts) seen.add(row.id)
      // Never replay the initial history or turn "Cargar anteriores" into toasts.
      if (initialized && fresh.length) {
        const row = fresh[0]
        const fuels = { regular: 'Regular', premium: 'Superior', diesel: 'Diésel' }
        show(`${row.stationName}: ${fuels[row.fuel]} ${row.type === 'up' ? 'subió' : 'bajó'} a Q${row.newPrice.toFixed(2)}.${fresh.length > 1 ? ` ${fresh.length} cambios nuevos; consulta los avisos generales.` : ''}`)
      }
      initialized = true
    },
  }
}

// One instance per renderer, retained across section changes and StrictMode effects.
export const systemNotifier = createSystemNotifier()
