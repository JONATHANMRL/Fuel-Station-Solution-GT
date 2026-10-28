import { apiClient, ApiError } from './apiClient.js'
import { normalizeOracleId } from '../utils/oracleIdentity.js'

const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value)
const cents = (value) => Number.isFinite(value) && value > 0 && value <= 999999.99 &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001
const invalid = () => new ApiError('INVALID_RESPONSE', 'La API devolvió avisos generales incompatibles. No se mostrarán datos sin validar.')

export async function getPublicPriceAlerts(options) {
  const data = await apiClient.publicPriceAlerts(options)
  if (data?.source !== 'oracle' || !Array.isArray(data.alerts) || data.count !== data.alerts.length ||
      !Number.isInteger(data.limit) || data.limit < 1 || data.limit > 100 || data.count > data.limit ||
      !date(data.fetchedAt) || !(data.activatedAt === null || date(data.activatedAt)) ||
      !(data.nextCursor === null || (typeof data.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(data.nextCursor)))) throw invalid()
  const ids = new Set()
  for (const row of data.alerts) {
    if (!row || typeof row !== 'object') throw invalid()
    const difference = Math.round(row.newPrice * 100) - Math.round(row.previousPrice * 100)
    if (normalizeOracleId(row.priceId) !== row.priceId || row.id !== `public-price:${row.priceId}` || ids.has(row.id) ||
        normalizeOracleId(row.stationId) !== row.stationId || row.source !== 'oracle' ||
        !['stationName', 'brand'].every((key) => typeof row[key] === 'string' && row[key].trim()) ||
        !['regular', 'premium', 'diesel'].includes(row.fuel) || !cents(row.previousPrice) || !cents(row.newPrice) ||
        !difference || !Number.isFinite(row.difference) || Math.abs(row.difference * 100 - difference) > 0.000001 ||
        row.type !== (difference > 0 ? 'up' : 'down') || !date(row.createdAt) ||
        !['before_activation', 'after_activation', 'unclassified'].includes(row.context) ||
        (data.activatedAt === null ? row.context !== 'unclassified' : row.context !==
          (Date.parse(row.createdAt) >= Date.parse(data.activatedAt) ? 'after_activation' : 'before_activation'))) throw invalid()
    ids.add(row.id)
  }
  return data
}
