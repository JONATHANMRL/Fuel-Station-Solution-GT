import { normalizeOracleId } from '../utils/oracleIdentity.js'

const fuels = ['premium', 'regular', 'diesel']
const availabilityStates = ['DISPONIBLE', 'AGOTADO', 'NO_REGISTRADO']

export class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

const invalidContract = () => new ApiError('INVALID_RESPONSE', 'La API devolvió datos incompatibles. No se mostrarán precios sin validar.')
const invalidAuthContract = () => new ApiError('INVALID_RESPONSE', 'La API devolvió una respuesta de autenticación incompatible. No se pudo confirmar la sesión.')
const text = (value) => typeof value === 'string'
const price = (value) => value === null || (Number.isFinite(value) && value > 0)
const coordinate = (value, limit) => value === null || (Number.isFinite(value) && Math.abs(value) <= limit)

function envelope(data, key) {
  if (!data || data.source !== 'oracle' || !Array.isArray(data[key]) ||
      data.count !== data[key].length || !text(data.fetchedAt) ||
      !Number.isFinite(Date.parse(data.fetchedAt))) throw invalidContract()
  return data
}

export function validateStations(data) {
  envelope(data, 'stations')
  const ids = new Set()
  const stations = data.stations.map((station) => {
    if (!station || typeof station !== 'object') throw invalidContract()
    const id = normalizeOracleId(station.id)
    if (!id || ids.has(id) || station.source !== 'oracle' || station.isDemo !== false ||
        !['name', 'brand', 'address', 'municipality', 'department', 'zone'].every((key) => text(station[key])) ||
        !station.name.trim() || !coordinate(station.lat, 90) || !coordinate(station.lng, 180) ||
        station.locationStatus !== 'pending' || !['ACTIVA', 'INACTIVA'].includes(station.stationStatus) ||
        !fuels.every((fuel) => price(station.prices?.[fuel]) && availabilityStates.includes(station.availability?.[fuel])) ||
        (station.updatedAt !== null && (!text(station.updatedAt) || !Number.isFinite(Date.parse(station.updatedAt))))) {
      throw invalidContract()
    }
    ids.add(id)
    return { ...station, id, prices: { ...station.prices }, availability: { ...station.availability } }
  })
  return { ...data, stations }
}

function validateAdminSession(data) {
  const id = normalizeOracleId(data?.user?.id)
  if (data?.authenticated !== true || !id || data.user.role !== 'admin' ||
      !text(data.user.email) || !data.user.email.trim() || !text(data.expiresAt) ||
      !Number.isFinite(Date.parse(data.expiresAt))) throw invalidAuthContract()
  return { authenticated: true, user: { id, email: data.user.email, role: 'admin' }, expiresAt: data.expiresAt }
}

function validateBrands(data) {
  envelope(data, 'brands')
  const names = new Set()
  for (const brand of data.brands) {
    if (!brand || !text(brand.name) || !brand.name.trim() || names.has(brand.name) ||
        !Number.isSafeInteger(brand.count) || brand.count < 0) throw invalidContract()
    names.add(brand.name)
  }
  return data
}

function validatePrices(data) {
  envelope(data, 'prices')
  const pairs = new Set()
  const prices = data.prices.map((row) => {
    const id = normalizeOracleId(row?.stationId)
    const pair = `${id}:${row?.fuel}`
    if (!id || pairs.has(pair) || !fuels.includes(row.fuel) || !price(row.price) || row.price === null ||
        !availabilityStates.includes(row.availability) || typeof row.available !== 'boolean' ||
        (row.available && row.availability !== 'DISPONIBLE') ||
        !['stationName', 'brand', 'municipality', 'zone'].every((key) => text(row[key]))) throw invalidContract()
    pairs.add(pair)
    return { ...row, stationId: id }
  })
  return { ...data, prices }
}

