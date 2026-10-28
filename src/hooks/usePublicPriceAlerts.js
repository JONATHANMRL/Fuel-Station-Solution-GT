import { useEffect, useMemo, useState } from 'react'
import { getPublicPriceAlerts } from '../services/publicPriceAlertsService.js'
import { createPublicPriceAlertsLoader } from '../services/publicPriceAlertsLoader.js'

export default function usePublicPriceAlerts() {
  const [state, setState] = useState({ alerts: [], nextCursor: null, activatedAt: null, fetchedAt: null, error: '', loading: true })
  const loader = useMemo(() => createPublicPriceAlertsLoader(getPublicPriceAlerts, setState), [])
  useEffect(() => {
    // Avoid a request for the discarded StrictMode setup.
    let disposed = false
    queueMicrotask(() => { if (!disposed) loader.start() })
    const focus = () => loader.refresh()
    window.addEventListener('focus', focus)
    return () => { disposed = true; loader.cancel(); window.removeEventListener('focus', focus) }
  }, [loader])
  return { ...state, refresh: loader.refresh, more: loader.more }
}
