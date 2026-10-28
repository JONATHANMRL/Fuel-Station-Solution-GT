import { useEffect, useMemo, useState } from 'react'
import { useAdminSession } from './useAdminSession.js'
import * as service from '../services/oracleOperationsService.js'
import { createNotificationLoader } from '../services/notificationLoader.js'

export default function useOracleNotifications() {
  const { session } = useAdminSession()
  const [state, setState] = useState({ notifications: [], error: '', loading: false, hasMore: false })
  const loader = useMemo(() => createNotificationLoader(service, setState), [])
  const id = session?.user.id ?? null
  useEffect(() => {
    loader.start(id)
    const focus = () => loader.refresh()
    window.addEventListener('focus', focus)
    return () => { loader.cancel(); window.removeEventListener('focus', focus) }
  }, [id, loader])
  const visible = id && state.userId === id ? state : { notifications: [], error: '', loading: false, hasMore: false }
  return { ...visible, refresh: loader.refresh, more: loader.more, signedIn: Boolean(id) }
}
