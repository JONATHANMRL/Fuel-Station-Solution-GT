import { createContext, useContext } from 'react'

export const AdminSessionContext = createContext(null)

export function useAdminSession() {
  const value = useContext(AdminSessionContext)
  if (!value) throw new Error('AdminSessionProvider es obligatorio.')
  return value
}
