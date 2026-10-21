import { useState } from 'react'
import { signInAdmin } from '../services/adminAuthService'

// Administrative children are intentionally not rendered while authentication
// is unavailable. No client-only session can unlock this screen.
export default function AdminAccessGate() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    setError('')
    try {
      signInAdmin({ username, password })
    } catch (authError) {
      setError(authError.message)
    } finally {
      setPassword('')
      setShowPassword(false)
    }
  }

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
          Nombre de usuario
          <input id="admin-username" name="username" type="text" autoComplete="username"
            required maxLength={120} value={username} placeholder="Tu nombre de usuario"
            onChange={(event) => { setUsername(event.target.value); setError('') }} />
        </label>
        <label htmlFor="admin-password">
          Contraseña
        </label>
        <div className="admin-password-field">
          <input id="admin-password" name="password" type={showPassword ? 'text' : 'password'}
            autoComplete="current-password" required value={password}
            aria-describedby={error ? 'admin-login-error' : undefined}
            onChange={(event) => { setPassword(event.target.value); setError('') }} />
          <button type="button" className="secondary-button" aria-controls="admin-password"
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
            {showPassword ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {error && <p id="admin-login-error" className="status-banner admin-login-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button">Iniciar sesión</button>
      </form>
    </div>
  )
}
