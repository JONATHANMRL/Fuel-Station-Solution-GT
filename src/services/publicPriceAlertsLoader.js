// Separate lifecycle and namespace from personal notifications, no session/storage.
export function createPublicPriceAlertsLoader(fetchPage, onChange, { schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let version = 0, timer, active, running = false
  let alerts = [], nextCursor = null, activatedAt = null, error = '', fetchedAt = null
  const publish = (loading = false) => onChange({ alerts, nextCursor, activatedAt, error, fetchedAt, loading })
  function cancel() {
    running = false
    ++version
    unschedule(timer)
    active?.controller.abort()
    active = null
  }
  function load(append = false) {
    if (!running || active || (append && !nextCursor)) return active?.promise
    const current = version
    unschedule(timer)
    const ticket = { controller: new AbortController(), promise: null }
    active = ticket
    const requestedCursor = append ? nextCursor : undefined
    publish(true)
    ticket.promise = (async () => {
      try {
        const page = await fetchPage({ cursor: requestedCursor, limit: 25, signal: ticket.controller.signal })
        if (current !== version) return
        const merged = new Map((append ? alerts : []).map((row) => [row.id, row]))
        for (const row of page.alerts) merged.set(row.id, row)
        // Refresh replaces old pages. Newly inserted events cannot shift offsets.
        // Keep Oracle's timestamp(6)/ID ordering; JS Date would lose microseconds.
        alerts = [...merged.values()]
        nextCursor = page.nextCursor
        activatedAt = page.activatedAt
        fetchedAt = page.fetchedAt
        error = ''
      } catch (failure) {
        if (current !== version) return
        alerts = []; nextCursor = null; fetchedAt = null
        error = failure.message || 'No fue posible consultar los avisos generales.'
      } finally {
        if (current === version && active === ticket) {
          active = null
          publish()
          timer = schedule(() => { if (current === version) return load() }, 30000)
        }
      }
    })()
    return ticket.promise
  }
  return {
    start() { cancel(); running = true; alerts = []; nextCursor = null; activatedAt = null; fetchedAt = null; error = ''; return load() },
    refresh: () => load(),
    more: () => load(true),
    cancel,
  }
}
