# Integración de precios, historial y notificaciones: fases 4 y 5

## Alcance y estado

Implementación local con pruebas simuladas, sin conexiones a Oracle ni ejecución de
SQL, servidores, instalaciones, commit o push. Las consultas y autenticación de las
fases 1–3 conservan sus URLs, contratos, pools, HTTPS y cookies. Las funciones nuevas
están cerradas por defecto y necesitan preparación y comprobación en Oracle Linux.
El catálogo local no se utiliza como respaldo de errores. No se cambia Tailscale,
las variables existentes, contraseñas, las diez tablas, vistas ni procedimientos.

## Respaldo revisado y límites confirmados

Archivo: `database/oracle/GasolinaGT_Respaldo_Actualizado el 19 y 20 de octubre.sql`.
Se revisaron las diez definiciones, claves y relaciones, inserts, tres vistas y el
procedimiento completo. Conteos de INSERT del respaldo (no del servidor actual):

| Tabla | Filas exportadas |
| --- | ---: |
| COMBUSTIBLE | 3 |
| DEPARTAMENTO | 1 |
| GASOLINERA | 25 |
| GASOLINERA_COMBUSTIBLE | 75 |
| MARCA | 7 |
| MUNICIPIO | 1 |
| NOTIFICACION | 2 |
| PRECIO | 77 |
| PREFERENCIA_ALERTA | 1 |
| USUARIO | 1 |

El respaldo exporta además 25 filas de V_GASOLINERA_UBICACION, 75 de
V_MAPA_GASOLINERA y 75 de V_PRECIO_ACTUAL. Son INSERT de exportación de las vistas,
no tablas nuevas ni una indicación de que haya que ejecutar ese archivo. Sus datos
son de demostración aunque ahora la fuente de consulta sea Oracle. El usuario 22
confirmado por el equipo es posterior al respaldo; no se crea ni modifica aquí.

Relaciones: MUNICIPIO → DEPARTAMENTO; GASOLINERA → MUNICIPIO/MARCA;
GASOLINERA_COMBUSTIBLE → GASOLINERA/COMBUSTIBLE (PK compuesta);
PRECIO → esa combinación y ambas entidades; PREFERENCIA_ALERTA → USUARIO/COMBUSTIBLE
(única por usuario/combustible); NOTIFICACION → USUARIO/PRECIO. No hay una FK de
PRECIO al administrador, un campo de autor, ni una clave de solicitud idempotente.

`REGISTRAR_PRECIO(P_ID_GASOLINERA IN NUMBER, P_ID_COMBUSTIBLE IN NUMBER,
P_NUEVO_PRECIO IN NUMBER)` no tiene parámetros OUT ni de usuario. Rechaza precio
nulo/no positivo, exige estación ACTIVA, combustible ACTIVO y combinación DISPONIBLE,
bloquea la combinación, consulta el precio anterior por fecha e ID e inserta PRECIO.
Si existe anterior y el nuevo **baja**, genera NOTIFICACION para cada preferencia
ACTIVA cuyo usuario está ACTIVO y cuyo umbral alcanza el nuevo precio. La restricción
única de preferencias evita múltiples destinatarios iguales por combustible. No
genera avisos de subidas, precio igual o primer precio, ni usa favoritos.
No hay COMMIT/ROLLBACK interno: FastAPI controla la transacción completa. No se
añaden INSERT de avisos desde Python. No hay triggers en este respaldo.

Historial: LAG por estación/combustible, orden FECHA_REGISTRO e ID_PRECIO, antes de
paginar. El primer precio tiene anterior null. Se devuelve `administrator: null` y
la interfaz dice «No registrado en Oracle». El recibo auxiliar tiene el ID del actor
autenticado para operación técnica; no se presenta como columna de auditoría Oracle.
Para una auditoría permanente de autores se requerirá una propuesta posterior del
DBA; no se inventó ni alteró el esquema para resolverla.

## Endpoints

