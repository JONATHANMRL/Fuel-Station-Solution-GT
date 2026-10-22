import { apiClient } from './apiClient.js'
import { requireAdminAccess } from './adminAuthService.js'
import { normalizeOracleId } from '../utils/oracleIdentity.js'
import { hasPrice } from '../utils/stationUtils.js'

const STORAGE_KEYS = {
  // New namespace: never equate hue-real-01/est-1 with Oracle station "1".
  favorites: 'gasolina-gt:oracle:favorites',
  notifications: 'gasolina-gt:notifications',
  history: 'gasolina-gt:history',
  preferences: 'gasolina-gt:notification-preferences',
}

function readLocal(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key)
    return stored ? JSON.parse(stored) : structuredClone(fallback)
  } catch {
    return structuredClone(fallback)
  }
}

function writeLocal(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function readRecords(key) {
  const stored = readLocal(key, [])
  return Array.isArray(stored) ? stored : []
}

// No catalogue cache, storage fallback, hard-coded IDs or direct Oracle access.
export const getStationSnapshot = (options) => apiClient.stations(options)
export async function getStations(options) { return (await getStationSnapshot(options)).stations }
export async function getBrands(options) { return (await apiClient.brands(options)).brands }
export async function getPrices(fuel, options = {}) { return (await apiClient.prices({ ...options, fuel })).prices }

const isLocalRecord = (record) => record && typeof record.stationId === 'string' &&
  record.stationId.trim() && !record.stationId.startsWith('est-') &&
  !record.isDemo && record.source !== 'demo'

// Existing local notices remain local. This phase never calls the demo API routes
// for history/notifications and never generates notices when fetching prices.
export function getHistory() {
  return readRecords(STORAGE_KEYS.history).filter((record) => isLocalRecord(record) && hasPrice(record.newPrice))
}

export function getNotifications() {
  return readRecords(STORAGE_KEYS.notifications).filter((record) => isLocalRecord(record) &&
    typeof record.title === 'string' && typeof record.message === 'string' &&
    !/demo|demostraci[oó]n|fictici/i.test(`${record.title} ${record.message}`))
}

export function saveNotifications(notifications) {
  writeLocal(STORAGE_KEYS.notifications, notifications.filter(isLocalRecord))
}

export function getFavorites() {
  return [...new Set(readRecords(STORAGE_KEYS.favorites).map(normalizeOracleId).filter(Boolean))]
}

export function getLegacyFavorites() {
  return [...new Set(readRecords('gasolina-gt:favorites').filter((id) =>
    typeof id === 'string' && id.startsWith('hue-real-')))]
}

export function saveFavorites(favorites) {
  // Keep IDs not present in the latest response; a failed/partial query must not erase favorites.
  writeLocal(STORAGE_KEYS.favorites, [...new Set(favorites.map(normalizeOracleId).filter(Boolean))])
}

export function getNotificationPreferences() {
  const stored = readLocal(STORAGE_KEYS.preferences, {})
  return {
    priceChanges: typeof stored?.priceChanges === 'boolean' ? stored.priceChanges : true,
    favoritesOnly: typeof stored?.favoritesOnly === 'boolean' ? stored.favoritesOnly : false,
  }
}

export function saveNotificationPreferences(preferences) {
  writeLocal(STORAGE_KEYS.preferences, preferences)
}

export function markNotificationsRead() {
  const notifications = getNotifications().map((notification) => ({ ...notification, read: true }))
  saveNotifications(notifications)
  return notifications
}

export function updatePrice() {
  // Remains fail-closed; no old local writer can become an accidental fallback.
  requireAdminAccess()
}
