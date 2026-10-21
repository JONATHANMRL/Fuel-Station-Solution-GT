import { fuelLabels } from '../data'
import { requireAdminAccess } from './adminAuthService'
import { realStations } from '../realStations'
import { hasPrice } from '../utils/stationUtils'

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
  const stored = readLocal(STORAGE_KEYS.stations, [])
  const saved = new Map((Array.isArray(stored) ? stored : [])
    .filter((station) => station && !station.isDemo && station.source !== 'demo')
    .map((station) => [station.id, station]))
  return realStations.map((station) => {
    const previous = saved.get(station.id)
    if (!previous) return clone(station)
    const prices = Object.fromEntries(Object.keys(fuelLabels).map((fuel) =>
      [fuel, hasPrice(previous.prices?.[fuel]) ? previous.prices[fuel] : station.prices[fuel]]))
    return { ...clone(station), prices, updatedAt: Object.values(prices).some(hasPrice) ? previous.updatedAt ?? null : null }
  })
}

const stationIds = new Set(realStations.map((station) => station.id))
const isCatalogRecord = (record) => record && stationIds.has(record.stationId) &&
  !record.isDemo && record.source !== 'demo'

function readRecords(key) {
  const stored = readLocal(key, [])
  return Array.isArray(stored) ? stored : []
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
    .filter((station) => hasPrice(station.prices[fuel]))
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
  return readRecords(STORAGE_KEYS.history).filter((record) => isCatalogRecord(record) && hasPrice(record.newPrice))
}

export function getNotifications() {
  return readRecords(STORAGE_KEYS.notifications).filter((record) => isCatalogRecord(record) &&
    typeof record.title === 'string' && typeof record.message === 'string' &&
    !/demo|demostraci[oó]n|fictici/i.test(`${record.title} ${record.message}`))
}

export function saveNotifications(notifications) {
  writeLocal(STORAGE_KEYS.notifications, notifications.filter(isCatalogRecord))
}

export function getFavorites() {
  return [...new Set(readRecords(STORAGE_KEYS.favorites).filter((id) => stationIds.has(id)))]
}

export function saveFavorites(favorites) {
  writeLocal(STORAGE_KEYS.favorites, [...new Set(favorites.filter((id) => stationIds.has(id)))])
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
  requireAdminAccess()
  const nextPrice = Number(price)
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new Error('Ingresa un precio mayor que cero.')
  }

  const stations = getStations()
  const station = stations.find((item) => item.id === stationId)
  if (!station) throw new Error('No se encontró la gasolinera seleccionada.')
  if (!Object.hasOwn(station.prices, fuel)) throw new Error('Selecciona un combustible válido.')

  const previousPrice = station.prices[fuel]
  if (hasPrice(previousPrice) && Number(previousPrice.toFixed(2)) === Number(nextPrice.toFixed(2))) {
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
    source: 'local',
  }
  writeLocal(STORAGE_KEYS.history, [change, ...getHistory()])

  const notification = {
    id: `notif-${Date.now()}`,
    title: 'Fuel Station Solution GT · Cambio de precio',
    message: hasPrice(previousPrice)
      ? `${station.name}: ${fuelLabels[fuel]} pasó de Q${previousPrice.toFixed(2)} a Q${station.prices[fuel].toFixed(2)} por galón.`
      : `${station.name}: primer precio registrado de ${fuelLabels[fuel]}, Q${station.prices[fuel].toFixed(2)} por galón. Precio anterior no disponible.`,
    fuel,
    type: !hasPrice(previousPrice) ? 'new' : station.prices[fuel] > previousPrice ? 'up' : 'down',
    stationId,
    createdAt: updatedAt,
    read: false,
    source: 'local',
  }
  writeLocal(STORAGE_KEYS.notifications, [notification, ...getNotifications()])

  return { changed: true, station, previousPrice, notification, change }
}
