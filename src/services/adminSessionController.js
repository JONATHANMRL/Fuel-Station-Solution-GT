// Only public user metadata is held in memory; the HttpOnly cookie is inaccessible.
export function createAdminSessionController(service, onChange, { clock = Date.now, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let version = 0, timer, controller
  let session = null
  const publish = (next, error = '') => {
    session = next
    unschedule(timer)
    if (session) {
      const remaining = Date.parse(session.expiresAt) - clock()
      if (remaining <= 0) { session = null; error = 'La sesión ha vencido. Inicia sesión nuevamente.' }
      else timer = schedule(() => {
        ++version
        controller?.abort()
        publish(null, 'La sesión ha vencido. Inicia sesión nuevamente.')
      }, remaining)
    }
    onChange({ session, busy: false, error })
  }
  async function run(operation, preserveOnFailure = false) {
    const current = ++version
    controller?.abort()
    controller = new AbortController()
    onChange({ session, busy: true, error: '' })
    try {
      const next = await operation({ signal: controller.signal })
      if (current === version) publish(next)
    } catch (error) {
      if (current === version) publish(preserveOnFailure ? session : null, error.message || 'No se pudo verificar la sesión.')
    }
  }
  return {
    check: () => run(service.getAdminSession),
    signIn: (credentials) => run((options) => service.signInAdmin(credentials, options)),
    signOut: () => run(async (options) => { await service.signOutAdmin(options); return null }, true),
    cancel() { ++version; controller?.abort(); unschedule(timer) },
  }
}
