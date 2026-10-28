import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import { fuelLabels } from './data'
import AdminAccessGate from './components/AdminAccessGate'
import AdminWorkspace from './components/AdminWorkspace'
import PublicPriceAlerts from './components/PublicPriceAlerts.jsx'
import AdminSessionProvider from './components/AdminSessionProvider.jsx'
import StationMapMarker from './components/StationMapMarker.jsx'
import { useAdminSession } from './hooks/useAdminSession.js'
import useOracleNotifications from './hooks/useOracleNotifications.js'
import { markOracleNotificationRead } from './services/oracleOperationsService.js'
import MapBrandLegend from './components/MapBrandLegend'
import { navigation, navigationLabel } from './config/navigation.js'
import { buildMapMarkers } from './utils/mapPresentation.js'
import { comparePrices, getAvailabilityLabel, getCheapestStation, getPriceDifference, hasAvailablePrice, hasPrice } from './utils/stationUtils'
import useStationData from './hooks/useStationData'
import {
  getFavorites,
  getHistory,
  getLegacyFavorites,
  getNotificationPreferences,
  getNotifications,
  saveFavorites,
  saveNotifications,
  saveNotificationPreferences,
} from './services/gasolinaService'
import './App.css'

function getSectionFromHash() {
  const section = window.location.hash.slice(1)
  return navigation.some((item) => item.id === section) ? section : 'inicio'
}

