import { useEffect, useMemo, useState } from 'react'
import { getStationSnapshot } from '../services/gasolinaService.js'
import { createStationLoader, initialStationState } from '../services/stationLoader.js'

export default function useStationData(onLoaded) {
  const [state, setState] = useState(initialStationState)
  const loader = useMemo(() => createStationLoader(getStationSnapshot, (next) => {
    setState(next)
    if (next.status === 'ready') onLoaded?.(next.stations)
  }), [onLoaded])
  useEffect(() => {
    loader.refresh()
    return () => loader.cancel()
  }, [loader])
  return { ...state, refresh: loader.refresh }
}
