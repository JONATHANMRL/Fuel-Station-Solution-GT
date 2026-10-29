# GasolinaGT: cliente Electron para Windows

## Alcance

Se conserva React y la versión web/PWA. El instalador contiene exclusivamente el
cliente y Electron: no instala Oracle, Python, FastAPI, Node.js para desarrollo,
Vite ni Tailscale. El servidor continúa en Oracle Linux. No se modificaron el
backend, SQL, contraseñas, procedimientos, permisos ni configuraciones privadas.

Versión inicial: **1.0.0**, Windows **x64**, instalador NSIS por usuario, sin pedir
elevación. Requiere Windows compatible con Electron (Windows 10 o posterior),
Tailscale autorizado en la misma red privada y acceso HTTPS al servidor. Los
mapas necesitan además acceso a las teselas de OpenStreetMap por Internet.

## Archivos

- `desktop/main.cjs`: inicio, instancia única, configuración y cierre.
- `desktop/window.cjs`: ventana, sesión y restricciones de navegación/red.
- `desktop/gateway.cjs`: recursos locales y transporte HTTPS limitado.
- `desktop/security.cjs`: rutas permitidas, navegación y CSP.
- `desktop/client-config.cjs` y `desktop/default-client.json`: URL pública del API.
- `desktop/builder.cjs`: empaquetado NSIS, versión, accesos directos y exclusiones.
- `desktop/assets/icon.ico` y `icon.png`: derivados del SVG propio ya existente.
- `desktop/tools/`: ejecutor Electron, generación de icono, auditoría del paquete
  y preparación del certificado efímero exclusivo para pruebas.
- `desktop/tests/`: pruebas unitarias, ventana real con servidor simulado y
  comprobación opcional de lectura real contra el servidor central.
- `package.json` y `package-lock.json`: comandos y herramientas de escritorio.
- `vite.config.js`: build web conservado y build separado `desktop`.
- `src/main.jsx`: evita registrar el service worker en escritorio.
- `src/services/apiClient.js`: acepta la URL pública inyectada en tiempo de inicio;
  conserva la configuración `VITE_*` de la versión web.
- `.gitignore`: excluye builds, instaladores y material efímero de pruebas.

No se cambiaron pantallas, precios, favoritos, comparador, administración ni
notificaciones. Los favoritos de Electron empiezan en su propio perfil; no se
copian automáticamente los de Chrome/Vite.

## Herramientas instaladas

Dependencias de desarrollo con versiones fijadas: `electron@45.1.0`,
`electron-builder@26.18.0` y `@electron/asar@4.3.1` (auditoría ASAR).
React/Leaflet y las dependencias funcionales existentes se conservan.
Se requiere Node.js/npm solamente en la computadora de desarrollo para compilar.
El equipo del usuario final no necesita Node.js ni VS Code.

## Comandos en PowerShell

Desde la raíz del proyecto, después de `npm ci` en un clon nuevo:

```powershell
npm.cmd run desktop:dev
```

Este comando compila React y abre Electron; **no inicia Vite ni un servidor HTTP**.
Después de cambiar React hay que cerrar la ventana y repetir el comando. Para
abrir el último build sin recompilar:

```powershell
npm.cmd run desktop:start
```

Para empaquetar sin instalador o generar el instalador:

```powershell
npm.cmd run package:win
npm.cmd run dist:win
```

Salidas:

- `dist-desktop/`: frontend compilado de escritorio, separado de `dist/` web.
- `release/win-unpacked/GasolinaGT.exe`: aplicación desempaquetada.
- `release/GasolinaGT-Setup-1.0.0-x64.exe`: instalador para compartir manualmente.
- `release/package-audit.json`: inventario y SHA-256 del ASAR revisado.
- `release/*.blockmap`: metadatos generados por la herramienta; no se configuró
  actualización automática ni publicación.

Electron-builder necesita Internet la primera vez para descargar Electron y las
herramientas NSIS. El build no contacta Oracle ni incluye el backend. Cada comando
de empaquetado ejecuta la auditoría y falla si encuentra archivos no permitidos.
Para incrementar versión, actualizar `package.json`, su lockfile y
`extraMetadata.version` en `desktop/builder.cjs` antes de generar otra entrega.

## Configuración del servidor sin recompilar

El valor inicial público está en `desktop/default-client.json`:

```json
{
  "apiBaseUrl": "https://localhost-0.tail4fffd1.ts.net"
}
```

En el primer inicio se copia a `%APPDATA%\GasolinaGT\client-config.json`.
Para cambiarlo, cerrar GasolinaGT, editar ese archivo con un origen HTTPS válido
y volver a abrir. No agregar rutas, contraseñas, usuario, query ni fragmentos.
Solo se admite `apiBaseUrl`; un archivo inválido produce un error y no se
reemplaza silenciosamente. El perfil de desarrollo usa
`%APPDATA%\GasolinaGT-Development\client-config.json` por separado.

