const fs = require('node:fs/promises')
const path = require('node:path')
const { DESKTOP_PATH, apiAllowed, tileAllowed, contentSecurityPolicy } = require('./security.cjs')

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const failure = (status, message) => new Response(JSON.stringify({ detail: { message } }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function createGateway({ config, distDir, fetchRemote }) {
  return async (request) => {
    const url = new URL(request.url)
    if (url.origin === config.origin && request.method === 'GET') {
      if (url.pathname === `${DESKTOP_PATH}runtime-config.js`) {
        const value = JSON.stringify({ apiBaseUrl: config.apiBaseUrl }).replaceAll('<', '\\u003c')
        return new Response(`Object.defineProperty(globalThis,'__GASOLINAGT_CONFIG__',{value:Object.freeze(${value}),writable:false,configurable:false});`,
          { headers: { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store' } })
      }
      let name
      if (url.pathname.startsWith(DESKTOP_PATH)) name = url.pathname.slice(DESKTOP_PATH.length)
      else if (['/brand-icon.svg', '/favicon.svg'].includes(url.pathname)) name = url.pathname.slice(1)
      if (name !== undefined) {
        try {
          name = decodeURIComponent(name)
          if (!name || name.includes('\\') || name.includes('\0') || name.split('/').some((part) => ['.', '..'].includes(part))) return failure(403, 'Recurso no permitido.')
          const type = mime[path.extname(name)]
          if (!type) return failure(404, 'Recurso no disponible.')
          const file = await fs.realpath(path.join(distDir, name))
          const root = await fs.realpath(distDir)
          const relative = path.relative(root, file)
          if (relative.startsWith('..') || path.isAbsolute(relative)) return failure(403, 'Recurso no permitido.')
          return new Response(await fs.readFile(file), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store',
            'Content-Security-Policy': contentSecurityPolicy(config), 'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin' } })
        } catch { return failure(404, 'Recurso no disponible.') }
      }
    }
    if (!apiAllowed(url, request.method, config) && !tileAllowed(url, request.method)) return failure(403, 'Destino no permitido.')
    if (apiAllowed(url, request.method, config)) {
      let origin = request.headers.get('Origin')
      const initiator = request.initiatorOrigin
      if (initiator && initiator !== config.origin) return failure(403, 'Origen no autorizado.')
      // Chromium's protocol interception can omit Origin on same-origin POST.
      // Recover it ONLY from the browser-provided initiator, never from URL/body
      // input or a renderer IPC argument. FastAPI still validates this exact origin.
      if (!origin && initiator === config.origin) {
        origin = initiator
        const headers = new Headers(request.headers)
        headers.set('Origin', initiator)
        request = new Request(request, { headers })
      }
      if ((origin && origin !== config.origin) || (request.method === 'POST' &&
          (origin !== config.origin || request.headers.get('X-Admin-Request') !== '1'))) return failure(403, 'Origen no autorizado.')
    }
    try {
      // Use Chromium's SAME session/cookie jar, not Node fetch. Keep Origin, CSRF,
      // body, credentials mode and TLS verification. Do not inspect/log credentials.
      return await fetchRemote(request)
    } catch { return failure(503, 'No se pudo conectar con el servidor. Comprueba Tailscale e intenta nuevamente.') }
  }
}

module.exports = { createGateway }
