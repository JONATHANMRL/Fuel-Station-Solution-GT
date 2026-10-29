# Prueba de emergentes Windows y polling — GasolinaGT 1.0.0

## Diagnóstico y alcance

El botón anterior llamaba a `Notification.requestPermission()`, pero Electron
denegaba **todos** los permisos desde ambos manejadores de su sesión. Además,
no existía ninguna llamada a `new Notification(...)` para entregar emergentes.
Conceder permiso por sí solo no genera avisos.

El acceso directo instalado tenía `gt.gasolinagt.desktop` como AppUserModelID,
pero no ToastActivatorCLSID. El cliente ahora fija un CLSID estable y actualiza
exclusivamente esas propiedades de su propio enlace existente en el menú Inicio,
verificando primero su ejecutable y AppUserModelID. No crea accesos directos
adicionales ni modifica enlaces de otras aplicaciones. Esta operación solo se
realiza en Windows con la aplicación empaquetada.

No se modifican Oracle, FastAPI, autenticación, cookies, Tailscale, precios,
historial ni notificaciones personales. No se agregan dependencias ni IPC.

## Implementación

- `desktop/notification-permissions.cjs`: permite únicamente `notifications`,
  después de confirmación nativa. Valida documento principal empaquetado y origen;
  cámara, micrófono, ubicación, pantalla, portapapeles y otros permisos permanecen
  denegados. Maneja también las consultas nativas sin WebContents de Chromium.
  Chromium entrega el origen con barra final en este callback: se compara el
  origen normalizado sin admitir rutas ni otros sitios.
- `desktop/windows-notifications.cjs`: identidad estable del emisor Windows y
  actualización limitada del acceso directo del usuario.
- `desktop/main.cjs` y `desktop/window.cjs`: instalan ambos mecanismos conservando
  sandbox, aislamiento y restricciones de red/navegación.
  `backgroundThrottling: false` evita que Chromium retrase el temporizador por
  minimizar la ventana; no mantiene consultas al salir de la sección.
- `src/services/systemNotifications.js`: usa la Web Notifications API respaldada
  por el sistema operativo de Electron. No necesita exponer APIs nativas mediante
  preload/IPC. El botón pide consentimiento y envía una notificación de prueba.
- `src/App.jsx`: estado inicial del permiso, botón de activación y mensajes de
  error cuando falla el envío. Un nuevo clic cuando está activado reenvía la prueba.
- `src/hooks/usePublicPriceAlerts.js` y `src/services/publicPriceAlertsLoader.js`:
  entregan las primeras páginas nuevas al emisor de emergentes. Se conserva el
  mecanismo existente de polling y sus controles de concurrencia.
- `desktop/tools/audit-package.cjs`: permite los dos nuevos módulos de runtime,
  manteniendo la exclusión de secretos, backend, SQL y pruebas.
- `package.json`: agrega `dist:win:test`, con nombre de instalador separado.
- Pruebas nuevas/ampliadas en `desktop/tests/notification-permissions.test.cjs`,
  `windows-notifications.test.cjs`, `startup.test.cjs`, `smoke.cjs`,
  `tests/system-notifications.test.mjs` y `tests/public-price-alerts.test.mjs`.

El consentimiento se guarda por origen en
`%APPDATA%\GasolinaGT\notification-consent.json`. No contiene credenciales. No se
autoriza automáticamente otro servidor al cambiar la URL. Para revocar también
el consentimiento de la aplicación, cerrarla y eliminar ese archivo; para
bloquear la entrega, usar los ajustes de notificaciones de Windows.

## Qué avisos producen emergentes

Las emergentes corresponden a **cambios generales nuevos**, disponibles sin login.
La primera carga del histórico es silenciosa. Las actualizaciones posteriores
emiten como máximo una emergente por respuesta, resumen si hay varios cambios,
y no repiten los IDs ya observados en ese proceso. "Cargar cambios anteriores"
no produce emergentes. Los errores de entrega no borran ni bloquean los avisos
dentro de GasolinaGT. Los avisos y filtros personales conservan su funcionamiento.

Se consultan cambios generales mientras la sección Notificaciones está activa,
incluyendo una ventana minimizada que siga en esa sección. No se implementan
push del servidor, ejecución en bandeja ni avisos con la aplicación cerrada.
Al salir de la sección se detiene su polling; al regresar se consulta nuevamente.

## Revisión del polling

El mecanismo existente era correcto: una petición inicial, un único `setTimeout`
de 30000 ms después de terminar cada petición y una sola petición en curso.
Actualizar manualmente se une a una petición pendiente y sustituye el temporizador,
sin acumular intervalos. El cleanup aborta la petición, elimina el temporizador y
descarta respuestas antiguas. El inicio diferido evita una petición extra durante
setup/cleanup/setup de React StrictMode. Se conservaron paginación y deduplicación.

La aplicación instalada limita su ejecución a una instancia/ventana por perfil.
**Las pestañas web independientes, desarrollo y otras computadoras mantienen sus
propios ciclos**: dos clientes activos pueden generar dos GET cercanos cada 30 s.
Eso no implica dos temporizadores en un cliente. No se añadió coordinación entre
pestañas ni almacenamiento compartido de respuestas; se evita cambiar ese alcance
y el comportamiento existente. Para medir un cliente, cerrar los demás primero.

