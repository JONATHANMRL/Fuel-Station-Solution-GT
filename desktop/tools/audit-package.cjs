const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

async function audit() {
  const { listPackage, extractFile } = await import('@electron/asar')
  const archive = path.resolve('release/win-unpacked/resources/app.asar')
  const entries = listPackage(archive).map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''))
  const files = entries.filter((entry) => /\.[^/]+$/.test(entry))
  const allowed = /^(?:package\.json|desktop\/(?:main|window|gateway|security|client-config|notification-permissions|windows-notifications)\.cjs|desktop\/default-client\.json|desktop\/assets\/icon\.png|dist-desktop\/)/
  const forbidden = /(?:^|\/)(?:\.env(?:\..*)?|backend|database|tests?|node_modules|\.git)(?:\/|$)|\.(?:sqlite3?|sql|pem|key|pfx|map)$/i
  for (const entry of files) {
    if (!allowed.test(entry) || forbidden.test(entry)) throw new Error(`Archivo no permitido en ASAR: ${entry}`)
    if (/\.(?:js|cjs|json|html|css|svg)$/.test(entry)) {
      const text = extractFile(archive, entry.split('/').join(path.sep)).toString('utf8')
      if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|localhost:5173|ORACLE_PASSWORD\s*[:=]\s*["'][^"']+/i.test(text)) {
        throw new Error(`Contenido de desarrollo/privado detectado en ${entry}`)
      }
    }
  }
  const metadata = JSON.parse(extractFile(archive, 'package.json'))
  if (metadata.main !== 'desktop/main.cjs' || Object.keys(metadata.dependencies || {}).length) throw new Error('Metadatos o dependencias de runtime inesperados.')
  const report = { archive: 'win-unpacked/resources/app.asar', files, fileCount: files.length,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }
  fs.writeFileSync('release/package-audit.json', JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(`ASAR revisado: ${files.length} archivos permitidos; sin backend, SQL, entornos o claves.\n`)
}
audit().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
