# Fase 2: React consume las consultas FastAPI

## Estado y alcance

La fase 1 fue comprobada por el equipo en Oracle Linux con Python 3.12 y Oracle
Database 26ai Free: 25 estaciones, siete marcas, 75 precios y 25 precios de regular.
Es una confirmación del equipo, no una conexión realizada desde esta sesión Windows.

React ahora obtiene estaciones y precios mediante HTTP. No importa
`src/realStations.js`, no lee precios de `localStorage` y no se conecta a Oracle.
La referencia local y el respaldo SQL permanecen intactos. No se modifican
FastAPI, las tablas ni las reglas de `REGISTRAR_PRECIO`.

Se conservan las siete secciones, los estilos, navegación por hash, filtros,
comparador, Leaflet, colores de marcas, leyenda y panel lateral cerrable.
La autenticación y las escrituras continúan bloqueadas. No se implementan
notificaciones Oracle ni Electron.

## Configuración del frontend

Copiar `.env.example` a `.env.local` en la raíz cuando se conozca una URL accesible
desde Windows. El archivo local está ignorado por Git. Ejemplo ilustrativo:

```dotenv
VITE_API_BASE_URL=https://servidor.tailnet-ejemplo.ts.net
VITE_API_TIMEOUT_MS=12000
VITE_MAP_DEMO_MODE=false
```

El dominio del ejemplo no es un servidor configurado. Sustituirlo por la URL real
que entregue el operador de Tailscale. No hay URL ni IP por defecto. Una URL vacía,
con credenciales embebidas, parámetros, fragmentos o protocolo distinto de HTTP(S)
se rechaza antes de realizar una petición.

Las variables `VITE_*` son públicas en el código entregado al navegador. Aquí
solo contienen URL, tiempo de espera y una opción visual: nunca usuario Oracle,
contraseña, DSN o credenciales de administrador. Reiniciar Vite después de cambiar
`.env.local`; para producción, generar nuevamente la compilación.

## Flujo de datos

- `apiClient.js` realiza únicamente GET, sin credenciales, sin caché HTTP y con
  cancelación y tiempo máximo. Valida procedencia `oracle`, estructura, tipos,
  identificadores, precios, disponibilidad y coordenadas. No carga fixtures.
- `gasolinaService.js` expone funciones asíncronas:
  `getStations()`, `getStationSnapshot()`, `getBrands()` y `getPrices(fuel)`.
- La pantalla usa `/stations` como un conjunto coherente: ya contiene marcas,
  disponibilidad y los tres precios. No mezcla en una misma pantalla tres
  peticiones tomadas en momentos distintos. `/brands` y `/prices` están disponibles
  mediante los servicios y se comprueban en las pruebas HTTP simuladas.
- `useStationData` inicia la consulta al montar. El botón superior permite
  **Actualizar** y cambia a **Reintentar** ante un error. No hay sondeo automático
  ni detección de cambios que genere alertas.
- `stationLoader` cancela consultas anteriores y descarta respuestas atrasadas,
  incluso si el transporte no respeta AbortSignal. Contempla la limpieza y el
  reinicio de efectos de React StrictMode.
- Durante una carga o un error, la colección de estaciones se vacía; los precios
  anteriores no se presentan como vigentes. El mensaje de error permanece visible
  en cualquier sección y se puede reintentar sin recargar la aplicación.
- `fetchedAt` se muestra como fecha de **consulta**. `updatedAt: null` se presenta
  como fecha no disponible: no se fabrica la fecha de modificación de un precio.
- Si Oracle devuelve cero estaciones válidamente, se muestra el catálogo vacío.
  Un fallo HTTP, CORS, red, timeout o contrato no se transforma en un catálogo local.

## Disponibilidad y comparación

Los importes recibidos se conservan y se muestran en quetzales. Se identifica
`Disponible`, `Agotado`, `Estación inactiva` o `Sin precio disponible`.

Para participar en ordenamiento de precios disponibles, mínimo, selección y
diferencia entre dos estaciones se exige:

1. Precio numérico positivo.
2. Estación en estado `ACTIVA`.
3. Combustible en estado `DISPONIBLE`.

Los agotados conservan su último importe visible y quedan después de los
disponibles tanto en orden ascendente como descendente; no ganan el mínimo.
Si una selección anterior deja de ser válida al cambiar combustible o actualizar,
no se calcula su diferencia. No se altera la disponibilidad almacenada en Oracle.

## Favoritos y datos locales anteriores

Los favoritos Oracle usan `gasolina-gt:oracle:favorites`. Se normalizan a cadenas
de identificadores positivos sin asumir secuencias ni un catálogo de tamaño fijo.
Se conservan incluso si no aparecen en una respuesta posterior; una caída no los
borra. Solo se muestran tarjetas de favoritos que pertenecen al catálogo consultado.

