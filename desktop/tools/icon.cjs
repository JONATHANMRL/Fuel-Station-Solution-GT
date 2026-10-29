const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.enableSandbox()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    const svg = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'brand-icon.svg'), 'utf8')
    await win.loadURL('data:text/html,' + encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:"><canvas width="256" height="256"></canvas>'))
    const data = await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const image=new Image();image.onload=()=>{const canvas=document.querySelector('canvas');canvas.getContext('2d').drawImage(image,0,0,256,256);resolve(canvas.toDataURL('image/png').split(',')[1])};image.onerror=reject;
      image.src=${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};})`)
    const png = Buffer.from(data, 'base64')
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
    header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12)
    header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18)
    const target = path.join(__dirname, '..', 'assets')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'icon.png'), png)
    fs.writeFileSync(path.join(target, 'icon.ico'), Buffer.concat([header, png]))
    process.stdout.write('Iconos PNG/ICO generados desde public/brand-icon.svg.\n')
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
  finally { win.destroy(); app.exit(process.exitCode || 0) }
})
