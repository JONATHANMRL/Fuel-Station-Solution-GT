// Only public user metadata is held in memory; the HttpOnly cookie is inaccessible.
export function createAdminSessionController(service, onChange, { schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let version = 0, timer, active
  let session = null
  const expired = 'La sesión ha vencido o ya no está disponible. Inicia sesión nuevamente.'
  const publish = (next, error = '') => {
    session = next
    unschedule(timer)
    if (session) {
      const current = version
      // A server-confirmed session must not be rejected by a different PC clock.
      // Poll the authority instead of expiring locally. Old, already queued timers
      // cannot interrupt a newer login, logout or StrictMode effect lifecycle.
      timer = schedule(() => {
        if (current === version && !active) return check()
      }, 30000)
    }
    onChange({ session, busy: false, error })
  }
  function run(operation, { preserveOnFailure = false, checking = false } = {}) {
    const current = ++version
    active?.controller.abort()
    unschedule(timer)
    const ticket = { controller: new AbortController(), promise: null }
    active = ticket
    onChange({ session, busy: true, error: '' })
    ticket.promise = (async () => {
      try {
        const next = await operation({ signal: ticket.controller.signal })
        if (current === version) publish(next, checking && session && !next ? expired : '')
      } catch (error) {
        if (current === version) publish(preserveOnFailure ? session : null, error.message || 'No se pudo verificar la sesión.')
      } finally {
        if (active === ticket) active = null
      }
    })()
    return ticket.promise
  }
  function check() {
    // Focus events and repeated clicks join pending work; they never supersede
    // login's POST + cookie confirmation or an in-flight logout.
    return active ? active.promise : run(service.getAdminSession, { checking: true })
  }
  return {
    check,
    signIn: (credentials) => run((options) => service.signInAdmin(credentials, options)),
    signOut: () => run(async (options) => { await service.signOutAdmin(options); return null }, { preserveOnFailure: true }),
    cancel() { ++version; active?.controller.abort(); active = null; unschedule(timer) },
  }
}