Cambiar de origen separa cookies y favoritos por las reglas de Chromium. No
transfiere sesiones ni secretos a otro servidor. Comprobar el dominio del servidor
antes de iniciar sesión. No colocar credenciales en este JSON ni en `VITE_*`.
El build de escritorio no lee `.env.local` ni exporta variables `VITE_*`.

## Origen HTTPS, cookies y seguridad

No se usa `file://` ni un puerto HTTP local. En una sesión Chromium exclusiva,
Electron intercepta HTTPS mediante `session.protocol.handle` y sirve únicamente
el HTML/JS/CSS/recursos empaquetados bajo la ruta reservada
`/__gasolinagt_desktop__/`. Aunque la dirección de la ventana tiene el origen
HTTPS configurado, **el documento y el JavaScript son locales**, no una web
descargada del servidor.

Las rutas de API permitidas se transportan con `session.fetch` de la misma sesión
y `bypassCustomProtocolHandlers: true`. Chromium conserva las cookies y valida el
certificado del servidor. Se mantienen `credentials: include`, `HttpOnly`,
`Secure`, `SameSite=None`, vencimiento, logout y permisos del backend. No se
guardan tokens/contraseñas en localStorage ni se exponen cookies mediante IPC.

Durante la prueba real de Electron se comprobó que el interceptor puede recibir
POST del mismo origen sin cabecera `Origin`. La pasarela la recupera únicamente
del `initiatorOrigin` nativo de Chromium cuando coincide exactamente con el origen
configurado. Rechaza iniciadores/orígenes ajenos y exige `X-Admin-Request: 1` en
POST. FastAPI continúa validando el origen y la sesión; no se relajó CSRF.
Esta integración está comprobada con la versión fijada de Electron: volver a
ejecutar las pruebas al actualizarla.

Protecciones: aislamiento de contexto, sandbox, Node desactivado en renderer,
sin preload/IPC, CSP sin eval ni scripts inline, sin workers, descargas denegadas
y permisos denegados salvo notificaciones del documento autorizado con consentimiento
explícito. Navegación limitada al documento local y sus hashes. El único enlace
externo autorizado es el copyright exacto de OpenStreetMap. La red solo admite
el API configurado y las teselas HTTPS a/b/c de OpenStreetMap. Redirecciones de
API y navegación a otros sitios se rechazan. No existen excepciones TLS en
producción.

