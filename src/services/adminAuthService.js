import { apiClient, ApiError } from './apiClient.js'

export const ADMIN_AUTH_UNAVAILABLE =
  'Acceso administrativo no disponible. Inténtalo más tarde.'

// Price writes remain closed even after administrative authentication (phase 3).
export function requireAdminAccess() {
  throw new Error(ADMIN_AUTH_UNAVAILABLE)
}

export async function signInAdmin({ username, password }, options) {
  if (!username.trim() || !password) {
    throw new Error('Ingresa tu nombre de usuario y contraseña.')
  }
  await apiClient.signIn({ email: username.trim(), password }, options)
  // Confirm that the browser actually accepted the HttpOnly cookie. Some browsers
  // block cross-site cookies even when the login HTTP request succeeds.
  try { return await apiClient.adminSession(options) } catch (error) {
    if (error.code === 'HTTP_401') throw new ApiError('SESSION_COOKIE_UNAVAILABLE',
      'No se pudo confirmar la cookie de sesión. Revisa la configuración HTTPS y de cookies del sitio.')
    throw error
  }
}
export async function getAdminSession(options) {
  try { return await apiClient.adminSession(options) } catch (error) {
    if (['HTTP_401', 'HTTP_403'].includes(error.code)) return null
    throw error
  }
}

export const signOutAdmin = (options) => apiClient.signOut(options)
