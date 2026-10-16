import { demoNotifications, demoStations, defaultFavorites, fuelLabels } from '../data'

const STORAGE_KEYS = {
  stations: 'gasolina-gt:stations',
  favorites: 'gasolina-gt:favorites',
  notifications: 'gasolina-gt:notifications',
  history: 'gasolina-gt:history',
  preferences: 'gasolina-gt:notification-preferences',
}

const clone = (value) => JSON.parse(JSON.stringify(value))

function readLocal(key, fallback) {
  const stored = window.localStorage.getItem(key)
  if (!stored) return clone(fallback)

  try {
    return JSON.parse(stored)
  } catch (error) {
    console.error(`No se pudieron leer los datos locales de "${key}".`, error)
    return clone(fallback)
  }
}

function writeLocal(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function getStations() {
  return readLocal(STORAGE_KEYS.stations, demoStations)
}

export function getBrands() {
  const counts = new Map()
  for (const station of getStations()) {
    counts.set(station.brand, (counts.get(station.brand) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
}

export function getPrices(fuel) {
  return getStations()
    .filter((station) => Number.isFinite(station.prices[fuel]))
    .map((station) => ({
      stationId: station.id,
      stationName: station.name,
      brand: station.brand,
      municipality: station.municipality,
      zone: station.zone,
      fuel,
      price: station.prices[fuel],
      updatedAt: station.updatedAt,
    }))
}

export function getHistory() {
  return readLocal(STORAGE_KEYS.history, [])
}

export function getNotifications() {
  return readLocal(
    STORAGE_KEYS.notifications,
    demoNotifications.map((notification) => ({ ...notification, read: false, source: 'demo' })),
  )
}

export function saveNotifications(notifications) {
  writeLocal(STORAGE_KEYS.notifications, notifications)
}

export function getFavorites() {
  return readLocal(STORAGE_KEYS.favorites, defaultFavorites)
}

export function saveFavorites(favorites) {
  writeLocal(STORAGE_KEYS.favorites, favorites)
}

export function getNotificationPreferences() {
  return readLocal(STORAGE_KEYS.preferences, {
    priceChanges: true,
    favoritesOnly: false,
  })
}

export function saveNotificationPreferences(preferences) {
  writeLocal(STORAGE_KEYS.preferences, preferences)
}

export function markNotificationsRead() {
  const notifications = getNotifications().map((notification) => ({
    ...notification,
    read: true,
  }))
  saveNotifications(notifications)
  return notifications
}

export function updatePrice({ stationId, fuel, price }) {
  const nextPrice = Number(price)
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new Error('Ingresa un precio mayor que cero.')
  }

  const stations = getStations()
  const station = stations.find((item) => item.id === stationId)
  if (!station) throw new Error('No se encontró la gasolinera seleccionada.')
  if (!Object.hasOwn(station.prices, fuel)) throw new Error('Selecciona un combustible válido.')

  const previousPrice = station.prices[fuel]
  if (Number(previousPrice.toFixed(2)) === Number(nextPrice.toFixed(2))) {
    return { changed: false, station, previousPrice }
  }

  const updatedAt = new Date().toISOString()
  station.prices[fuel] = Number(nextPrice.toFixed(2))
  station.updatedAt = updatedAt
  station.status = 'updated'
  writeLocal(STORAGE_KEYS.stations, stations)

  const change = {
    id: `change-${Date.now()}`,
    stationId,
    stationName: station.name,
    brand: station.brand,
    fuel,
    previousPrice,
    newPrice: station.prices[fuel],
    updatedAt,
    source: 'demo',
  }
  writeLocal(STORAGE_KEYS.history, [change, ...getHistory()])

  const notification = {
    id: `notif-${Date.now()}`,
    title: 'Gasolina GT · Cambio de precio (demo)',
    message: `${station.name}: ${fuelLabels[fuel]} pasó de Q${previousPrice.toFixed(2)} a Q${station.prices[fuel].toFixed(2)} por galón.`,
    fuel,
    type: station.prices[fuel] > previousPrice ? 'up' : 'down',
    stationId,
    createdAt: updatedAt,
    read: false,
    source: 'demo',
  }
  writeLocal(STORAGE_KEYS.notifications, [notification, ...getNotifications()])

  return { changed: true, station, previousPrice, notification, change }
}