// Factory permits HTTP simulation in Node tests; it never loads fixture files.
export function createApiClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  async function get(path, signal, { method = 'GET', body, auth = false } = {}) {
    let base
    try {
      base = new URL(baseUrl)
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error()
    } catch {
      throw new ApiError('API_NOT_CONFIGURED', 'Configura VITE_API_BASE_URL con la dirección HTTP(S) de FastAPI, sin credenciales.')
    }
    if (auth && base.protocol !== 'https:') throw new ApiError('HTTPS_REQUIRED', 'El inicio de sesión requiere una API HTTPS.')
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ApiError('API_NOT_CONFIGURED', 'VITE_API_TIMEOUT_MS debe ser un número positivo.')
    if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
    const controller = new AbortController()
    let timedOut = false
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const response = await fetchImpl(`${base.href.replace(/\/$/, '')}${path}`, {
        method, headers: { Accept: 'application/json',
          ...(auth && method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Admin-Request': '1' } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: auth ? 'include' : 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      })
      if (!response.ok) {
        if (auth && !path.startsWith('/auth/') && [409, 503].includes(response.status)) {
          const messages = {
            PRICE_WRITES_DISABLED: 'La escritura de precios no está habilitada en el servidor.',
            PRICE_CONFLICT: 'El precio cambió en otro cliente. Actualiza antes de guardar.',
            PRICE_UNCHANGED: 'El precio nuevo es igual al vigente.',
            FUEL_UNAVAILABLE: 'La estación o el combustible no están disponibles.',
            REQUEST_REUSED: 'El identificador corresponde a otra solicitud.',
            REQUEST_UNRESOLVED: 'Solicitud pendiente o fallida. Consulta el historial antes de intentar otro cambio.',
            COMMIT_UNCERTAIN: 'No se pudo confirmar el guardado. Consulta el historial; no reenvíes el cambio.',
            NOTIFICATIONS_DISABLED: 'Las notificaciones Oracle todavía no están habilitadas.',
          }
          let code
          try { code = (await response.json())?.detail?.code } catch { /* Keep safe generic message. */ }
          if (Object.hasOwn(messages, code)) throw new ApiError(code, messages[code])
        }
        if (auth) throw new ApiError(`HTTP_${response.status}`,
          response.status === 401 ? 'Correo o contraseña incorrectos, o sesión vencida.'
            : response.status === 403 ? 'Acceso administrativo u origen no autorizado.'
              : response.status === 429 ? 'Demasiados intentos. Espera unos minutos.'
                : 'Acceso administrativo no disponible. Inténtalo más tarde.')
        throw new ApiError(`HTTP_${response.status}`, response.status === 503
          ? 'FastAPI no pudo consultar Oracle. Intenta actualizar nuevamente.'
          : `La API no pudo completar la consulta (HTTP ${response.status}).`)
      }
      if (auth && response.status === 204) return null
      let data
      try { data = await response.json() } catch {
        if (controller.signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
        throw auth ? invalidAuthContract() : invalidContract()
      }
      if (controller.signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
      return data
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
      if (timedOut) throw new ApiError('TIMEOUT', 'La consulta tardó demasiado. Intenta actualizar nuevamente.')
      if (error instanceof ApiError) throw error
      throw new ApiError('NETWORK_ERROR', 'No fue posible acceder a FastAPI. Comprueba la conexión, Tailscale y los permisos CORS del servidor.')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }
  return {
    async stations({ signal } = {}) { return validateStations(await get('/stations', signal)) },
    async brands({ signal } = {}) { return validateBrands(await get('/brands', signal)) },
    async prices({ fuel, signal } = {}) {
      if (fuel !== undefined && !fuels.includes(fuel)) throw new ApiError('INVALID_FUEL', 'Selecciona un combustible válido.')
      return validatePrices(await get(`/prices${fuel ? `?fuel=${fuel}` : ''}`, signal))
    },
    async signIn({ email, password }, { signal } = {}) {
      return validateAdminSession(await get('/auth/login', signal, { method: 'POST', auth: true, body: { email, password } }))
    },
    async adminSession({ signal } = {}) {
      return validateAdminSession(await get('/auth/session', signal, { auth: true }))
    },
    async signOut({ signal } = {}) {
      await get('/auth/logout', signal, { method: 'POST', auth: true, body: {} })
    },
    async operations(path, { signal, method = 'GET', body } = {}) {
      if (!/^\/(admin\/(capabilities|prices|history)|notifications(?:\/[1-9][0-9]*\/read)?)(?:\?|$)/.test(path)) {
        throw new ApiError('INVALID_OPERATION', 'Operación administrativa inválida.')
      }
      return get(path, signal, { method, body, auth: true })
    },
  }
}

const env = import.meta.env ?? {}
export const apiClient = createApiClient({
  baseUrl: env.VITE_API_BASE_URL,
  timeoutMs: env.VITE_API_TIMEOUT_MS === undefined ? 12000 : Number(env.VITE_API_TIMEOUT_MS),
})
