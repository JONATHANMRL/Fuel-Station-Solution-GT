import { fuelLabels } from '../data'
import usePublicPriceAlerts from '../hooks/usePublicPriceAlerts.js'

const money = (value) => `Q${value.toFixed(2)}`
const contextLabel = {
  unclassified: 'Histórico · origen sin verificar',
  before_activation: 'Histórico anterior a la activación · puede incluir demostraciones',
  after_activation: 'Registrado desde la activación · precio sin verificación comercial',
}

export default function PublicPriceAlerts() {
  const { alerts, nextCursor, activatedAt, fetchedAt, error, loading, refresh, more } = usePublicPriceAlerts()
  return <>
    <div className="section-heading">
      <div><h3>Avisos generales</h3><p className="table-note">Subidas y bajadas de Oracle. Disponibles sin iniciar sesión; consulta automática cada 30 segundos.</p></div>
      <button type="button" className="secondary-button" disabled={loading} onClick={refresh}>{loading ? 'Consultando…' : 'Actualizar avisos generales'}</button>
    </div>
    <p className="table-note">{activatedAt
      ? `Activación registrada: ${new Date(activatedAt).toLocaleString('es-GT')}. Las etiquetas indican el período, no certifican el origen comercial del precio.`
      : 'Sin fecha de activación configurada: el histórico puede incluir precios de demostración y no se presenta como cambios nuevos.'}</p>
    {error && <p className="status-banner" role="alert">{error}</p>}
    <div className="notification-list">
      {alerts.map((alert) => <article key={alert.id} className="notification-item">
        <span className={`chip ${alert.type === 'up' ? 'chip-up' : 'chip-down'}`}>{alert.type === 'up' ? 'Subió' : 'Bajó'}</span>
        <div>
          <strong>{alert.stationName} — {fuelLabels[alert.fuel]}</strong>
          <p>{alert.brand} · Precio anterior: {money(alert.previousPrice)} · Precio nuevo: {money(alert.newPrice)}</p>
          <p>Cambio: {alert.type === 'up' ? 'Subió' : 'Bajó'} {money(Math.abs(alert.difference))}.</p>
          <small>{new Date(alert.createdAt).toLocaleString('es-GT')} · {contextLabel[alert.context]}</small>
        </div>
      </article>)}
    </div>
    {!loading && !error && alerts.length === 0 && <p className="empty-state">Todavía no hay cambios efectivos de precios registrados.</p>}
    {nextCursor && <button type="button" className="secondary-button" disabled={loading} onClick={more}>Cargar cambios anteriores</button>}
    {fetchedAt && <p className="table-note">Última consulta: {new Date(fetchedAt).toLocaleString('es-GT')}. Los avisos se consultan mientras la aplicación está abierta.</p>}
  </>
}
