const fs = require('node:fs')
const path = require('node:path')

function validateConfig(data) {
  if (!data || typeof data !== 'object' || Object.keys(data).some((key) => key !== 'apiBaseUrl')) throw new Error('Configuración de cliente inválida.')
  let url
  try { url = new URL(data.apiBaseUrl) } catch { throw new Error('La dirección del servidor no es válida.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('El servidor debe ser un origen HTTPS, sin credenciales, rutas ni parámetros.')
  }
  return Object.freeze({ apiBaseUrl: url.origin, origin: url.origin })
}

function loadClientConfig(userData, defaultPath) {
  fs.mkdirSync(userData, { recursive: true })
  const target = path.join(userData, 'client-config.json')
  if (!fs.existsSync(target)) fs.copyFileSync(defaultPath, target, fs.constants.COPYFILE_EXCL)
  if (fs.statSync(target).size > 4096) throw new Error('El archivo de configuración es demasiado grande.')
  let data
  try { data = JSON.parse(fs.readFileSync(target, 'utf8')) } catch { throw new Error('Revisa client-config.json: debe ser JSON válido.') }
  return validateConfig(data)
}

module.exports = { validateConfig, loadClientConfig }
