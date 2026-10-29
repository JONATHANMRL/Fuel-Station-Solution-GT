const { spawn } = require('node:child_process')
const path = require('node:path')
const binary = require('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const entry = process.argv[2] || 'desktop/main.cjs'
const child = spawn(binary, [path.resolve(entry), ...process.argv.slice(3)], { stdio: 'inherit', env, windowsHide: true })
child.on('error', () => { process.stderr.write('No se pudo iniciar Electron.\n'); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
