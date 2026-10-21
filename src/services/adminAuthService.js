export const ADMIN_AUTH_UNAVAILABLE =
  'Acceso administrativo no disponible. Inténtalo más tarde.'

// Fail closed until the existing API can verify credentials, roles and sessions.
// A browser flag or localStorage value must never authorize price updates.
export function requireAdminAccess() {
  throw new Error(ADMIN_AUTH_UNAVAILABLE)
}

export function signInAdmin({ username, password }) {
  if (!username.trim() || !password) {
    throw new Error('Ingresa tu nombre de usuario y contraseña.')
  }
  requireAdminAccess()
}
