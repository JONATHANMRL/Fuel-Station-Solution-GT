import { useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import { fuelLabels } from './data'
import {
  getFavorites,
  getHistory,
  getNotificationPreferences,
  getNotifications,
  getStations,
  markNotificationsRead,
  saveFavorites,
  saveNotifications,
  saveNotificationPreferences,
  updatePrice,
} from './services/gasolinaService'
import './App.css'

const navigation = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'mapa', label: 'Mapa' },
  { id: 'marcas', label: 'Marcas' },
  { id: 'comparar', label: 'Comparar precios' },
  { id: 'favoritos', label: 'Favoritos' },
  { id: 'notificaciones', label: 'Notificaciones' },
  { id: 'admin', label: 'Panel admin' },
]

const currency = new Intl.NumberFormat('es-GT', {
  style: 'currency',
  currency: 'GTQ',
  minimumFractionDigits: 2,
})

const formatMoney = (value) => currency.format(Number(value))
const formatDate = (value) =>
  new Date(value).toLocaleString('es-GT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

const statusColors = {
  updated: '#1fbf75',
  warning: '#f59e0b',
  critical: '#ef4444',
}

const brandColors = {
  Shell: '#f7d35b',
  Puma: '#1fbf75',
  Texaco: '#ef4444',
  Independiente: '#14b8a6',
  Total: '#f59e0b',
  Mobil: '#60a5fa',
  default: '#94a3b8',
}

function App() {
  const [stations, setStations] = useState(getStations)
  const [selectedFuel, setSelectedFuel] = useState('regular')
  const [brandFilter, setBrandFilter] = useState('Todas')
  const [municipioFilter, setMunicipioFilter] = useState('Todos')
  const [zoneFilter, setZoneFilter] = useState('Todas')
  const [searchTerm, setSearchTerm] = useState('')
  const [favorites, setFavorites] = useState(getFavorites)
  const [notifications, setNotifications] = useState(getNotifications)
  const [history, setHistory] = useState(getHistory)
  const [notificationPreferences, setNotificationPreferences] =
    useState(getNotificationPreferences)
  const [selectedStationId, setSelectedStationId] = useState(() => getStations()[0]?.id)
  const [statusMessage, setStatusMessage] = useState('')
  const [notificationPermission, setNotificationPermission] = useState('default')
  const [sortOrder, setSortOrder] = useState('asc')
  const [compareStationIds, setCompareStationIds] = useState(() =>
    getStations().slice(0, 2).map((station) => station.id),
  )
  const [adminSearch, setAdminSearch] = useState('')
  const [priceForm, setPriceForm] = useState(() => {
    const firstStation = getStations()[0]
    return {
      stationId: firstStation?.id ?? '',
      fuel: 'regular',
      newPrice: firstStation?.prices.regular ?? '',
    }
  })
  const [showMobileNav, setShowMobileNav] = useState(false)

  const brandOptions = ['Todas', ...new Set(stations.map((station) => station.brand))]
  const municipalityOptions = ['Todos', ...new Set(stations.map((station) => station.municipality))]
  const zoneOptions = ['Todas', ...new Set(stations.map((station) => station.zone))]

  const filteredStations = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()

    return stations.filter((station) => {
      const matchesBrand = brandFilter === 'Todas' || station.brand === brandFilter
      const matchesMunicipality =
        municipioFilter === 'Todos' || station.municipality === municipioFilter
      const matchesZone = zoneFilter === 'Todas' || station.zone === zoneFilter
      const haystack = [
        station.name,
        station.brand,
        station.zone,
        station.municipality,
        station.address,
      ]
        .join(' ')
        .toLowerCase()

      const matchesSearch = !normalized || haystack.includes(normalized)
      return matchesBrand && matchesMunicipality && matchesZone && matchesSearch
    })
  }, [brandFilter, municipioFilter, searchTerm, stations, zoneFilter])

  const comparisonRows = useMemo(() => {
    return [...filteredStations]
      .map((station) => ({
        ...station,
        price: station.prices[selectedFuel],
      }))
      .sort((a, b) => (sortOrder === 'asc' ? a.price - b.price : b.price - a.price))
  }, [filteredStations, selectedFuel, sortOrder])

  const favoriteStations = useMemo(
    () => stations.filter((station) => favorites.includes(station.id)),
    [favorites, stations],
  )

  const brandSummary = useMemo(() => {
    const groups = new Map()

    for (const station of stations) {
      groups.set(station.brand, (groups.get(station.brand) ?? 0) + 1)
    }

    return [...groups.entries()].map(([name, quantity]) => ({
      name,
      quantity,
      color: brandColors[name] ?? brandColors.default,
    }))
  }, [stations])

  const cheapestStation = [...comparisonRows].sort((a, b) => a.price - b.price)[0]
  const comparisonSelection = stations.filter((station) => compareStationIds.includes(station.id))
  const comparisonDifference =
    comparisonSelection.length === 2
      ? Math.abs(
          comparisonSelection[0].prices[selectedFuel] -
            comparisonSelection[1].prices[selectedFuel],
        )
      : null
  const currentSelection =
    stations.find((station) => station.id === selectedStationId) ??
    filteredStations[0] ??
    stations[0]
  const unreadCount = notifications.filter((notification) => !notification.read).length
  const adminStations = stations.filter((station) =>
    [station.name, station.brand, station.zone]
      .join(' ')
      .toLowerCase()
      .includes(adminSearch.trim().toLowerCase()),
  )

  const handleSearch = (event) => setSearchTerm(event.target.value)

  const handleFavoriteToggle = (stationId) => {
    const nextFavorites = favorites.includes(stationId)
      ? favorites.filter((id) => id !== stationId)
      : [...favorites, stationId]
    setFavorites(nextFavorites)
    saveFavorites(nextFavorites)
  }

  const handleWebPushPermission = async () => {
    if (!('Notification' in window)) {
      setStatusMessage('Este navegador no admite notificaciones del navegador.')
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)

      if (permission === 'granted') {
        setStatusMessage(
          'Permiso del navegador concedido. Este modo local no envía notificaciones push ni funciona con la aplicación cerrada.',
        )
        return
      }

      setStatusMessage('Se requieren permisos para recibir alertas de precios.')
    } catch (error) {
      console.error('No se pudo solicitar permiso para notificaciones del navegador.', error)
      setStatusMessage('No fue posible solicitar el permiso de notificaciones en este navegador.')
    }
  }

  const handlePriceUpdate = (event) => {
    event.preventDefault()

    try {
      const result = updatePrice({
        stationId: priceForm.stationId,
        fuel: priceForm.fuel,
        price: priceForm.newPrice,
      })

      if (!result.changed) {
        setStatusMessage('El precio no cambió; no se agregó un registro de demostración.')
        return
      }

      setStations(getStations())
      setNotifications(getNotifications())
      setHistory(getHistory())
      setStatusMessage('Precio actualizado en esta demostración local.')
      setPriceForm((previous) => ({ ...previous, newPrice: result.station.prices[previous.fuel] }))

      const preferences = getNotificationPreferences()
      if (
        preferences.priceChanges &&
        (!preferences.favoritesOnly || favorites.includes(result.station.id)) &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification(result.notification.title, { body: result.notification.message })
      }
    } catch (error) {
      setStatusMessage(error.message)
    }
  }

  const stationList = filteredStations.filter((station) =>
    Number.isFinite(station.prices[selectedFuel]),
  )
  const adminCurrentStation = stations.find((station) => station.id === priceForm.stationId)

  const updateNotificationPreferences = (key, value) => {
    const nextPreferences = { ...notificationPreferences, [key]: value }
    setNotificationPreferences(nextPreferences)
    saveNotificationPreferences(nextPreferences)
  }

  const selectStationForComparison = (stationId) => {
    setCompareStationIds((currentIds) => {
      if (currentIds.includes(stationId)) return currentIds.filter((id) => id !== stationId)
      if (currentIds.length < 2) return [...currentIds, stationId]
      return [currentIds[1], stationId]
    })
  }

  const openNotification = (notification) => {
    const updatedNotifications = notifications.map((item) =>
      item.id === notification.id ? { ...item, read: true } : item,
    )
    setNotifications(updatedNotifications)
    saveNotifications(updatedNotifications)
    setSelectedStationId(notification.stationId)
    document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleMarkAllRead = () => {
    const updatedNotifications = markNotificationsRead()
    setNotifications(updatedNotifications)
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="brand-block">
          <a href="#inicio" className="brand-mark" aria-label="Gasolina GT, inicio">
            <img src="/brand-icon.svg" alt="" />
          </a>
          <div>
            <strong>Gasolina GT</strong>
            <small>Precios de combustibles · Huehuetenango</small>
          </div>
        </div>

        <button
          type="button"
          className="mobile-menu-button"
          aria-expanded={showMobileNav}
          onClick={() => setShowMobileNav((open) => !open)}
        >
          {showMobileNav ? 'Cerrar menú' : 'Menú'}
        </button>

        <nav
          className={`main-nav${showMobileNav ? ' main-nav-open' : ''}`}
          aria-label="Navegación principal"
        >
          {navigation.map((item) => (
            <a key={item.id} href={`#${item.id}`} onClick={() => setShowMobileNav(false)}>
              {item.label}
            </a>
          ))}
        </nav>

        <button
          type="button"
          className="notification-bell"
          aria-label={`${unreadCount} notificaciones sin leer`}
          onClick={() => document.getElementById('notificaciones')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <span aria-hidden="true">🔔</span>
          <span className="notification-count">{unreadCount}</span>
        </button>
      </header>

      <main className="container">
        <section id="inicio" className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">Huehuetenango, Guatemala</span>
            <h1>Encuentra tu próxima parada al mejor precio.</h1>
            <p>
              Explora estaciones de prueba en el mapa, compara combustibles y guarda tus favoritas
              desde un solo lugar.
            </p>
            <label className="home-search">
              <span className="sr-only">Buscar gasolineras</span>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={searchTerm}
                onChange={handleSearch}
                placeholder="Busca gasolinera, marca o zona..."
              />
            </label>
            <div className="action-row">
              <a href="#mapa" className="primary-button">
                Ver mapa
              </a>
              <a href="#comparar" className="secondary-button">
                Comparar precios
              </a>
              <a href="#notificaciones" className="text-action">
                <span aria-hidden="true">🔔</span> Notificaciones
                {unreadCount > 0 && <span className="small-count">{unreadCount}</span>}
              </a>
            </div>
          </div>

          <div className="hero-stats">
            <div className="demo-ribbon">MODO DEMOSTRACIÓN · DATOS FICTICIOS</div>
            <div className="stat-card">
              <span>Gasolineras</span>
              <strong>{stations.length}</strong>
            </div>
            <div className="stat-card">
              <span>Marcas</span>
              <strong>{brandSummary.length}</strong>
            </div>
            <div className="stat-card">
              <span>{fuelLabels[selectedFuel]} más económico · Demo</span>
              <strong>{cheapestStation ? formatMoney(cheapestStation.price) : 'Q0.00'}</strong>
              <small>{cheapestStation?.name ?? 'Sin resultados'}</small>
            </div>
          </div>
        </section>

        <section className="home-highlights" aria-label="Resumen de estaciones">
          <div className="highlight-heading">
            <div>
              <span className="section-tag">Para empezar</span>
              <h2>Estaciones destacadas</h2>
            </div>
            <a href="#mapa" className="inline-link">Ver todas</a>
          </div>
          <div className="featured-grid">
            {comparisonRows.slice(0, 3).map((station) => (
              <button
                className="featured-card"
                type="button"
                key={station.id}
                onClick={() => {
                  setSelectedStationId(station.id)
                  document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                <span className="featured-brand">{station.brand} <span>· Demo</span></span>
                <strong>{station.name}</strong>
                <span className="featured-price">{formatMoney(station.price)}<small> / galón</small></span>
                <span className="featured-place">{station.zone}, {station.municipality}</span>
              </button>
            ))}
          </div>
          {history.length > 0 && (
            <div className="recent-change">
              <span className="recent-icon" aria-hidden="true">↗</span>
              <div>
                <strong>Último cambio de demostración</strong>
                <p>
                  {history[0].stationName}: {fuelLabels[history[0].fuel]} de{' '}
                  {formatMoney(history[0].previousPrice)} a {formatMoney(history[0].newPrice)}
                </p>
              </div>
              <a href="#notificaciones">Ver alertas</a>
            </div>
          )}
        </section>

        <section id="mapa" className="section-card">
          <div className="section-heading">
            <div>
              <span className="section-tag">Mapa interactivo</span>
              <h2>Gasolineras en Huehuetenango</h2>
              <p className="section-description">Las estaciones, ubicaciones y precios visibles son datos ficticios para demostración.</p>
            </div>
            <div className="legend-inline">
              <span><i className="dot ok" /> Actualizado</span>
              <span><i className="dot warn" /> Revisar</span>
              <span><i className="dot bad" /> Antiguo</span>
            </div>
          </div>

          <div className="toolbar-row">
            <input
              type="search"
              value={searchTerm}
              onChange={handleSearch}
              placeholder="Buscar por nombre, marca, zona o municipio"
            />
            <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
              {brandOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              value={municipioFilter}
              onChange={(event) => setMunicipioFilter(event.target.value)}
            >
              {municipalityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
              {zoneOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'Todas' ? 'Todas las zonas' : option}
                </option>
              ))}
            </select>
            <select value={selectedFuel} onChange={(event) => setSelectedFuel(event.target.value)}>
              {Object.entries(fuelLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="map-layout">
            <div className="map-panel">
              <MapContainer center={[15.3149, -91.4753]} zoom={13} scrollWheelZoom className="map-view">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {stationList.map((station) => (
                  <CircleMarker
                    key={station.id}
                    center={[station.lat, station.lng]}
                    radius={9}
                    pathOptions={{
                      color: statusColors[station.status] ?? '#94a3b8',
                      fillColor: statusColors[station.status] ?? '#94a3b8',
                      fillOpacity: 0.9,
                    }}
                    eventHandlers={{ click: () => setSelectedStationId(station.id) }}
                  >
                    <Popup>
                      <div className="popup-card">
                        <strong>{station.name}</strong>
                        <span>{station.brand}</span>
                        <small>
                          {station.address} · {station.municipality}
                        </small>
                        <ul>
                          <li>Regular: {formatMoney(station.prices.regular)}</li>
                          <li>Superior: {formatMoney(station.prices.premium)}</li>
                          <li>Diésel: {formatMoney(station.prices.diesel)}</li>
                        </ul>
                        <div className="popup-actions">
                          <button type="button" onClick={() => setSelectedStationId(station.id)}>
                            Ver detalles
                          </button>
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Navegar
                          </a>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
              {stationList.length === 0 && (
                <div className="map-empty">No hay estaciones para esos filtros. Prueba otra marca, zona o combustible.</div>
              )}
            </div>

            <aside className="station-panel">
              {currentSelection && (
                <>
                  <span className="section-tag">Gasolinera seleccionada</span>
                  <h3>{currentSelection.name}</h3>
                  <span className="demo-chip">Estación ficticia · Demo</span>
                  <p className="station-meta">
                    {currentSelection.brand} · {currentSelection.municipality}
                  </p>
                  <ul className="station-prices">
                    <li>
                      <span>Gasolina superior</span>
                      <strong>{formatMoney(currentSelection.prices.premium)}</strong>
                    </li>
                    <li>
                      <span>Gasolina regular</span>
                      <strong>{formatMoney(currentSelection.prices.regular)}</strong>
                    </li>
                    <li>
                      <span>Diésel</span>
                      <strong>{formatMoney(currentSelection.prices.diesel)}</strong>
                    </li>
                  </ul>
                  <p className="address-line">
                    {currentSelection.address} · {currentSelection.zone}
                  </p>
                  <p className="updated-line">Última actualización: {formatDate(currentSelection.updatedAt)}</p>
                  <div className="detail-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleFavoriteToggle(currentSelection.id)}
                    >
                      {favorites.includes(currentSelection.id) ? 'Quitar favorito' : 'Agregar a favoritos'}
                    </button>
                    <a
                      className="inline-link"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${currentSelection.lat},${currentSelection.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir ubicación
                    </a>
                  </div>
                </>
              )}
            </aside>
          </div>
        </section>

        <section id="marcas" className="section-card">
          <div className="section-heading">
            <div>
              <span className="section-tag">Marcas</span>
              <h2>Gasolineras por marca</h2>
            </div>
          </div>

          <div className="brand-grid">
            {brandSummary.map((brand) => (
              <button
                type="button"
                key={brand.name}
                className="brand-card"
                onClick={() => {
                  setBrandFilter(brand.name)
                  setTimeout(() => {
                    document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth' })
                  }, 100)
                }}
              >
                <span className="brand-dot" style={{ background: brand.color }} />
                <strong>{brand.name}</strong>
                <small>{brand.quantity} estaciones registradas</small>
                <span className="card-link">Consultar ubicaciones</span>
              </button>
            ))}
          </div>
        </section>

        <section id="comparar" className="section-card">
          <div className="section-heading">
            <div>
              <span className="section-tag">Comparador · Datos de demostración</span>
              <h2>Precios por combustible</h2>
            </div>
          </div>

          <div className="compare-toolbar">
            <select value={selectedFuel} onChange={(event) => setSelectedFuel(event.target.value)}>
              {Object.entries(fuelLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
              {brandOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              value={municipioFilter}
              onChange={(event) => setMunicipioFilter(event.target.value)}
            >
              {municipalityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="asc">Menor a mayor precio</option>
              <option value="desc">Mayor a menor precio</option>
            </select>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comparar</th>
                  <th>Gasolinera</th>
                  <th>Marca</th>
                  <th>Ubicación</th>
                  <th>Precio</th>
                  <th>Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((station) => (
                  <tr key={station.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${station.name} en la comparación`}
                        checked={compareStationIds.includes(station.id)}
                        onChange={() => selectStationForComparison(station.id)}
                      />
                    </td>
                    <td>{station.name}</td>
                    <td>{station.brand}</td>
                    <td>{station.zone}, {station.municipality}</td>
                    <td>
                      {formatMoney(station.price)}
                      {station.id === cheapestStation?.id && <span className="best-price-tag">Más bajo</span>}
                    </td>
                    <td>{formatDate(station.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cheapestStation && (
            <div className="price-summary">
              <strong>Precio demo más económico:</strong> {cheapestStation.name} · {formatMoney(cheapestStation.price)} / galón
            </div>
          )}
          {comparisonSelection.length === 2 && (
            <div className="comparison-result">
              <strong>Diferencia entre estaciones seleccionadas</strong>
              <span>
                {comparisonSelection[0].name} ({formatMoney(comparisonSelection[0].prices[selectedFuel])}) y{' '}
                {comparisonSelection[1].name} ({formatMoney(comparisonSelection[1].prices[selectedFuel])}):
                {' '}<b>{formatMoney(comparisonDifference)} por galón</b>
              </span>
            </div>
          )}
          <p className="table-note">Máximo dos estaciones a la vez. Los precios son ficticios y no representan precios actuales.</p>
        </section>

        <section id="favoritos" className="section-card">
          <div className="section-heading">
            <div>
              <span className="section-tag">Favoritos</span>
              <h2>Estaciones guardadas</h2>
            </div>
          </div>

          <div className="favorite-grid">
            {favoriteStations.map((station) => (
              <article key={station.id} className="favorite-card">
                <div>
                  <strong>{station.name}</strong>
                  <small>
                    {station.brand} · {station.municipality}
                  </small>
                </div>
                <span>{formatMoney(station.prices.regular)} <small>/ galón · Demo</small></span>
                <div className="favorite-actions">
                  <button type="button" onClick={() => {
                    setSelectedStationId(station.id)
                    document.getElementById('mapa')?.scrollIntoView({ behavior: 'smooth' })
                  }}>
                    Ver detalle
                  </button>
                  <button type="button" className="remove-favorite" onClick={() => handleFavoriteToggle(station.id)}>
                    Quitar
                  </button>
                </div>
              </article>
            ))}
            {favoriteStations.length === 0 && (
              <p className="empty-state">Aún no hay favoritas. Usa «Agregar a favoritos» desde una estación.</p>
            )}
          </div>
        </section>

        <section id="notificaciones" className="section-card">
          <div className="section-heading">
            <div>
              <span className="section-tag">Notificaciones</span>
              <h2>Notificaciones <span className="unread-inline">{unreadCount} sin leer</span></h2>
            </div>
            <button type="button" className="secondary-button" onClick={handleMarkAllRead}>
              Marcar todas como leídas
            </button>
          </div>

          <div className="notification-settings">
            <div>
              <strong>Preferencias de alertas</strong>
              <small>Se guardan en este navegador. El envío push del servidor aún no está conectado.</small>
            </div>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={notificationPreferences.priceChanges}
                onChange={(event) => updateNotificationPreferences('priceChanges', event.target.checked)}
              />
              Avisos de cambios de precio
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={notificationPreferences.favoritesOnly}
                onChange={(event) => updateNotificationPreferences('favoritesOnly', event.target.checked)}
              />
              Solo gasolineras favoritas
            </label>
            <button type="button" className="secondary-button" onClick={handleWebPushPermission}>
              {notificationPermission === 'granted' ? 'Permiso del navegador activado' : 'Permitir aviso de demostración'}
            </button>
          </div>

          <div className="notification-list">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                className={`notification-item${notification.read ? ' notification-read' : ''}`}
                type="button"
                onClick={() => openNotification(notification)}
              >
                <span className={`chip ${notification.type === 'up' ? 'chip-up' : 'chip-down'}`}>
                  {notification.type === 'up' ? 'Subió' : 'Bajó'}
                </span>
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                  <small>{formatDate(notification.createdAt)} · Demostración</small>
                </div>
                {!notification.read && <span className="unread-dot" aria-label="Sin leer" />}
              </button>
            ))}
          </div>
          <p className="table-note">Los avisos de esta demo aparecen en la aplicación y, si concediste permiso, como una notificación del navegador mientras está abierta. No son notificaciones push del servidor ni se entregan con la aplicación cerrada.</p>
        </section>

        <section id="admin" className="section-card admin-panel">
          <div className="section-heading">
            <div>
              <span className="section-tag">Administración · Solo interfaz</span>
              <h2>Actualización de precios</h2>
            </div>
          </div>

          <div className="demo-admin-notice">
            <strong>Modo demostración</strong>
            <span>Estos cambios se guardan solo en este navegador. No hay autenticación ni conexión con el servidor.</span>
          </div>

          <form className="admin-form" onSubmit={handlePriceUpdate}>
            <label>
              Buscar gasolinera
              <input
                type="search"
                value={adminSearch}
                onChange={(event) => setAdminSearch(event.target.value)}
                placeholder="Nombre, marca o zona"
              />
            </label>
            <div className="field-row">
              <label>
                Gasolinera
                <select
                  value={priceForm.stationId}
                  onChange={(event) => {
                    const selected = stations.find((station) => station.id === event.target.value)
                    setPriceForm((previous) => ({
                      ...previous,
                      stationId: event.target.value,
                      newPrice: selected ? selected.prices[previous.fuel] : '',
                    }))
                  }}
                >
                  {adminStations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Combustible
                <select
                  value={priceForm.fuel}
                  onChange={(event) => {
                    const selected = stations.find((station) => station.id === priceForm.stationId)
                    setPriceForm((previous) => ({
                      ...previous,
                      fuel: event.target.value,
                      newPrice: selected ? selected.prices[event.target.value] : '',
                    }))
                  }}
                >
                  {Object.entries(fuelLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Precio actual
                <output className="current-price">
                  {adminCurrentStation ? formatMoney(adminCurrentStation.prices[priceForm.fuel]) : '—'}
                </output>
              </label>
            </div>

            <div className="field-row admin-price-row">
              <label>
                Nuevo precio por galón (Q)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={priceForm.newPrice}
                  onChange={(event) =>
                    setPriceForm((previous) => ({ ...previous, newPrice: event.target.value }))
                  }
                />
              </label>
              <div className="admin-submit">
                <button type="submit" className="primary-button">
                  Guardar cambios demo
                </button>
              </div>
            </div>
          </form>

          <div className="history-heading">
            <div>
              <span className="section-tag">Registro local</span>
              <h3>Historial de modificaciones</h3>
            </div>
          </div>
          {history.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Gasolinera</th>
                    <th>Combustible</th>
                    <th>Anterior</th>
                    <th>Nuevo</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((change) => (
                    <tr key={change.id}>
                      <td>{change.stationName}</td>
                      <td>{fuelLabels[change.fuel]}</td>
                      <td>{formatMoney(change.previousPrice)}</td>
                      <td>{formatMoney(change.newPrice)}</td>
                      <td>{formatDate(change.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">Todavía no se han guardado cambios en esta sesión de demostración.</p>
          )}
        </section>

        {statusMessage && <div className="status-banner">{statusMessage}</div>}
      </main>
    </div>
  )
}

export default App
