import { useEffect, useMemo, useState } from 'react'
import * as authService from '../services/adminAuthService.js'
import { createAdminSessionController } from '../services/adminSessionController.js'

import { AdminSessionContext } from '../hooks/useAdminSession.js'

// Keep the existing session controller alive while navigating the seven sections.
export default function AdminSessionProvider({ children }) {
  const [state, setState] = useState({ session: null, busy: true, error: '' })
  const controller = useMemo(() => createAdminSessionController(authService, setState), [])
  useEffect(() => {
    controller.check()
    const focus = () => controller.check()
    window.addEventListener('focus', focus)
    return () => { controller.cancel(); window.removeEventListener('focus', focus) }
  }, [controller])
  return <AdminSessionContext.Provider value={{ ...state, controller }}>{children}</AdminSessionContext.Provider>
}

