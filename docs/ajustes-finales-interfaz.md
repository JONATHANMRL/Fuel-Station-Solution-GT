# Ajustes finales de interfaz, navegación y mapa

## Referencia y alcance

Versión de referencia conservada en Git: `e320bee`, rama `fase-4-5`. Esta entrega
queda como cambios locales revisables, sin commit, push ni despliegue. No se crean
copias del proyecto ni se reconstruye la aplicación.

No se cambian backend, endpoints, contratos, SQL, las diez tablas, REGISTRAR_PRECIO,
cookies, sesiones, usuarios, contraseñas, entorno privado, Tailscale ni dependencias.
Las operaciones de guardado y de consulta siguen usando los servicios existentes.
Las pruebas locales no acceden al servidor real ni ejecutan SQL en Oracle.

## Textos y datos

Se mantienen nombre, marca, dirección/referencia, estado, disponibilidad, fechas y
precios. Se conservan los errores de conexión, sesión, permisos y guardado. Los
campos context/activatedAt/source, la validación de los contratos y la calidad de
las coordenadas no se eliminan ni se alteran en los datos recibidos.

Cambios de presentación:

| Antes | Ahora |
| --- | --- |
| Estaciones consultadas en Oracle / Consulta | Gasolineras / Actualizado |
| Avisos generales con explicaciones de Oracle y frecuencia | Consulta los cambios recientes en los precios de los combustibles |
| Origen sin verificar / fecha de activación / advertencias de demostración | Solo fecha y hora del cambio |
| Avisos personales almacenados en Oracle y polling | Consulta los avisos de tu cuenta |
| Explicaciones técnicas de preferencias | Elige qué avisos personales mostrar en este equipo |
| Opciones de coordenadas pendientes / modo demostración | Explorar gasolineras y selección para consultar precios |
| Tabla de estaciones sin ubicación verificada | Listado de gasolineras con marca, referencia y detalle |
| Estado de ubicación en Marcas | Estado real ACTIVA/INACTIVA de la estación |
| Administrador no registrado en Oracle | No registrado, sin inventar un autor |

Los avisos archivados siguen separados de los avisos generales y personales.
La documentación anterior conserva la explicación de procedencia y limitaciones;
esta guía documenta la evolución visual y del ciclo de consultas.

## Solicitudes de avisos generales

La revisión del código anterior encontró un único timeout, sin peticiones simultáneas
por controlador y con protección de respuestas antiguas. Sin embargo, el componente
permanecía montado dentro de una sección oculta: consultaba al abrir la app aunque
no se entrara en Notificaciones. Además, cada evento focus podía disparar una nueva
consulta una vez terminada la anterior. Cada pestaña tenía su propio controlador.

Eso puede explicar varias respuestas GET 200, pero no permite atribuir los registros
observados a una causa concreta sin sus horas y sin saber cuántas pestañas estaban
abiertas. No se conectó aquí al servidor para inspeccionar logs.

Ahora el componente recibe active según la sección seleccionada:

- Al entrar en Notificaciones hace una consulta inicial.
- Mientras esa sección esté activa, consulta aproximadamente cada 30 segundos tras
  finalizar la petición anterior. El límite y el cursor existentes no cambian.
- Actualizar es manual; si ya hay una petición, se une a ella.
- Al salir se cancela la petición pendiente y se limpia el timeout. Al regresar se
  inicia un ciclo nuevo con una sola consulta inicial.
- Ya no se añade un listener focus para los avisos generales. Cambiar el foco por
  sí solo no provoca otra petición.
- StrictMode descarta el primer setup antes de iniciar la consulta. Las respuestas
  y callbacks de ciclos cancelados siguen protegidos por la versión del controlador.
- La paginación y deduplicación siguen iguales. El polling vuelve a primera página.

Con una pestaña activa se esperan aproximadamente dos consultas por minuto después
de la inicial. Dos pestañas en Notificaciones pueden producir aproximadamente cuatro
por minuto. Los clics manuales y las entradas nuevas a la sección añaden consultas.
No hay coordinación entre pestañas y no se añade un servicio para ello. Los avisos
personales mantienen su ciclo independiente y su sesión; la campana sigue contando
los personales sin leer. No confundir `/notifications` con `/public/price-alerts`.

## Acceso administrativo

La navegación pública conserva sus seis entradas. El enlace administrativo sigue
siendo la séptima sección y utiliza el mismo hash `#admin`, discretamente al final
del menú lateral. Sin sesión se llama «Acceso administrativo»; con sesión admin
confirmada se llama «Panel admin». La pantalla muestra el formulario existente o el
panel protegido según el mismo estado de sesión que se utilizaba antes.