Referencias oficiales de la implementación:
[protocol y sesiones](https://www.electronjs.org/docs/latest/api/protocol),
[session.fetch](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init)
y [seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security).

## Configuración que debe revisar el administrador de Oracle Linux

El cliente de escritorio tiene como origen el propio origen HTTPS del API:
`https://localhost-0.tail4fffd1.ts.net`, sin ruta ni barra final.

Antes del login real, comprobar que ese origen exacto esté incluido en las listas
privadas **existentes** del servidor:

- `CORS_ORIGINS`: agregarlo conservando todos los orígenes ya autorizados.
- `AUTH_ALLOWED_ORIGINS`: si está definido explícitamente, agregarlo también;
  si no está definido, el backend hereda `CORS_ORIGINS`.

Son valores separados por coma. No reemplazar las listas completas ni usar `*`,
`null`, `file://` u orígenes HTTP remotos. El administrador deberá aplicar la
configuración mediante el mecanismo habitual de su servicio FastAPI y reiniciarlo
cuando corresponda. **Esta tarea no editó ni leyó el `.env` privado del servidor,
no reinició servicios ni cambió Tailscale.** No hacen falta cambios SQL para Electron.

No se pidió ni utilizó la contraseña del administrador real. Si el login devuelve
403 por origen, revisar estas listas; si devuelve 401, revisar credenciales/sesión
con el administrador. No desactivar HTTPS, cookies, CSRF, permisos o autenticación
para resolver un error de configuración.

## Pruebas reproducibles

```powershell
npm.cmd test
npm.cmd run test:desktop
npm.cmd run lint
npm.cmd run build
npm.cmd run build:desktop
& backend/.venv-tests/Scripts/python.exe -m unittest discover -s backend/tests -v
npm.cmd run test:electron
npm.cmd run dist:win
npm.cmd run test:packaged
npm.cmd run test:central -- --packaged
```

`test:electron` y `test:packaged` usan una ventana **real** de Electron con datos y
autenticación **simulados**, no Oracle. La segunda carga los módulos y React del
ASAR generado. Verifican 25 estaciones, origen seguro, ausencia de Node en React,
cookies no legibles por JavaScript, login/session/logout, origen/CSRF y errores
de red. El certificado/key efímero se genera solo en `desktop/.test-runtime/`,
ignorado y excluido del paquete; se confía únicamente en su huella SHA-256 exacta
y en loopback, **dentro del proceso de pruebas**. Se requiere OpenSSL para esa
prueba, disponible con Git para Windows, o indicar `TEST_OPENSSL` con su ruta.
No se inicia un servidor de pruebas al abrir la aplicación normal.

`test:central` es opcional y **sí contacta el servidor central**, exclusivamente
para leer. Usa una ventana Electron aislada con el build local o, al pasar
`--packaged`, con el ASAR. Comprueba contratos de stations/brands/prices, catálogo
visible en React y marcadores Leaflet. No inicia sesión ni actualiza precios.
Requiere Tailscale y el servidor encendido. Las pruebas Python usan repositorios
simulados y no conectan a Oracle.

En el entorno restringido de Codex, el intérprete Python de Microsoft Store y
los procesos sandbox Chromium necesitaron ejecutar los comandos de prueba/build
fuera del aislamiento de herramientas. Se mantuvo el sandbox propio de Electron.
No se modificaron ACL ni se agregaron flags para deshabilitar su seguridad.

## Instalación y comprobación en las tres computadoras

1. Usar Windows x64 compatible y conectar Tailscale con autorización en la red.
   No instalar/configurar Tailscale desde GasolinaGT.
2. Comprobar desde cada PC que `https://localhost-0.tail4fffd1.ts.net/stations`
   devuelve JSON. Revisar igualmente `/brands` y `/prices`. Una prueba de lectura
   que funcione no garantiza que los orígenes de autenticación estén autorizados.
3. Copiar únicamente `GasolinaGT-Setup-1.0.0-x64.exe` desde `release/`; ejecutarlo
   con el usuario Windows final y seguir el asistente. Elegir carpeta y accesos
   directos. No es necesario copiar el proyecto ni iniciar Vite/FastAPI en Windows.
4. Abrir desde Inicio o el escritorio: debe aparecer Inicio y cargar las 25
   estaciones. Comprobar mapa/marcadores, marcas, filtros, comparación y favoritos.
5. Abrir Notificaciones sin sesión, actualizar y navegar entre secciones.
6. Entrar a Acceso administrativo, usar las credenciales existentes del usuario
   autorizado. Comprobar usuario visible, navegar y regresar al panel; verificar
   historial y avisos personales. Cerrar sesión y comprobar que se bloquea el panel.
7. Para verificar escritura real, coordinar una actualización autorizada de precio
   con los compañeros y comprobar resultado/historial/avisos en las otras PCs.
   Esta entrega no realizó escrituras reales ni cambió precios para probar.
8. Probar con el servidor inaccesible: debe aparecer un error y permitir reintentar,
   sin sustituir Oracle por datos inventados. Reconectar y actualizar.
9. Cerrar/reabrir, comprobar favoritos y sesión según vencimiento del servidor.
   El programa no funciona como catálogo offline; el mapa requiere Internet.

El instalador es **sin firma Authenticode**: no se dispone de certificado de
publicación. Windows/SmartScreen puede advertir sobre un editor desconocido.
No se desactivó ninguna protección de Windows. Para distribuir como producto,
obtener un certificado y configurar la firma antes de publicar; no introducir
el certificado ni su contraseña en Git. No hay actualizaciones automáticas.

## Resultados y límites de esta entrega

- 76 pruebas frontend existentes aprobadas; 67 pruebas Python aprobadas.
- 8 pruebas Electron de seguridad/configuración/arranque aprobadas; lint y ambos
  builds aprobados.
- Ventana real Electron con respuestas simuladas: cookies seguras y ciclo
  login/session/logout aprobados; no equivale a login real con Oracle.
- Lectura real desde Chromium Electron: `/stations` 25, `/brands` 7 y `/prices` 75,
  todos HTTP 200. No se ejecutaron consultas SQL directamente.
- React cargado desde el ASAR consultó realmente el API central y mostró los 25
  marcadores Leaflet. La prueba de sesión simulada también pasó desde ese ASAR.
- El inventario exacto del paquete y su hash se generan en
  `release/package-audit.json`. La inspección excluye `.env`, SQL, backend,
  bases de datos, claves, node_modules y pruebas del ASAR.
- Se extrajo `resources/app.asar` del instalador NSIS con 7-Zip y su SHA-256
  coincide con el ASAR auditado y probado. El registro de esta inspección está en
  `release/installer-audit.json`; el checksum del instalador en el archivo
  `.exe.sha256` contiguo. Se inspeccionaron 73 archivos de distribución, incluyendo
  el runtime y sus licencias. No se ejecutó el asistente de instalación.
- Instalación interactiva en las tres PCs, autenticación real con el administrador,
  actualización real de precios y alertas entre equipos deben completarse siguiendo
  la lista anterior. Las pruebas de ASAR no sustituyen esa aceptación del instalador.
- `npm audit` reportó 6 avisos (5 bajos, 1 moderado) en la cadena de herramientas
  web/PWA/transitivas existente. No se aplicó `npm audit fix --force` ni se degradó
  la PWA. Las herramientas/node_modules no se incluyen en el ASAR; revisar las
  actualizaciones de la cadena de compilación antes de distribución pública.

No se hicieron commit, push, despliegue ni publicación automática del instalador.

La revisión posterior del botón de notificaciones y su instalador de prueba se
documentan en [electron-notificaciones-prueba.md](electron-notificaciones-prueba.md).
