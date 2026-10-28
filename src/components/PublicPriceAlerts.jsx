import { fuelLabels } from '../data'
import usePublicPriceAlerts from '../hooks/usePublicPriceAlerts.js'

const money = (value) => `Q${value.toFixed(2)}`

export default function PublicPriceAlerts({ active = true }) {
  const { alerts, nextCursor, fetchedAt, error, loading, refresh, more } = usePublicPriceAlerts(active)
  return <>
    <div className="section-heading">
      <div><h3>Avisos generales</h3><p className="table-note">Consulta los cambios recientes en los precios de los combustibles.</p></div>
      <button type="button" className="secondary-button" disabled={loading} onClick={refresh}>{loading ? 'Consultando…' : 'Actualizar avisos generales'}</button>
    </div>
    {error && <p className="status-banner" role="alert">{error}</p>}
    <div className="notification-list">
      {alerts.map((alert) => <article key={alert.id} className="notification-item">
        <span className={`chip ${alert.type === 'up' ? 'chip-up' : 'chip-down'}`}>{alert.type === 'up' ? 'Subió' : 'Bajó'}</span>
        <div>
          <strong>{alert.stationName} — {fuelLabels[alert.fuel]}</strong>
          <p>{alert.brand} · Precio anterior: {money(alert.previousPrice)} · Precio nuevo: {money(alert.newPrice)}</p>
          <p>Cambio: {alert.type === 'up' ? 'Subió' : 'Bajó'} {money(Math.abs(alert.difference))}.</p>
          <small>{new Date(alert.createdAt).toLocaleString('es-GT')}</small>
        </div>
      </article>)}
    </div>
    {!loading && !error && alerts.length === 0 && <p className="empty-state">Todavía no hay cambios efectivos de precios registrados.</p>}
    {nextCursor && <button type="button" className="secondary-button" disabled={loading} onClick={more}>Cargar cambios anteriores</button>}
    {fetchedAt && <p className="table-note">Actualizado: {new Date(fetchedAt).toLocaleString('es-GT')}</p>}
  </>
}
