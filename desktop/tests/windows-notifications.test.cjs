const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { configureWindowsNotifications, APP_ID, TOAST_CLSID } = require('../windows-notifications.cjs')

test('Windows toast identity is stable and only the installed application shortcut is updated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gasolinagt-shortcut-'))
  const shortcut = path.join(dir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'GasolinaGT.lnk')
  const writes = [], identities = []
  const options = { platform: 'win32', execPath: path.join(dir, 'GasolinaGT.exe'),
    app: { isPackaged: true, getPath: () => dir, setToastActivatorCLSID: (id) => identities.push(id) },
    shell: { readShortcutLink: () => ({ target: options.execPath, appUserModelId: APP_ID }),
      writeShortcutLink: (...args) => { writes.push(args); return true } } }
  try {
    assert.equal(configureWindowsNotifications(options), 'missing-shortcut')
    assert.equal(writes.length, 0)
    fs.mkdirSync(path.dirname(shortcut), { recursive: true }); fs.writeFileSync(shortcut, '')
    assert.equal(configureWindowsNotifications(options), 'updated')
    assert.deepEqual(writes[0], [shortcut, 'update', { appUserModelId: APP_ID, toastActivatorClsid: TOAST_CLSID }])
    assert.ok(identities.every((id) => id === TOAST_CLSID))
    options.shell.readShortcutLink = () => ({ target: path.join(dir, 'another.exe'), appUserModelId: APP_ID })
    assert.equal(configureWindowsNotifications(options), 'different-shortcut')
    assert.equal(writes.length, 1)
    assert.equal(configureWindowsNotifications({ ...options, platform: 'linux' }), 'not-packaged')
    options.app.isPackaged = false
    assert.equal(configureWindowsNotifications(options), 'not-packaged')
  } finally { fs.rmSync(dir, { recursive: true }) }
})