// Leaflet needs its container dimensions after a hidden screen becomes visible.
function MapScreenLayout({ active, selectedStationId, markerLayout, selectedPositionKey }) {
  const map = useMap()
  const lastFittedLayout = useRef('')
  useEffect(() => {
    if (!active) return
    let frame
    const resize = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        map.invalidateSize({ pan: false })
        if (selectedPositionKey) map.panInside(JSON.parse(selectedPositionKey), { padding: [40, 45], animate: false })
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(map.getContainer())
    resize()
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [active, map, selectedPositionKey])
  useEffect(() => {
    if (!active) { lastFittedLayout.current = ''; return }
    const positions = JSON.parse(markerLayout)
    if (positions.length && lastFittedLayout.current !== markerLayout) {
      map.invalidateSize({ pan: false })
      map.fitBounds(positions, { padding: [40, 45], maxZoom: 14, animate: false })
      lastFittedLayout.current = markerLayout
    }
  }, [active, map, markerLayout])
  useEffect(() => {
    if (!selectedStationId) map.closePopup()
  }, [selectedStationId, map])
  return null
}

const currency = new Intl.NumberFormat('es-GT', {
  style: 'currency',
  currency: 'GTQ',
  minimumFractionDigits: 2,
})

const formatMoney = (value) => hasPrice(value) ? currency.format(value) : 'Precio no disponible'
const formatLocation = (station) => station.zone && station.zone !== 'Por verificar'
  ? `${station.zone}, ${station.municipality}` : station.municipality
const formatDate = (value) =>
  value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('es-GT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }) : 'Fecha no disponible'

const brandColors = {
  Shell: '#f7d35b',
  Puma: '#1fbf75',
  Texaco: '#ef4444',
  Independiente: '#14b8a6',
  Total: '#f59e0b',
  Mobil: '#60a5fa',
  default: '#94a3b8',
}

function Icon({ name, ...props }) {
  const paths = {
    inicio: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
    mapa: 'm9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Zm0 0V3m6 3v15',
    marcas: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    comparar: 'M5 20V10m7 10V4m7 16v-7M3 20h18',
    favoritos: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
    notificaciones: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    admin: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-3 9 2 2 4-4',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    fuel: 'M4 21V4h10v17M2 21h14M7 7h4v5H7zM14 10h3v7a2 2 0 0 0 4 0V8l-3-3',
    location: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={paths[name] ?? paths.fuel} />
    </svg>
  )
}

function Application() {
  const initialComparison = useRef(false)
  const { session } = useAdminSession()
  const [legacyFavoriteCount] = useState(() => getLegacyFavorites().length)
  const [selectedFuel, setSelectedFuel] = useState('regular')
  const [brandFilter, setBrandFilter] = useState('Todas')
  const [municipioFilter, setMunicipioFilter] = useState('Todos')
  const [zoneFilter, setZoneFilter] = useState('Todas')
  const [searchTerm, setSearchTerm] = useState('')
  const [favorites, setFavorites] = useState(getFavorites)
  const [localNotifications, setLocalNotifications] = useState(getNotifications)
  const oracleNotices = useOracleNotifications()
  const [history] = useState(getHistory)
  const [notificationPreferences, setNotificationPreferences] =
    useState(getNotificationPreferences)
  const [selectedStationId, setSelectedStationId] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [notificationPermission, setNotificationPermission] = useState('default')
  const [sortOrder, setSortOrder] = useState('asc')
  const [compareStationIds, setCompareStationIds] = useState([])
  const [showMobileNav, setShowMobileNav] = useState(false)
  const [activeSection, setActiveSection] = useState(getSectionFromHash)

  const onStationsLoaded = useCallback((loadedStations) => {
    const ids = new Set(loadedStations.map((station) => station.id))
    setSelectedStationId((id) => ids.has(id) ? id : null)
    if (!initialComparison.current) {
      initialComparison.current = true
      setCompareStationIds(loadedStations.filter((station) => hasAvailablePrice(station, 'regular')).slice(0, 2).map((station) => station.id))
    } else {
      setCompareStationIds((current) => current.filter((id) => ids.has(id)))
    }
    setBrandFilter((value) => value === 'Todas' || loadedStations.some((s) => s.brand === value) ? value : 'Todas')
    setMunicipioFilter((value) => value === 'Todos' || loadedStations.some((s) => s.municipality === value) ? value : 'Todos')
    setZoneFilter((value) => value === 'Todas' || loadedStations.some((s) => s.zone === value) ? value : 'Todas')
  }, [])
  const { stations, status: loadStatus, error: loadError, fetchedAt, refresh } = useStationData(onStationsLoaded)

  useEffect(() => {
    const handleHashChange = () => {
      const section = getSectionFromHash()
      setActiveSection(section)
      if (section !== 'mapa') setSelectedStationId(null)
      setShowMobileNav(false)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [activeSection])

  const navigateTo = (section) => {
    if (section !== 'mapa') setSelectedStationId(null)
    setActiveSection(section)
    setShowMobileNav(false)
    window.location.assign(`#${section}`)
  }

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
        available: hasAvailablePrice(station, selectedFuel),
      }))
      .sort((a, b) => comparePrices(a, b, sortOrder))
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

    return [...groups.entries()].map(([name, quantity]) => {
      const members = stations.filter((station) => station.brand === name)
      return {
        name,
        quantity,
        stations: members,
        color: brandColors[name === 'Puma Energy' ? 'Puma' : name] ?? brandColors.default,
      }
    })
  }, [stations])

  const cheapestStation = getCheapestStation(comparisonRows)
  const comparisonSelection = stations.filter((station) => compareStationIds.includes(station.id) && hasAvailablePrice(station, selectedFuel))
  const comparisonDifference = getPriceDifference(comparisonSelection, selectedFuel)
  const stationList = useMemo(() => buildMapMarkers(filteredStations), [filteredStations])
  const selectedMarker = stationList.find((marker) => marker.id === selectedStationId)
  const currentSelection = selectedMarker?.station
  const markerLayout = JSON.stringify(stationList.map(({ position }) => [position.lat, position.lng]))
  const selectedPositionKey = selectedMarker ? JSON.stringify([selectedMarker.position.lat, selectedMarker.position.lng]) : ''
  const notifications = oracleNotices.notifications.filter((notice) => notificationPreferences.priceChanges &&
    (!notificationPreferences.favoritesOnly || favorites.includes(notice.stationId)))
  const unreadCount = notifications.filter((notification) => !notification.read).length

  const handleSearch = (event) => setSearchTerm(event.target.value)

  const handleFavoriteToggle = (stationId) => {
    const nextFavorites = favorites.includes(stationId)
      ? favorites.filter((id) => id !== stationId)
      : [...favorites, stationId]
    try {
      saveFavorites(nextFavorites)
      setFavorites(nextFavorites)
    } catch {
      setStatusMessage('No fue posible guardar los favoritos en este equipo.')
    }
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
          'Notificaciones activadas.',
        )
        return
      }

      setStatusMessage('Se requieren permisos para recibir alertas de precios.')
    } catch (error) {
      console.error('No se pudo solicitar permiso para notificaciones del navegador.', error)
      setStatusMessage('No fue posible solicitar el permiso de notificaciones en este navegador.')
    }
  }


  const updateNotificationPreferences = (key, value) => {
    const nextPreferences = { ...notificationPreferences, [key]: value }
    setNotificationPreferences(nextPreferences)
    saveNotificationPreferences(nextPreferences)
  }

  const selectStationForComparison = (stationId) => {
    const availableIds = new Set(stations.filter((station) => hasAvailablePrice(station, selectedFuel)).map((station) => station.id))
    if (!availableIds.has(stationId)) return
    setCompareStationIds((currentIds) => {
      const validIds = currentIds.filter((id) => availableIds.has(id))
      if (validIds.includes(stationId)) return validIds.filter((id) => id !== stationId)
      if (validIds.length < 2) return [...validIds, stationId]
      return [validIds[1], stationId]
    })
  }

  const openNotification = async (notification) => {
    try {
      await markOracleNotificationRead(notification.id)
      await oracleNotices.refresh()
    } catch (error) { setStatusMessage(error.message); return }
    if (stations.some((station) => station.id === notification.stationId)) {
      setSelectedStationId(notification.stationId)
      navigateTo('mapa')
    } else {
      setStatusMessage('La estación de este aviso no está en el catálogo consultado. No se asignará a otra estación.')
    }
  }

  const handleMarkAllRead = async () => {
    try {
      // Only the loaded, visible page(s), never another user's records.
      for (const notice of notifications.filter((item) => !item.read)) await markOracleNotificationRead(notice.id)
    } catch (error) { setStatusMessage(error.message) }
    finally { await oracleNotices.refresh() }
  }

  return (
    <div className="page-shell">
      <aside className="sidebar" aria-label="Menú de la aplicación">
        <div className="brand-block">
          <a href="#inicio" className="brand-mark" aria-label="Fuel Station Solution GT, inicio">
            <img src="/brand-icon.svg" alt="" />
          </a>
          <div>
            <strong>Fuel Station <span>Solution GT</span></strong>
            <small>Soluciones en combustible</small>
          </div>
        </div>

        <span className="nav-caption">EXPLORAR</span>
        <nav
          id="main-navigation"
          className={`main-nav${showMobileNav ? ' main-nav-open' : ''}`}
          aria-label="Navegación principal"
        >
          {navigation.map((item) => (
            <a key={item.id} href={`#${item.id}`} className={item.id === 'admin' ? 'admin-access-link' : undefined}
              aria-current={activeSection === item.id ? 'page' : undefined}
              onClick={() => {
                if (item.id === 'mapa') setSelectedStationId(null)
                navigateTo(item.id)
              }}>
              <Icon name={item.id} /><span>{navigationLabel(item, session)}</span>
              {item.id === 'notificaciones' && unreadCount > 0 && <span className="nav-count">{unreadCount}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Icon name="location" />
          <div><strong>Huehuetenango</strong><small>Guatemala</small></div>
        </div>
      </aside>

      <header className="topbar">
        <div className="topbar-title">
          <span className="topbar-eyebrow">FUEL STATION SOLUTION GT</span>
          <strong>Tu próxima parada, mejor informada.</strong>
        </div>
        <div className="topbar-actions">
          <span className="workspace-badge">Huehuetenango, Guatemala</span>
          <button type="button" className="secondary-button" onClick={refresh} disabled={loadStatus === 'loading'}>
            {loadStatus === 'loading' ? 'Consultando…' : loadStatus === 'error' ? 'Reintentar' : 'Actualizar'}
          </button>
          <button type="button" className="mobile-menu-button" aria-controls="main-navigation"
            aria-expanded={showMobileNav} onClick={() => setShowMobileNav((open) => !open)}>
            {showMobileNav ? 'Cerrar menú' : 'Menú'}
          </button>
          <button
            type="button"
            className="notification-bell"
            aria-label={`${unreadCount} notificaciones sin leer`}
            onClick={() => navigateTo('notificaciones')}
          >
            <Icon name="notificaciones" />
            {unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
          </button>
        </div>
      </header>

      <main id="main-content" className="container" data-view={activeSection} tabIndex={-1}>
        <div className="api-status status-banner" role={loadStatus === 'error' ? 'alert' : 'status'} aria-live="polite">
          {loadStatus === 'loading' && 'Consultando estaciones y precios…'}
          {loadStatus === 'error' && loadError}
          {loadStatus === 'ready' && `${stations.length} gasolineras · Actualizado: ${formatDate(fetchedAt)}`}
        </div>
        <section id="inicio" className="hero-panel" hidden={activeSection !== 'inicio'}>
          <div className="hero-copy">
            <span className="eyebrow">Huehuetenango, Guatemala</span>
            <h1>Encuentra tu próxima parada al mejor precio.</h1>
            <p>
              Explora el catálogo de estaciones en el mapa, compara combustibles y guarda tus favoritas
              desde un solo lugar.
            </p>
            <label className="home-search">
              <span className="sr-only">Buscar gasolineras</span>
              <Icon name="search" />
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
                <Icon name="notificaciones" /> Notificaciones
                {unreadCount > 0 && <span className="small-count">{unreadCount}</span>}
              </a>
            </div>
          </div>

          <div className="hero-stats">
            <div className="stat-card">
              <span>Gasolineras</span>
              <strong>{loadStatus === 'ready' ? stations.length : '—'}</strong>
            </div>
            <div className="stat-card">
              <span>Marcas</span>
              <strong>{loadStatus === 'ready' ? brandSummary.length : '—'}</strong>
            </div>
            <div className="stat-card">
              <span>{fuelLabels[selectedFuel]} más económico</span>
              <strong className={!cheapestStation ? 'price-unavailable' : undefined}>{cheapestStation ? formatMoney(cheapestStation.price) : 'Precio no disponible'}</strong>
              <small>{cheapestStation?.name ?? 'Por galón'}</small>
            </div>
          </div>
        </section>

        <section className="home-highlights" aria-label="Resumen de estaciones" hidden={activeSection !== 'inicio'}>
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
                  navigateTo('mapa')
                }}
              >
                <span className="featured-brand">{station.brand}</span>
                <strong>{station.name}</strong>
                <span className={`featured-price${station.id === cheapestStation?.id ? ' price-favorable' : ''}${!hasPrice(station.price) ? ' price-unavailable' : ''}`}>{formatMoney(station.price)}{hasPrice(station.price) && <small> / galón</small>}</span>
                <small>{getAvailabilityLabel(station, selectedFuel)}</small>
                <span className="featured-place">{formatLocation(station)}</span>
              </button>
            ))}
            {comparisonRows.length === 0 && <p className="empty-state">No se encontraron gasolineras.</p>}
          </div>
          {history.length > 0 && stations.some((station) => station.id === history[0].stationId) && (
            <div className="recent-change">
              <span className="recent-icon" aria-hidden="true">↗</span>
              <div>
                <strong>Archivo local de precios · referencia anterior</strong>
                <p>
                  {history[0].stationName}: {fuelLabels[history[0].fuel]} de{' '}
                  {formatMoney(history[0].previousPrice)} a {formatMoney(history[0].newPrice)}
                </p>
              </div>
              <a href="#notificaciones">Ver alertas</a>
            </div>
          )}
        </section>

        <section id="mapa" className="section-card" hidden={activeSection !== 'mapa'}>
          <div className="section-heading">
            <div>
              <span className="section-tag">Mapa interactivo</span>
              <h2>Explorar gasolineras</h2>
              <p className="section-description">Selecciona una gasolinera para consultar sus precios.</p>
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

          <div className="map-tools">
            <span className="table-note">{stationList.length} gasolineras en el mapa</span>
            <button type="button" className="secondary-button" onClick={() => {
              setSearchTerm(''); setBrandFilter('Todas'); setMunicipioFilter('Todos'); setZoneFilter('Todas')
            }}>Mostrar todas</button>
          </div>
          <div className={`map-layout${currentSelection ? ' has-selection' : ''}`}>
            <div className="map-panel">
              <MapContainer center={[15.3149, -91.4753]} zoom={13} scrollWheelZoom className="map-view">
                <MapScreenLayout active={activeSection === 'mapa'} selectedStationId={currentSelection?.id}
                  markerLayout={markerLayout} selectedPositionKey={selectedPositionKey} />
                <MapBrandLegend stations={stationList.map(({ station, position }) => ({ brand: station.brand, lat: position.lat, lng: position.lng }))} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {stationList.map((marker) => <StationMapMarker key={marker.id} marker={marker}
                  selected={marker.id === selectedStationId} onSelect={setSelectedStationId} formatMoney={formatMoney} />)}
              </MapContainer>
              {stationList.length === 0 && (
                <div className="map-empty">{loadStatus === 'loading' ? 'Cargando gasolineras…' : loadStatus === 'error' ? 'No fue posible cargar las gasolineras. Intenta actualizar.' : 'No se encontraron gasolineras con estos filtros.'}</div>
              )}
            </div>

            {currentSelection && (
              <aside className="station-panel" aria-labelledby="selected-station-title">
                  <button type="button" className="secondary-button station-panel-close"
                    aria-label="Cerrar información de la gasolinera" title="Cerrar información"
                    onClick={() => setSelectedStationId(null)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                  </button>
                  <span className="section-tag">Gasolinera seleccionada</span>
                  <h3 id="selected-station-title">{currentSelection.name}</h3>
                  <span className="status-chip">{currentSelection.stationStatus === 'ACTIVA' ? 'Activa' : 'Inactiva'}</span>
                  <p className="station-meta">
                    {currentSelection.brand} · {currentSelection.municipality}
                  </p>
                  <ul className="station-prices">
                    <li className="fuel-premium">
                      <span>Gasolina superior · {getAvailabilityLabel(currentSelection, 'premium')}</span>
                      <strong className={!hasPrice(currentSelection.prices.premium) ? 'price-unavailable' : undefined}>{formatMoney(currentSelection.prices.premium)}</strong>
                    </li>
                    <li className="fuel-regular">
                      <span>Gasolina regular · {getAvailabilityLabel(currentSelection, 'regular')}</span>
                      <strong className={!hasPrice(currentSelection.prices.regular) ? 'price-unavailable' : undefined}>{formatMoney(currentSelection.prices.regular)}</strong>
                    </li>
                    <li className="fuel-diesel">
                      <span>Diésel · {getAvailabilityLabel(currentSelection, 'diesel')}</span>
                      <strong className={!hasPrice(currentSelection.prices.diesel) ? 'price-unavailable' : undefined}>{formatMoney(currentSelection.prices.diesel)}</strong>
                    </li>
                  </ul>
                  <p className="address-line">
                    {currentSelection.address}{currentSelection.zone !== 'Por verificar' && ` · ${currentSelection.zone}`}
                  </p>
                  <p className="updated-line">Última actualización: {formatDate(currentSelection.updatedAt)}</p>
                  {currentSelection.sources?.[0] && <a className="inline-link" href={currentSelection.sources[0]} target="_blank" rel="noreferrer">Más información</a>}
                  <div className="detail-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleFavoriteToggle(currentSelection.id)}
                    >
                      {favorites.includes(currentSelection.id) ? 'Quitar favorito' : 'Agregar a favoritos'}
                    </button>

                  </div>
              </aside>
            )}
          </div>
          {filteredStations.length > 0 && (
            <div className="admin-history">
              <div className="history-heading"><div><span className="section-tag">Gasolineras</span><h3>{filteredStations.length} estaciones</h3></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Gasolinera</th><th>Marca</th><th>Dirección o referencia</th><th>Detalle</th></tr></thead>
                  <tbody>{filteredStations.map((station) => (
                    <tr key={station.id} className={station.id === selectedStationId ? 'map-station-selected' : undefined}><td>{station.name}</td><td>{station.brand}</td><td>{station.address}</td><td><button type="button" className="secondary-button" aria-pressed={station.id === selectedStationId} onClick={() => setSelectedStationId(station.id)}>Ver detalle</button></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section id="marcas" className="section-card" hidden={activeSection !== 'marcas'}>
          <div className="section-heading">
            <div>
              <span className="section-tag">Marcas</span>
              <h2>Gasolineras por marca</h2>
              <p className="section-description">{brandSummary.length} marcas · {stations.length} estaciones registradas.</p>
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
                  setSearchTerm('')
                  setMunicipioFilter('Todos')
                  setZoneFilter('Todas')
                  setSelectedStationId(brand.stations[0]?.id)
                  navigateTo('mapa')
                }}
              >
                <span className="brand-dot" style={{ background: brand.color }} />
                <strong>{brand.name}</strong>
                <small>{brand.quantity} estaciones registradas</small>
                <span className="card-link">Ver gasolineras</span>
              </button>
            ))}
          </div>
          <div className="admin-history">
            <div className="history-heading">
              <div><span className="section-tag">Catálogo por marca</span><h3>Estaciones registradas</h3></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Marca</th><th>Gasolinera</th><th>Zona o referencia</th><th>Estado</th><th>Detalle</th></tr></thead>
                <tbody>
                  {brandSummary.flatMap((brand) => brand.stations.map((station) => (
                    <tr key={station.id}>
                      <td>{brand.name}</td>
                      <td>{station.name}</td>
                      <td>{formatLocation(station)}</td>
                      <td>{station.stationStatus === 'ACTIVA' ? 'Activa' : 'Inactiva'}</td>
                      <td><button type="button" className="secondary-button" onClick={() => {
                        setSelectedStationId(station.id)
                        setBrandFilter(station.brand)
                        setSearchTerm('')
                        setMunicipioFilter('Todos')
                        setZoneFilter('Todas')
                        navigateTo('mapa')
                      }}>Ver detalle</button></td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="comparar" className="section-card" hidden={activeSection !== 'comparar'}>
          <div className="section-heading">
            <div>
              <span className="section-tag">Comparador</span>
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
                  <th>Disponibilidad</th>
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
                        checked={station.available && compareStationIds.includes(station.id)}
                        disabled={!station.available}
                        title={!station.available ? 'Combustible sin precio disponible para comparar' : undefined}
                        onChange={() => selectStationForComparison(station.id)}
                      />
                    </td>
                    <td>{station.name}</td>
                    <td>{station.brand}</td>
                    <td>{formatLocation(station)}</td>
                    <td className={station.id === cheapestStation?.id ? 'price-favorable' : undefined}>
                      {formatMoney(station.price)}
                      {station.id === cheapestStation?.id && <span className="best-price-tag">Más bajo</span>}
                    </td>
                    <td>{getAvailabilityLabel(station, selectedFuel)}</td>
                    <td>{formatDate(station.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cheapestStation && (
            <div className="price-summary">
              <strong>Precio más económico:</strong> {cheapestStation.name} · {formatMoney(cheapestStation.price)} / galón
            </div>
          )}
          {comparisonDifference !== null && (
            <div className="comparison-result">
              <strong>Diferencia entre estaciones seleccionadas</strong>
              <span>
                {comparisonSelection[0].name} ({formatMoney(comparisonSelection[0].prices[selectedFuel])}) y{' '}
                {comparisonSelection[1].name} ({formatMoney(comparisonSelection[1].prices[selectedFuel])}):
                {' '}<b>{currency.format(comparisonDifference)} por galón</b>
              </span>
            </div>
          )}
          {compareStationIds.length > comparisonSelection.length && <p className="table-note">Una selección anterior no participa: falta un precio disponible o el combustible está agotado.</p>}
          <p className="table-note">Selecciona hasta dos estaciones activas con combustible disponible. Los precios de combustibles agotados se muestran como referencia y no se comparan.</p>
        </section>

        <section id="favoritos" className="section-card" hidden={activeSection !== 'favoritos'}>
          <div className="section-heading">
            <div>
              <span className="section-tag">Favoritos</span>
              <h2>Estaciones guardadas</h2>
            </div>
          </div>

          {legacyFavoriteCount > 0 && <p className="table-note">Tus favoritos anteriores siguen guardados. Selecciona de nuevo tus estaciones del catálogo actual.</p>}
          <div className="favorite-grid">
            {favoriteStations.map((station) => (
              <article key={station.id} className="favorite-card">
                <div>
                  <strong>{station.name}</strong>
                  <small>
                    {station.brand} · {station.municipality}
                  </small>
                </div>
                <span className={!hasPrice(station.prices.regular) ? 'price-unavailable' : undefined}>{formatMoney(station.prices.regular)}{hasPrice(station.prices.regular) && <small> / galón</small>}</span>
                <small>{getAvailabilityLabel(station, 'regular')}</small>
                <div className="favorite-actions">
                  <button type="button" onClick={() => {
                    setSelectedStationId(station.id)
                    navigateTo('mapa')
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

        <section id="notificaciones" className="section-card" hidden={activeSection !== 'notificaciones'}>
          <div className="section-heading">
            <div>
              <span className="section-tag">Notificaciones</span>
              <h2>Notificaciones {unreadCount > 0 && <span className="unread-inline">{unreadCount} sin leer</span>}</h2>
            </div>
          </div>

          <PublicPriceAlerts active={activeSection === 'notificaciones'} />

          <div className="section-heading">
            <div><h3>Mis notificaciones</h3><p className="table-note">Avisos personales de la cuenta autenticada.</p></div>
            <button type="button" className="secondary-button" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
              Marcar avisos visibles como leídos
            </button>
          </div>

          <p className="table-note">Consulta los avisos de tu cuenta.</p>
          {!oracleNotices.signedIn && <p className="table-note">Los avisos personales requieren iniciar sesión mediante Acceso administrativo. Los avisos generales están disponibles para todos.</p>}
          {oracleNotices.error && <p className="status-banner" role="alert">{oracleNotices.error}</p>}
          <button type="button" className="secondary-button" disabled={!oracleNotices.signedIn || oracleNotices.loading} onClick={oracleNotices.refresh}>Actualizar avisos</button>
          <div className="notification-settings">
            <div>
              <strong>Preferencias de visualización</strong>
              <small>Elige qué avisos personales mostrar en este equipo.</small>
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
              {notificationPermission === 'granted' ? 'Notificaciones activadas' : 'Activar notificaciones'}
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
                  {notification.type === 'new' ? 'Primer precio' : notification.type === 'up' ? 'Subió' : 'Bajó'}
                </span>
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                  <small>{formatDate(notification.createdAt)}</small>
                </div>
                {!notification.read && <span className="unread-dot" aria-label="Sin leer" />}
              </button>
            ))}
          </div>
          {notifications.length === 0 && <p className="empty-state">No tienes notificaciones.</p>}
          {oracleNotices.hasMore && <button className="secondary-button" type="button" disabled={oracleNotices.loading} onClick={oracleNotices.more}>Cargar más avisos</button>}
          {localNotifications.length > 0 && <details>
            <summary>Avisos archivados en este equipo ({localNotifications.length})</summary>
            <button className="secondary-button" type="button" onClick={() => {
              const next = localNotifications.map((notice) => ({ ...notice, read: true }))
              try { saveNotifications(next); setLocalNotifications(next) } catch { setStatusMessage('No fue posible guardar el archivo local.') }
            }}>Marcar archivo local como leído</button>
            {localNotifications.map((notice) => <p key={notice.id}><strong>{notice.title}</strong> · {notice.message}</p>)}
          </details>}
        </section>

        <section id="admin" className="section-card admin-panel" hidden={activeSection !== 'admin'}>
          <div className="section-heading">
            <div>
              <span className="section-tag">Administración</span>
              <h2>{session ? 'Panel de administración' : 'Acceso administrativo'}</h2>
            </div>
          </div>

          {activeSection === 'admin' && <AdminAccessGate>
            <AdminWorkspace stations={stations} onSaved={refresh} />
          </AdminAccessGate>}
        </section>

        {statusMessage && <div className="status-banner">{statusMessage}</div>}
      </main>
    </div>
  )
}

export default function App() {
  return <AdminSessionProvider><Application /></AdminSessionProvider>
}
