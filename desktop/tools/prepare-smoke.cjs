// Temporary test certificate, never packaged or committed. Not used by the app.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const folder = path.join(__dirname, '..', '.test-runtime')
fs.mkdirSync(folder, { recursive: true })
const openssl = process.env.TEST_OPENSSL || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl')
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(folder, 'key.pem'),
  '-out', path.join(folder, 'cert.pem'), '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
  { stdio: 'ignore', windowsHide: true })
process.stdout.write('Certificado efímero para la prueba HTTPS local preparado.\n')
