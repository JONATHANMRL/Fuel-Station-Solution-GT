// Oracle IDs are opaque stable keys, never an index in the reference catalogue.
export function normalizeOracleId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const normalized = value.replace(/^0+(?=\d)/, '')
  return normalized === '0' ? null : normalized
}