Todos los siguientes requieren la sesión administrativa existente y devuelven
`Cache-Control: no-store`; los POST exigen además Origin permitido y X-Admin-Request.
No aceptan un ID de usuario del cliente para seleccionar notificaciones.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/admin/capabilities` | Banderas de disponibilidad/configuración |
| GET | `/admin/prices` | Precio/ID vigente y disponibilidad por combinación |
| POST | `/admin/prices` | Llamar al procedimiento, con concurrencia e idempotencia |
| GET | `/admin/history?limit=50&offset=0` | Historial Oracle (máximo 100 por página) |
| GET | `/notifications?limit=50&offset=0` | Solo avisos del titular de la sesión |
| POST | `/notifications/{id}/read` | Cambiar su aviso a LEIDA, idempotente, HTTP 204 |

Las rutas GET públicas `/stations`, `/brands`, `/prices` y `/auth/*` no cambian.
El antiguo GET `/notifications` servía una fixture: ahora es real y protegido. La
fixture se conserva explícitamente en `/demo/notifications`; el escritor heredado,
siempre cerrado, en `/demo/admin/prices`. El frontend nunca usa esas rutas demo.
`/favorites` y el antiguo stub de suscripción push no son la fuente de estas fases.

Ejemplo de cuerpo del POST (IDs de ejemplo, obtener los reales de `/admin/prices`):

```json
{
  "station_id": "1",
  "fuel": "regular",
  "price": "29.25",
  "expected_price_id": "100",
  "request_id": "00000000-0000-4000-8000-000000000001"
}
```

`expected_price_id` es null solo si aún no hay precio. No se usa un valor inventado.
Cada operación nueva lleva un UUID nuevo; una repetición exacta conserva el mismo.
Precio Decimal > 0, máximo 999999.99 y dos decimales. No se aceptan NaN/infinitos,
IDs locales, usuario inyectado o combustibles fuera de regular/premium/diesel.
Los IDs 1/2/3 se verifican contra los nombres Regular/Superior/Diésel del catálogo.

## Transacciones, duplicados y errores

La API usa una tercera cuenta/pool. Bloquea la combinación con `FOR UPDATE ... WAIT
5`, relee ID/precio vigente y compara con `expected_price_id`. Si otra PC guardó,
HTTP 409 PRICE_CONFLICT, sin ejecutar el procedimiento. Un precio idéntico tampoco
crea otro registro. Precio y avisos se guardan con un solo commit; los fallos previos
hacen rollback. No se actualiza PRECIO directamente, ni se cambia disponibilidad.

El UUID, actor, huella del cuerpo y recibo se conservan en `price_requests`, dentro
del archivo SQLite privado de sesiones ya existente, fuera de Git y Oracle. No
incluye contraseñas ni cookies. Los workers de la misma VM comparten ese archivo.
Un recibo completo devuelve el resultado con `replayed: true` sin ejecutar otra vez.
Si el UUID cambia de actor/cuerpo, 409. Una solicitud en curso/fallida no se reejecuta.

**No existe una transacción distribuida SQLite–Oracle.** Si se pierde la respuesta
de COMMIT, o cae el proceso entre commit y recibo, se deja pendiente y se bloquea la
repetición. Es una decisión conservadora: puede exigir conciliación manual aunque
Oracle haya hecho rollback. COMMIT_UNCERTAIN/REQUEST_UNRESOLVED nunca se reintentan
automáticamente. El operador debe consultar historial/precio antes de preparar otra
solicitud; no borrar recibos pendientes ni rotar el archivo de sesiones para eludirlo.
No desplegar APIs en varias máquinas con ledgers independientes. Mantener respaldo
y permisos privados del archivo; planificar su retención según el volumen. No hay
garantía de exactamente una vez para clientes que deliberadamente cambien UUID y
referencia del precio: eso constituye una nueva operación autorizada.

El frontend bloquea doble envío mientras guarda, muestra error sin usar datos locales
y exige actualizar precios/historial antes de preparar otro cambio tras un error.
La UI solo habilita Guardar con sesión, configuración habilitada, contexto vigente,
combustible disponible y precio válido. La bandera indica configuración, no prueba
de permisos: el DBA debe verificarlos antes de activarla. Una falta de permisos o
caída de Oracle produce 503 seguro, sin DSN ni detalles del driver.

## Configuración privada en Oracle Linux

No se editó el `.env` privado. El operador debe añadir por su canal privado:

```dotenv
OPERATIONS_ORACLE_USER=GASOLINAGT_OPERACIONES
OPERATIONS_ORACLE_PASSWORD=
PRICE_WRITES_ENABLED=false
ORACLE_NOTIFICATIONS_ENABLED=false
ORACLE_DATA_UTC_OFFSET=-06:00
```

La contraseña vacía es un marcador; provisionar una nueva únicamente para esta
cuenta. No cambiar las existentes. No introducir estas variables en VITE_*, React,
Git o capturas. Hereda ORACLE_ENABLED/HOST/PORT/SERVICE_NAME/SCHEMA y los límites del
pool existente. Confirmar `ORACLE_SCHEMA=GASOLINAGT`; no se fija una IP nueva ni se
cambia HTTPS/Tailscale. Se rechazan cuentas lectoras, autenticación, propietario,
SYS y SYSTEM como usuario de operaciones.

Los TIMESTAMP de PRECIO/NOTIFICACION no tienen zona. Confirmar con el DBA la
convención histórica: el valor inicial -06:00 corresponde a Guatemala. Cambiar
ese offset solo tras comprobar cómo se guardaron las fechas. Se aplica a la sesión
del pool nuevo para CURRENT_TIMESTAMP y a la conversión JSON de fechas sin zona;
no cambia fechas existentes ni la sesión del lector/autenticación.

SQL entregado **para revisión y ejecución manual autorizada**, no ejecutado:

1. `database/oracle/fases4_5_verificacion_revision.sql`: firma/código/validez del
   procedimiento, zona, precios, preferencias y permisos. Confirmar que el
   procedimiento real sigue sin COMMIT, transacciones autónomas ni otros cambios.
2. `database/oracle/fases4_5_permisos_operaciones_revision.sql`: plantilla de cuenta
   nueva y grants mínimos. Solo CREATE SESSION, EXECUTE REGISTRAR_PRECIO, SELECT de
   las cinco tablas usadas, UPDATE(ESTADO) de NOTIFICACION. No DML sobre PRECIO,
   permisos ANY/DBA, hashes ni DML sobre preferencias. No cambia cuentas anteriores.
3. `database/oracle/fase5_preferencia_opcional_revision.sql`: propuesta opcional de
   una preferencia nueva con binds elegidos por el titular/DBA. No sustituye las
   existentes ni hace COMMIT. Solo considerar si falta una preferencia para la
   demostración; no se requiere para consultar/preciar.

No hay dependencias nuevas ni migraciones de las diez tablas. Se usa el mismo
Python 3.12, FastAPI, python-oracledb y SQLite estándar. Reiniciar la API por el
procedimiento habitual tras configurar; dejar las flags false hasta revisar los
grants y validar el entorno. Después habilitar explícitamente las que se vayan a
probar. El runtime crea únicamente el recibo auxiliar local al primer guardado.

## Notificaciones y experiencia existente

El controlador de autenticación de fase 3 se conserva; se aloja en un provider común
para mantener la misma sesión al navegar desde administración a notificaciones.
No hay tokens/passwords en storage. Logout, expiración o cambio de cuenta limpian
los avisos visuales y las respuestas antiguas no restauran datos de otro usuario.
Las cuentas normales siguen consultando precios sin login. Por ahora solo existe
autenticación administrativa: no se implementó login de consumidores ni se expone
un feed global de mensajes personales. Esas identidades necesitan una fase aparte.

Polling cada 30 s y al recuperar foco, una petición a la vez, cancelación al salir
de sesión, paginación y deduplicación por ID. Refrescar vuelve a primera página para
evitar mezclar páginas desplazadas por nuevos eventos. No crea avisos por detectar
cambios en `/stations`. No hay fallback de red a localStorage. Marcar como leídos
solo afecta registros propios; «avisos visibles» actúa sobre los cargados/filtrados,
no sobre páginas ocultas ni otros usuarios. Es consultable desde las tres PCs.

Los avisos anteriores del equipo se conservan en un archivo local desplegable,
etiquetado como ajeno a Oracle; no se enlazan IDs locales con Oracle ni se cuentan
en la campana de avisos reales. Favoritos siguen locales. Los filtros de visualización
locales no se presentan como suscripciones PREFERENCIA_ALERTA. El permiso del
navegador se conserva, pero este mecanismo es polling dentro de la aplicación:
no hay Web Push/VAPID ni avisos con la aplicación cerrada.

## Prueba real coordinada con tres computadoras

1. Registrar los conteos actuales (no exigir 77 después de pruebas previas), firma,
   grants, preferencias y precio/ID elegido. No volver a importar el respaldo.
2. Probar con flags desactivadas: lectura de 25/7/75, mapa/filtros/comparador/favoritos
   y login/logout siguen funcionando; POST sin sesión 401 y con sesión 503.
3. Tras preparar cuenta y flags, iniciar sesión humana en A/B/C. Comprobar sesión
   200, capabilities y GET `/admin/prices`, historial paginado. Confirmar fecha/zona.
4. Con autorización del equipo, elegir un combustible DISPONIBLE y guardar un valor
   distinto en A. Confirmar un precio histórico nuevo y vigencia en `/prices` y
   `/stations`; el frontend A los refresca. En B/C usar Actualizar para releer la
   consulta pública y consultar el mismo ID nuevo en `/admin/prices`.
5. Preparar el precio antiguo en B y guardar otro valor después del cambio de A:
   debe obtener 409 y no crear filas adicionales. Un doble envío con mismo UUID,
   cuerpo y usuario debe devolver replay, sin nuevas filas ni avisos duplicados.
6. Rechazar 0, negativos, exceso de decimales, IDs desconocidos, combustible agotado,
   sesión ausente/vencida, usuario no administrador, Origin ajeno o CSRF faltante.
   Verificar ausencia de nuevos precios/avisos en cada caso. Las pruebas simuladas
   cubren rollback; no provocar un fallo destructivo de red en producción para probarlo.
7. Para avisos del administrador 22, comprobar primero su preferencia ACTIVA y
   umbral; el respaldo solo trae la del usuario 1. No leer ni reasignar avisos de 1.
   Si falta la preferencia, revisar el SQL opcional con el titular. Elegir una bajada
   que alcance el umbral. Debe aparecer exactamente un aviso por preferencia elegible
   en Oracle y en la sección de la cuenta titular dentro de unos 30 s.
8. Una subida o precio inicial no crea avisos con este procedimiento: resultado
   esperado, no error de polling. Marcar un aviso en A y comprobar LEIDA en B/C tras
   actualizar. Intentar leer un ID de otro titular debe dar 404, sin alterarlo.
9. Cerrar sesión: quitar avisos personales y bloquear administración. Confirmar que
   las siete secciones, estilos, mapa y consultas públicas siguen disponibles.

No se presupone refresco automático de todas las consultas públicas en B/C: usan el
botón existente Actualizar. Los avisos sí tienen polling. No deshacer una prueba
borrando historial; cualquier restauración de precio autorizada será otro cambio
mediante el procedimiento y puede generar avisos según sus reglas.

## Archivos de esta implementación

Modificados:
- `backend/main.py`: registro de rutas/pool nuevos y cierre de recursos.
- `backend/.env.example`: plantilla privada vacía, sin tocar el entorno del servidor.
- `src/App.jsx`: conexión del panel y avisos, conservando las siete secciones.
- `src/components/AdminAccessGate.jsx`: consume la sesión compartida existente.
- `src/services/apiClient.js`: peticiones de operaciones y errores seguros; conserva
  los contratos de lectura/autenticación anteriores.

Nuevos:
- Backend: `operations_config.py`, `operations_repository.py`, `operations_api.py`,
  `operation_ledger.py` y `tests/test_operations.py`.
- React: `components/AdminSessionProvider.jsx`, `components/AdminWorkspace.jsx`,
  `hooks/useAdminSession.js`, `hooks/useOracleNotifications.js`,
  `services/oracleOperationsService.js`, `services/notificationLoader.js`.
- Pruebas frontend: `tests/oracle-operations.test.mjs`.
- Los tres SQL de revisión enumerados arriba y esta guía.

Se conservan los cambios previos de corrección de fase 3 que ya estaban en el
directorio de trabajo; no se sobrescriben ni se incluyen en un commit automático.
No cambian CSS, dependencias, catálogo, coordenadas, datos, vistas o autenticación
del backend. El formulario e historial se trasladaron a un componente específico
manteniendo las mismas clases visuales y controles.

## Verificación local

```powershell
backend/.venv-tests/Scripts/python.exe -B -m unittest discover -s backend/tests -t . -v
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Los tests sustituyen repositorios/HTTP/driver, nunca utilizan credenciales privadas.
Cubren fases anteriores y nuevas, firma exacta, commit/rollback, conflicto entre
clientes, UUID persistente, commit incierto, permisos/CSRF, titular de avisos,
contratos JSON, actualización de consulta, polling/paginación y respuestas antiguas.
No certifican la ejecución del SQL real, grants actuales ni cookies de Chrome:
queda pendiente la prueba coordinada anterior. No se inicia ningún servidor local.

Resultado de esta entrega: 59 pruebas Python y 59 pruebas Node aprobadas, lint sin
errores/advertencias y build/PWA completado. Starlette informa de la futura
deprecación de su integración actual con HTTPX; se conserva la dependencia existente,
sin actualizarla como parte de estas fases. Vite puede informar del tiempo del callback
de generación de PWA; no es un fallo de compilación.

Referencias para las decisiones de transacción y bloqueo:
[python-oracledb: transacciones](https://python-oracledb.readthedocs.io/en/stable/user_guide/txn_management.html),
[Oracle: SELECT/FOR UPDATE](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/SELECT.html).
