import { useEffect, useMemo, useState } from 'react'
import { getPublicPriceAlerts } from '../services/publicPriceAlertsService.js'
import { activatePublicPriceAlerts, createPublicPriceAlertsLoader } from '../services/publicPriceAlertsLoader.js'
import { systemNotifier } from '../services/systemNotifications.js'

export default function usePublicPriceAlerts(active = true) {
  const [state, setState] = useState({ alerts: [], nextCursor: null, activatedAt: null, fetchedAt: null, error: '', loading: true })
  const loader = useMemo(() => createPublicPriceAlertsLoader(getPublicPriceAlerts, setState, { onLatest: systemNotifier.observe }), [])
  useEffect(() => activatePublicPriceAlerts(loader, active), [active, loader])
  return { ...state, refresh: loader.refresh, more: loader.more }
}
