export const initialStationState = { stations: [], status: 'loading', error: '', fetchedAt: null }

// Sequence guard also handles transports that fail to honor AbortSignal.
export function createStationLoader(fetchSnapshot, onChange) {
  let version = 0
  let controller
  return {
    async refresh() {
      const current = ++version
      controller?.abort()
      controller = new AbortController()
      onChange({ ...initialStationState })
      try {
        const snapshot = await fetchSnapshot({ signal: controller.signal })
        if (current === version) onChange({ stations: snapshot.stations, status: 'ready', error: '', fetchedAt: snapshot.fetchedAt })
      } catch (error) {
        if (current === version) onChange({ stations: [], status: 'error',
          error: error.message || 'No fue posible consultar las estaciones.', fetchedAt: null })
      }
    },
    cancel() { ++version; controller?.abort() },
  }
}
