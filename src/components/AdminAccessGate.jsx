import { useEffect, useMemo, useState } from 'react'
import * as authService from '../services/adminAuthService'
import { createAdminSessionController } from '../services/adminSessionController'

export default function AdminAccessGate({ children }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [{ session, busy, error }, setAuth] = useState({ session: null, busy: true, error: '' })
  const controller = useMemo(() => createAdminSessionController(authService, setAuth), [])

  useEffect(() => {
    controller.check()
    const focus = () => controller.check()
    window.addEventListener('focus', focus)
    return () => { controller.cancel(); window.removeEventListener('focus', focus) }
  }, [controller])

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      await controller.signIn({ username, password })
    } finally {
      setPassword('')
      setShowPassword(false)
    }
  }

  if (session) return <>
    <div className="section-heading">
      <div><strong>{session.user.email}</strong><p className="table-note">Sesión administrativa · Actualización de precios deshabilitada.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={controller.signOut}>Cerrar sesión</button>
    </div>
    {error && <p className="status-banner" role="alert">{error}</p>}
    {children}
  </>

  return (
    <div className="admin-access-layout">
      <div className="admin-access-intro">
        <span className="section-tag">Acceso de administrador</span>
        <h3>Gestión de estaciones</h3>
        <p>La consulta de estaciones, el mapa, los favoritos y la comparación de precios siguen disponibles sin iniciar sesión.</p>
      </div>

      <form className="admin-form admin-login-form" onSubmit={handleSubmit}
        aria-labelledby="admin-login-title">
        <div>
          <h3 id="admin-login-title">Iniciar sesión</h3>
          <p className="table-note">Acceso exclusivo para administradores.</p>
        </div>
        <label htmlFor="admin-username">
          Correo electrónico
          <input id="admin-username" name="username" type="email" autoComplete="username"
            required maxLength={150} value={username} placeholder="Tu correo electrónico"
            disabled={busy} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label htmlFor="admin-password">
          Contraseña
        </label>
        <div className="admin-password-field">
          <input id="admin-password" name="password" type={showPassword ? 'text' : 'password'}
            autoComplete="current-password" required maxLength={1024} value={password} disabled={busy}
            aria-describedby={error ? 'admin-login-error' : undefined}
            onChange={(event) => setPassword(event.target.value)} />
          <button type="button" className="secondary-button" aria-controls="admin-password"
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
            {showPassword ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {error && <p id="admin-login-error" className="status-banner admin-login-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Verificando…' : 'Iniciar sesión'}</button>
        {!busy && <button type="button" className="secondary-button" onClick={controller.check}>Comprobar sesión</button>}
      </form>
    </div>
  )
}