El provider compartido ya existente conserva la sesión al visitar otras secciones.
Logout y vencimiento vuelven a la etiqueta de acceso. La función de etiquetas no
autoriza ninguna operación. La protección real de FastAPI, cookies HttpOnly/Secure,
CSRF, permisos y comprobaciones de sesión no cambia. No se añade almacenamiento
de contraseñas o tokens ni se crean usuarios.

## Mapa: causa y solución

La API existente declara `locationStatus: pending` para las estaciones de Oracle.
Antes el mapa exigía coordenadas verificadas o, además de VITE_MAP_DEMO_MODE, un
checkbox inicialmente apagado. Por eso podía recibirse el catálogo de 25 estaciones
y mostrarse cero puntos. `canDisplayOnMap` y el catálogo de referencia se conservan
como código anterior; no se transforman sus datos en ubicaciones verificadas.

Se reutilizan Leaflet/react-leaflet, MapContainer, tiles de OpenStreetMap, leyenda,
búsqueda, filtros, popup y panel lateral. La nueva capa `buildMapMarkers` produce
un objeto por ID Oracle con la estación original y una posición separada:

```text
{ id, station: registroOriginal, position: { lat, lng, simulated: true, source: 'presentation' } }
```

La posición se obtiene de los dígitos del ID mediante una distribución Halton en
bases 2 y 7 dentro de un área fija alrededor de Huehuetenango. No utiliza Math.random,
índices del array, precios, nombre ni posición en los filtros. Por ello no cambia al
recargar, ordenar, añadir/quitar otras estaciones o actualizar precios. Acepta IDs
Oracle grandes sin convertirlos primero a Number. IDs duplicados se dibujan una
vez; registros locales o IDs inválidos no generan estaciones nuevas.

La capa no modifica station.lat/lng, locationStatus, source ni datos comerciales.
Se dibujan todos los registros recibidos que pasan los filtros, incluso cuando las
coordenadas Oracle son nulas o coincidentes. No se utiliza `realStations.js` para
rellenar un catálogo fallido. Un error de carga deja el mapa sin marcadores y con
el error correspondiente, no con precios antiguos presentados como actuales.

Para este catálogo expresamente ficticio, las posiciones de presentación se muestran
directamente, sin un interruptor. **No hace falta cambiar VITE_MAP_DEMO_MODE ni
.env.local.** La variable anterior y sus adaptadores se conservan como referencia,
pero no bloquean esta capa ilustrada. Si en el futuro se incorporan posiciones
auténticas, se necesitará acordar otra política explícita; no se certifican aquí.

Los iconos son SVG estáticos de surtidor dentro de divIcon, sin imágenes remotas ni
bibliotecas nuevas. Todos tienen las mismas dimensiones. Conservan colores por marca;
la selección añade borde, sombra y prioridad visual. No se insertan nombres ni datos
de la API en el HTML del icono. Los marcadores conservan activación por teclado.

El mapa encuadra los puntos al entrar o cambiar filtros. Al seleccionar desde el
listado, resalta el mismo ID y mantiene su posición visible al abrir el panel. El
precio del popup/panel se lee siempre del catálogo actual. El botón X cierra el
panel y devuelve el ancho al mapa; ResizeObserver mantiene el tamaño de Leaflet.
Una actualización del mismo catálogo conserva el ID seleccionado y las posiciones.
«Mostrar todas» restablece búsqueda y filtros sin perder favoritos.

No hay enlaces GPS, distancias, orden por cercanía o tiempos de llegada derivados
de las posiciones de presentación. La interfaz no añade etiquetas académicas,
conforme a la solicitud, y tampoco afirma que las posiciones hayan sido verificadas.
La capa de tiles sigue necesitando acceso a OpenStreetMap; consultar precios de la
API no garantiza por sí solo que los tiles estén disponibles.

## Archivos

Nuevos:
- `src/utils/mapPresentation.js`: posiciones y SVG estático.
- `src/components/StationMapMarker.jsx`: marcador, selección y popup.
- `src/config/navigation.js`: etiquetas de navegación.
- `tests/final-ui.test.mjs`: regresiones específicas.
- Esta guía.

