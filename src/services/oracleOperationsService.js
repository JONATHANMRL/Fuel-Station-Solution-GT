import { apiClient, ApiError } from './apiClient.js'
import { normalizeOracleId } from '../utils/oracleIdentity.js'

const invalid = () => new ApiError('INVALID_RESPONSE', 'Oracle devolvió datos de operaciones incompatibles.')
const positive = (price) => Number.isFinite(price) && price > 0 && price <= 999999.99
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const fuels = ['regular', 'premium', 'diesel']

function rows(data, key, validate) {
  if (data?.source !== 'oracle' || !Array.isArray(data[key]) || data.count !== data[key].length || !date(data.fetchedAt)) throw invalid()
  const ids = new Set()
  for (const row of data[key]) {
    if (!validate(row) || ids.has(row.id ?? `${row.stationId}:${row.fuel}`)) throw invalid()
    ids.add(row.id ?? `${row.stationId}:${row.fuel}`)
  }
  return data
}

export async function getCapabilities(options) {
  const data = await apiClient.operations('/admin/capabilities', options)
  if (!data || !['priceWrites', 'notifications', 'history', 'historyAdministratorAvailable'].every((key) => typeof data[key] === 'boolean')) throw invalid()
  return data
}

export async function getPriceStates(options) {
  return rows(await apiClient.operations('/admin/prices', options), 'prices', (row) =>
    normalizeOracleId(row.stationId) === row.stationId && fuels.includes(row.fuel) && typeof row.available === 'boolean' &&
    (row.priceId === null || normalizeOracleId(row.priceId) === row.priceId) && (row.price === null || positive(row.price)))
}

export async function getOracleHistory({ offset = 0, signal } = {}) {
  return rows(await apiClient.operations(`/admin/history?limit=50&offset=${offset}`, { signal }), 'history', (row) =>
    normalizeOracleId(row.id) === row.id && normalizeOracleId(row.stationId) === row.stationId && row.source === 'oracle' &&
    typeof row.stationName === 'string' && fuels.includes(row.fuel) && positive(row.newPrice) &&
    (row.previousPrice === null || positive(row.previousPrice)) && date(row.updatedAt) && row.administrator === null)
}

export async function getOracleNotifications({ offset = 0, signal } = {}) {
  const data = rows(await apiClient.operations(`/notifications?limit=50&offset=${offset}`, { signal }), 'notifications', (row) =>
    normalizeOracleId(row.id) === row.id && normalizeOracleId(row.stationId) === row.stationId && row.source === 'oracle' &&
    typeof row.title === 'string' && typeof row.message === 'string' && fuels.includes(row.fuel) &&
    typeof row.read === 'boolean' && ['new', 'up', 'down'].includes(row.type) && date(row.createdAt) && positive(row.newPrice) &&
    (row.previousPrice === null || positive(row.previousPrice)))
  if (normalizeOracleId(data.userId) !== data.userId) throw invalid()
  return data
}

export const markOracleNotificationRead = (id, options) => {
  if (normalizeOracleId(id) !== id) throw invalid()
  return apiClient.operations(`/notifications/${id}/read`, { ...options, method: 'POST', body: {} })
}

export async function saveOraclePrice(body, options) {
  const data = await apiClient.operations('/admin/prices', { ...options, method: 'POST', body })
  if (data?.source !== 'oracle' || normalizeOracleId(data.priceId) !== data.priceId || data.stationId !== body.station_id ||
    data.fuel !== body.fuel || !positive(data.newPrice) || data.newPrice !== Number(body.price) ||
    (data.previousPrice !== null && !positive(data.previousPrice)) || !date(data.updatedAt) || typeof data.replayed !== 'boolean') throw invalid()
  return data
}