## Instalador de prueba

```powershell
npm.cmd run dist:win:test
```

Salida: `release/GasolinaGT-Setup-1.0.0-x64-prueba-notificaciones.exe`.
Se mantiene el instalador anterior `GasolinaGT-Setup-1.0.0-x64.exe` como referencia.
Se comprobó su preservación por SHA-256 y se extrajo el ASAR del instalador nuevo:
coincide con el paquete auditado de 17 archivos de aplicación, sin backend,
SQL, claves ni entornos privados. Registro de esta comprobación:
`release/notification-installer-audit.json`; checksum en el `.exe.sha256` contiguo.
Este instalador utiliza el mismo identificador y versión de la aplicación: cerrar
GasolinaGT y usar el asistente para reemplazar la instalación de prueba existente.
No instalar ambas versiones como si fueran productos diferentes. Se conservan el
perfil y la configuración del servidor. No se publica ni firma automáticamente.

## Pruebas y límites

Comandos de verificación:

```powershell
npm.cmd test
npm.cmd run test:desktop
npm.cmd run lint
npm.cmd run build
npm.cmd run build:desktop
& backend/.venv-tests/Scripts/python.exe -m unittest discover -s backend/tests -v
npm.cmd run test:electron
npm.cmd run test:packaged
```

Resultados unitarios: **83 frontend, 12 Electron, 67 Python**. Se prueban
consentimiento, denegación, persistencia por origen, exclusión de otros permisos,
protección del acceso directo, toasts nuevos sin históricos repetidos, error del
emisor, limpieza de temporizadores, StrictMode, respuestas atrasadas, paginación
y ciclos independientes de varias ventanas.

El smoke test usa Chromium/Electron real y HTTPS local **simulado**. Ejecuta el
botón real de React, obtiene `Notification.permission === 'granted'` con un diálogo
simulado y captura la construcción de toasts sin mostrarlos en Windows. Comprueba
una consulta automática tras 31 segundos en Notificaciones y ninguna adicional
durante otros 31 segundos fuera de la sección. Conserva las pruebas de cookies y
login/session/logout simulados. `test:packaged` repite esto con los módulos y el
frontend del ASAR. No se ingresan credenciales ni se escriben precios en Oracle.

Estas pruebas **no confirman visualmente una emergente Windows real**, su sonido,
la entrega con No molestar, ni la actualización real de un enlace por el programa
instalado. Esos puntos requieren la comprobación manual siguiente.

## Comprobación manual en Windows

1. Cerrar GasolinaGT, instalar el `.exe` de prueba y abrir desde el menú Inicio.
   Mantener habilitado el acceso del menú Inicio que usa Windows para identificar
   al emisor. Conservar Tailscale conectado y el servidor accesible.
2. Ir a Notificaciones, esperar que termine la primera consulta y pulsar
   **Activar notificaciones**. Elegir **Permitir** en el diálogo de GasolinaGT.
   Debe aparecer la emergente de confirmación. No se piden cámara, micrófono,
   ubicación ni otros permisos.
3. Si no aparece, revisar Configuración → Sistema → Notificaciones: permitir
   GasolinaGT, banners y centro de notificaciones. Desactivar temporalmente
   No molestar/Asistente de concentración para esta prueba. No desactivar ninguna
   protección HTTPS, cookies, CORS o CSRF. Volver a pulsar el botón para reenviar
   la prueba. El permiso Chromium no puede forzar una entrega bloqueada por Windows.
4. Con una sola instalación/pestaña activa, dejar Notificaciones abierta. Desde
   otra computadora realizar una actualización de precio autorizada usando el
   panel que ya funciona. En aproximadamente 30 segundos más la latencia de red,
   debe aparecer el aviso dentro de la app y una emergente con estación y precio.
   Un refresh repetido no debe repetir la emergente del mismo evento.
5. Revisar el registro FastAPI: una consulta inicial y aproximadamente una cada
   30 segundos tras finalizar la anterior. Clics manuales agregan consultas cuando
   no hay una pendiente. No debe existir más de una en curso por ventana.
6. Cambiar a Inicio y esperar más de 30 segundos: ese cliente deja de solicitar
   `/public/price-alerts`. Otras computadoras/pestañas aún pueden solicitarlo.
   Volver a Notificaciones: una nueva consulta inicial y un solo ciclo.
7. Probar rechazar el consentimiento (en un perfil sin consentimiento guardado):
   los avisos dentro de la aplicación siguen funcionando, sin emergentes.
8. Confirmar que administrador, historial, actualización de precios, logout y
   avisos personales conservan el comportamiento real ya validado por el equipo.

Referencias oficiales:
[permisos de sesión](https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler),
[notificaciones renderer/nativas y Windows](https://www.electronjs.org/docs/latest/tutorial/notifications),
[CLSID de activación](https://www.electronjs.org/docs/latest/api/app#appsettoastactivatorclsidid-windows).

No se realizaron commit, push, cambios de servidor ni despliegue automático.