Modificados:
- `src/App.jsx`: textos, integración del mapa y etiqueta administrativa.
- `src/App.css`: alineación del acceso administrativo y estilos de marcadores.
- `src/components/PublicPriceAlerts.jsx`: presentación y prop active.
- `src/hooks/usePublicPriceAlerts.js`: ciclo limitado a la sección activa.
- `src/services/publicPriceAlertsLoader.js`: activación/limpieza comprobable, sin
  reescribir el mecanismo existente de consultas o paginación.
- `src/components/AdminAccessGate.jsx` y `AdminWorkspace.jsx`: solo textos.
- `tests/stations.test.mjs` y `tests/public-price-alerts.test.mjs`: expectativas
  visuales actualizadas; se conservan sus otras comprobaciones.
- `docs/notificaciones-generales.md`: enlace a esta actualización.

No hay dependencias nuevas, cambios en package.json, API, SQL o archivos privados.

## Comprobación en Windows

Usar el entorno de desarrollo existente, sin instalar dependencias nuevas:

```powershell
npm.cmd dev
```

Este comando es para ejecución manual del equipo; no se inició un servidor aquí.
La API central debe estar accesible mediante la URL HTTPS ya configurada. Si se usa
PWA, comprobar que el service worker cargó el nuevo bundle y cerrar pestañas antiguas.

1. A 1366×768 y 1920×1080, abrir Inicio y confirmar las 25 estaciones y siete marcas.
2. Abrir Mapa, usar Mostrar todas y comprobar 25 surtidores y leyenda de marcas.
   Seleccionar desde mapa/listado, revisar tres precios, disponibilidad, marca y
   referencia. Cerrar con X y comprobar el reajuste del ancho.
3. Buscar por nombre, marca y zona; probar filtros y Mostrar todas. Recargar y
   comprobar las mismas posiciones para los mismos IDs. No esperar rutas GPS.
4. Abrir Notificaciones sin sesión: ver avisos generales con precios, variación y
   fecha, sin etiquetas técnicas. Mis notificaciones explica que requiere sesión.
5. En DevTools, filtrar por `public/price-alerts`: una consulta inicial y otra unos
   30 s después de finalizar la anterior. Salir de Notificaciones y esperar: no
   debe continuar el ciclo público. Regresar, actualizar y cargar páginas anteriores.
   Cerrar otras pestañas durante esta comprobación para aislar el conteo.
6. Usar Acceso administrativo, entrar con el usuario existente, comprobar Panel
   admin, navegar y regresar. Probar una actualización autorizada y su historial;
   después de Actualizar, el mapa mantiene ID y posición y presenta el precio nuevo.
   El nombre de la estación y la referencia nunca se sustituyen por otros registros.
7. Verificar avisos personales y marcado como leídas. Cerrar sesión y comprobar
   Acceso administrativo, sin afectar el acceso público.
8. Simular Offline solo en DevTools del cliente y actualizar: comprobar error visible
   y ausencia de precios antiguos como actuales. Restaurar la red y reintentar.

Las pruebas automatizadas usan respuestas y conexiones simuladas. No se ejecutó
esta comprobación visual con la API/Oracle real ni se certificó el aspecto en ambos
tamaños de pantalla desde un navegador de Windows durante esta tarea.

Verificación local completada:

- `npm.cmd test`: 76 pruebas aprobadas, incluyendo nueve regresiones específicas de
  esta entrega y las pruebas anteriores de lectura, avisos y autenticación.
- `python -B -m unittest discover -s backend/tests -t . -v`, usando el entorno de
  pruebas existente: 67 pruebas aprobadas, sin acceso al servidor Oracle.
- `npm.cmd run lint`: sin errores ni advertencias.
- `npm.cmd run build`: compilación y generación de PWA completadas.

Se conserva la advertencia existente de deprecación de Starlette/HTTPX en las pruebas
Python. No se instalaron ni actualizaron dependencias por esa advertencia.

## GitHub y siguientes pasos

No se hizo commit/push. Revisar `git diff` en Windows, preparar solo los archivos
enumerados, comprobar `git diff --cached --check` y confirmar manualmente cuando el
equipo apruebe. Después ejecutar `git push origin fase-4-5` por el flujo habitual.
No preparar .env.local, el entorno privado del backend ni archivos de sesiones.
`e320bee` permanece disponible como referencia del comportamiento anterior.

Antes de Electron quedan la validación visual/manual anterior, revisión de cookies
y origen del futuro escritorio, carga de variables en el build, recursos de mapa
con/sin conexión y pruebas coordinadas entre computadoras. No se implementa Electron
ni se cambian ahora CORS, HTTPS o autenticación para anticipar esas decisiones.
