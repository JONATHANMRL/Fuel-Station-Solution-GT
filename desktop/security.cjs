const DESKTOP_PATH = '/__gasolinagt_desktop__/'
const INDEX_PATH = `${DESKTOP_PATH}index.html`
const publicGet = new Set(['/stations', '/brands', '/prices', '/public/price-alerts'])
const privateGet = new Set(['/auth/session', '/admin/capabilities', '/admin/prices', '/admin/history', '/notifications'])
const privatePost = new Set(['/auth/login', '/auth/logout', '/admin/prices'])

function apiAllowed(url, method, config) {
  return url.origin === config.origin && !url.username && !url.password && (
    method === 'GET' && (publicGet.has(url.pathname) || privateGet.has(url.pathname)) ||
    method === 'POST' && (privatePost.has(url.pathname) || /^\/notifications\/[1-9][0-9]{0,27}\/read$/.test(url.pathname)))
}

function tileAllowed(url, method) {
  return method === 'GET' && url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    /^[abc]\.tile\.openstreetmap\.org$/.test(url.hostname) && /^\/\d{1,2}\/\d+\/\d+\.png$/.test(url.pathname) && !url.search
}

function navigationAllowed(value, config) {
  try {
    const url = new URL(value)
    return url.origin === config.origin && url.pathname === INDEX_PATH && !url.search && !url.username && !url.password
  } catch { return false }
}

function networkAllowed(value, method, config) {
  try {
    const url = new URL(value)
    return tileAllowed(url, method) || apiAllowed(url, method, config) ||
      method === 'GET' && url.origin === config.origin && !url.username && !url.password &&
      (url.pathname.startsWith(DESKTOP_PATH) || ['/brand-icon.svg', '/favicon.svg'].includes(url.pathname))
  } catch { return false }
}

function contentSecurityPolicy(config) {
  return `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org; connect-src ${config.origin}; font-src 'self' data:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'`
}

module.exports = { DESKTOP_PATH, INDEX_PATH, apiAllowed, tileAllowed, navigationAllowed, networkAllowed, contentSecurityPolicy }
