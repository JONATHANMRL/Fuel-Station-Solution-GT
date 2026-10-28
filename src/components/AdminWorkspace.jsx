import { useCallback, useEffect, useRef, useState } from 'react'
import { fuelLabels } from '../data'
import { useAdminSession } from '../hooks/useAdminSession.js'
import { getCapabilities, getOracleHistory, getPriceStates, saveOraclePrice } from '../services/oracleOperationsService.js'

const money = (value) => value === null || value === undefined ? '—' : `Q ${Number(value).toFixed(2)}`

export default function AdminWorkspace({ stations, onSaved }) {
  const { session, busy: checking, controller } = useAdminSession()
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ stationId: '', fuel: 'regular', newPrice: '' })
  const [data, setData] = useState({ capabilities: null, prices: [], history: [] })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [offset, setOffset] = useState(0)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const lifecycle = useRef({ version: 0, alive: true })
  const locked = useRef(false)
  const load = useCallback(async () => {
    const version = ++lifecycle.current.version
    setLoading(true)
    setError('')
    try {
      const capabilities = await getCapabilities()
      const [prices, history] = capabilities.history
        ? await Promise.all([getPriceStates(), getOracleHistory({ offset })]) : [{ prices: [] }, { history: [] }]
      if (version === lifecycle.current.version) setData({ capabilities, prices: prices.prices, history: history.history })
    } catch (failure) {
      if (version === lifecycle.current.version) {
        setData({ capabilities: null, prices: [], history: [] })
        setError(failure.message)
        if (['HTTP_401', 'HTTP_403'].includes(failure.code)) controller.check()
      }
    } finally { if (version === lifecycle.current.version) setLoading(false) }
  }, [offset, controller, lifecycle])
  useEffect(() => {
    const lifetime = lifecycle.current
    lifetime.alive = true
    let disposed = false
    // Do not start work for the disposed StrictMode setup.
    queueMicrotask(() => { if (!disposed) load() })
    return () => { disposed = true; lifetime.alive = false; ++lifetime.version }
  }, [load, lifecycle])
  const stationId = form.stationId || stations[0]?.id || ''
  const selected = data.prices.find((row) => row.stationId === stationId && row.fuel === form.fuel)
  const filtered = stations.filter((station) => `${station.name} ${station.brand} ${station.zone}`.toLowerCase().includes(search.trim().toLowerCase()))
  const selectionVisible = filtered.some((station) => station.id === stationId)
  const allowed = Boolean(session && data.capabilities?.priceWrites && selected?.available && selectionVisible && !loading && !checking && !saving && !unconfirmed)

  const submit = async (event) => {
    event.preventDefault()
    if (!allowed || locked.current) return
    if (!/^\d+(?:\.\d{1,2})?$/.test(form.newPrice) || Number(form.newPrice) <= 0 || Number(form.newPrice) > 999999.99) {
      setError('Ingresa un precio positivo con hasta dos decimales.'); return
    }
    locked.current = true
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await saveOraclePrice({ station_id: stationId, fuel: form.fuel, price: form.newPrice,
        expected_price_id: selected.priceId, request_id: crypto.randomUUID() })
      // Once confirmed, refresh the existing public loader (map/comparator included).
      await onSaved()
      if (lifecycle.current.alive) {
        setMessage('Precio guardado correctamente.')
        setForm((current) => ({ ...current, newPrice: '' }))
        await load()
      }
    } catch (failure) {
      if (lifecycle.current.alive) {
        setError(failure.message)
        // Do not silently retry a mutation after a lost or incompatible response.
        setUnconfirmed(true)
        if (['HTTP_401', 'HTTP_403'].includes(failure.code)) controller.check()
      }
    } finally {
      locked.current = false
      if (lifecycle.current.alive) setSaving(false)
    }
  }

  return <>
    {error && <p className="status-banner" role="alert">{error}</p>}
    {message && <p className="status-banner" role="status">{message}</p>}
    {!data.capabilities?.priceWrites && !loading && <p className="table-note">Actualización de precios pendiente de habilitación segura en el servidor.</p>}
    <button type="button" className="secondary-button" disabled={loading || saving} onClick={async () => {
      await onSaved(); await load(); setUnconfirmed(false)
    }}>Actualizar precios e historial</button>
    {unconfirmed && <p className="table-note">Comprueba el precio vigente y el historial antes de preparar otra solicitud. No se reenviará el cambio automáticamente.</p>}
    <div className="admin-workspace">
      <form className="admin-form" onSubmit={submit} aria-busy={loading || saving}>
        <label>Buscar gasolinera<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, marca o zona" /></label>
        <div className="field-row">
          <label>Gasolinera<select value={selectionVisible ? stationId : ''} disabled={saving} onChange={(event) => setForm({ ...form, stationId: event.target.value, newPrice: '' })}>
            <option value="" disabled>Selecciona una gasolinera</option>
            {filtered.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
          </select></label>
          <label>Combustible<select value={form.fuel} disabled={saving} onChange={(event) => setForm({ ...form, fuel: event.target.value, newPrice: '' })}>
            {Object.entries(fuelLabels).map(([fuel, label]) => <option key={fuel} value={fuel}>{label}</option>)}
          </select></label>
          <label>Precio actual<output className="current-price">{money(selected?.price)}</output></label>
        </div>
        <div className="field-row admin-price-row">
          <label>Nuevo precio por galón (Q)<input type="number" min="0.01" max="999999.99" step="0.01" required disabled={!allowed}
            value={form.newPrice} onChange={(event) => setForm({ ...form, newPrice: event.target.value })} /></label>
          <div className="admin-submit"><button type="submit" className="primary-button" disabled={!allowed || !form.newPrice}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
        </div>
      </form>
      <div className="admin-history">
        <div className="history-heading"><div><span className="section-tag">Actualizaciones</span><h3>Historial de modificaciones</h3></div></div>
        {data.history.length ? <div className="table-wrap"><table><thead><tr>
          <th>Gasolinera</th><th>Combustible</th><th>Anterior</th><th>Nuevo</th><th>Fecha</th><th>Administrador</th>
        </tr></thead><tbody>{data.history.map((row) => <tr key={row.id}>
          <td>{row.stationName}</td><td>{fuelLabels[row.fuel]}</td><td>{money(row.previousPrice)}</td><td>{money(row.newPrice)}</td>
          <td>{new Date(row.updatedAt).toLocaleString('es-GT')}</td><td>No registrado</td>
        </tr>)}</tbody></table></div> : <p className="empty-state">{loading ? 'Consultando historial…' : 'Aún no hay modificaciones registradas.'}</p>}
        <div className="field-row">
          <button className="secondary-button" type="button" disabled={loading || saving || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior</button>
          <button className="secondary-button" type="button" disabled={loading || saving || data.history.length < 50} onClick={() => setOffset(offset + 50)}>Siguiente</button>
        </div>
      </div>
    </div>
  </>
}
