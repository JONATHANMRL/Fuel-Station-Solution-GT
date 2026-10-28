// Bounded polling, one request at a time, with lifecycle and account guards.
export function createNotificationLoader(service, onChange, { schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let version = 0, timer, controller, pending, userId
  let rows = [], error = '', offset = 0, more = false
  const publish = (loading = false) => onChange({ notifications: rows, userId, error, loading, hasMore: more })
  function cancel() {
    ++version; controller?.abort(); unschedule(timer); pending = null
  }
  async function fetchPage(append = false) {
    if (!userId || pending) return pending
    const current = version, requestedUser = userId
    unschedule(timer)
    controller = new AbortController()
    publish(true)
    pending = (async () => {
      try {
        const data = await service.getOracleNotifications({ signal: controller.signal, offset: append ? offset : 0 })
        if (current !== version) return
        if (data.userId !== requestedUser) throw new Error('Los avisos no corresponden a la sesión actual.')
        // On a refresh reload the first page; no stale pages after new inserts.
        const merged = new Map((append ? rows : []).map((row) => [row.id, row]))
        for (const row of data.notifications) merged.set(row.id, row)
        rows = [...merged.values()]
        offset = (append ? offset : 0) + data.notifications.length
        more = data.notifications.length === 50
        error = ''
      } catch (failure) {
        if (current !== version) return
        rows = []; more = false; offset = 0; error = failure.message
      } finally {
        if (current === version) {
          pending = null
          publish()
          timer = schedule(() => { if (current === version) return fetchPage() }, 30000)
        }
      }
    })()
    return pending
  }
  return {
    start(id) { cancel(); userId = id; rows = []; offset = 0; more = false; error = ''; publish(); return fetchPage() },
    async refresh() {
      const current = version
      // A read acknowledgement must not join an older, unread snapshot.
      // Finish that request, then fetch fresh data without overlapping requests.
      if (pending) await pending
      if (current === version) return fetchPage()
    },
    more: () => fetchPage(true),
    cancel,
  }
}