La clave anterior `gasolina-gt:favorites` no se modifica. `hue-real-01`, `est-1` y
Oracle `1` no son equivalentes. No hay migración automática por nombre, número,
posición o coordenadas. Si hay favoritos del catálogo anterior, la sección informa
que es necesario elegir nuevamente las estaciones Oracle.

Los avisos y preferencias locales existentes se conservan. No se llama a las rutas
heredadas de demostración `/notifications` o `/favorites` de FastAPI. Un aviso
local que referencia una estación antigua puede marcarse como leído, pero no se
abre una estación Oracle diferente: se informa que esa referencia no está en el
catálogo actual. El historial local anterior no se usa como precio actual.

## Mapa y demostración de coordenadas

Las coordenadas Oracle se mantienen `pending`: no se copian coordenadas ni estados
de verificación desde las 17 referencias. Por defecto no se dibujan marcadores
pendientes; las estaciones se pueden consultar en el listado y en su panel.

Para una demostración autorizada, establecer `VITE_MAP_DEMO_MODE=true`, reiniciar
Vite y activar explícitamente la casilla en la sección Mapa. La casilla inicia
desactivada y no se guarda en el navegador. Al activarla:

- Se dibujan únicamente coordenadas Oracle numéricas dentro de rango.
- Aparece una advertencia de **Modo de demostración** en el mapa y una indicación
  en las ventanas emergentes de los marcadores pendientes.
- Los objetos conservan `locationStatus: pending`; no se guardan verificaciones.
- No se ofrecen enlaces de navegación hacia ubicaciones no verificadas.
- El panel mantiene su X, la selección y el ajuste de tamaño Leaflet existentes.

Volver a desactivar la casilla oculta los marcadores pendientes. No se agregan
gasolineras ni se cambian coordenadas, precios o datos de Oracle.

## Pruebas disponibles sin servidores

Desde PowerShell en la raíz, con las dependencias frontend ya existentes:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

No se instalan paquetes. Las pruebas inyectan respuestas en `fetch`; usan el
dominio no resoluble `api.test.invalid` solo como dato y no hacen conexiones.
Los fixtures viven en `tests/fixtures`, fuera de `src` y `public`.

Se comprueban 25 estaciones, siete marcas, 75 precios, filtro de combustible,
IDs fuera del catálogo anterior, errores HTTP/red/JSON, timeout/cancelación,
respuestas atrasadas, reintento, falta de configuración, conservación de favoritos,
rechazo de datos demo, disponibilidad, comparación y mapa pendiente/demostración.
También se conservan las pruebas de colores y leyenda y las de referencia local.

Estas pruebas y la compilación no reemplazan una prueba visual en navegador ni la
comprobación Windows–Tailscale, que sigue pendiente. En esta fase no se inició un
servidor local ni se intentó acceder al servidor central.

## Qué falta para usar FastAPI central desde Windows

La API escucha en `127.0.0.1:8000` **dentro de Oracle Linux**. Esa dirección en
Windows sería el propio Windows: cambiar solamente `VITE_API_BASE_URL` no publica
el servicio remoto.

El operador debe completar por separado:

1. Publicar la API dentro de la tailnet. Se recomienda un proxy privado HTTPS
   mediante Tailscale Serve hacia `http://127.0.0.1:8000` en la VM. Esto permite
   conservar Uvicorn escuchando en localhost. Confirmar certificados HTTPS y reglas
   de acceso para las tres computadoras. No se requiere publicación a Internet.
2. Entregar la URL HTTPS privada real del servicio. No usar la dirección/puerto del
   listener Oracle como URL del frontend.
3. Confirmar que Windows esté conectado a la tailnet y pueda acceder al servicio.
4. Configurar `CORS_ORIGINS` en el backend con el origen exacto de Vite, por ejemplo
   `http://localhost:5173` o `http://127.0.0.1:5173`. Si Vite elige otro puerto u
   origen, agregarlo explícitamente y reiniciar FastAPI. No usar `*`.
5. Definir `VITE_API_BASE_URL` en `.env.local` y reiniciar Vite.
6. Abrir la aplicación y comprobar 25 estaciones, siete marcas, precios correctos,
   agotados excluidos, favoritos tras recargar y mapa pendiente por defecto.
7. Probar Actualizar en las tres computadoras y confirmar que leen el mismo
   catálogo. Simular un corte autorizado para comprobar el error y el reintento,
   sin actualizar precios ni modificar el esquema para esta prueba.

No se ha cambiado la escucha de Uvicorn, Tailscale, CORS del servidor, Oracle,
autenticación, escrituras ni notificaciones remotas durante esta fase.

## Referencias

- [Variables y modos de Vite](https://vite.dev/guide/env-and-mode)
- [Tailscale Serve privado y HTTPS](https://tailscale.com/docs/features/tailscale-serve)
- [Orígenes CORS en FastAPI](https://fastapi.tiangolo.com/tutorial/cors/)
