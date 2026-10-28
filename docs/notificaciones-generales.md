# Ampliación de fase 5: avisos públicos de precios

## Alcance

Se añade GET `/public/price-alerts`, sin login, y el apartado «Avisos generales»
dentro de la sección Notificaciones existente. «Mis notificaciones», su sesión,
preferencias y marcado como leídas permanecen independientes. Los archivos locales
antiguos siguen identificados como ajenos a Oracle. Los avisos públicos no tienen
estado LEIDA ni crean filas en NOTIFICACION; tampoco son notificaciones de escritorio.

No se modifican los diez modelos Oracle, REGISTRAR_PRECIO, las consultas existentes,
el escritor, historial administrativo, autenticación, cookies, CORS, Tailscale,
credenciales, URL HTTPS, mapa, favoritos, comparador o estilos. No hay dependencias
nuevas ni SQL ejecutado. Se conservan los cambios/pruebas previos que ya estaban
sin confirmar en el directorio de trabajo. No se realiza commit, push o despliegue.

## Esquema revisado y consulta

El respaldo `GasolinaGT_Respaldo_Actualizado el 19 y 20 de octubre.sql` define PRECIO
con ID_PRECIO, ID_GASOLINERA, ID_COMBUSTIBLE, PRECIO NUMBER(8,2) y FECHA_REGISTRO
TIMESTAMP(6), sin marca de origen demo ni autor. Las FK relacionan cada registro
con su combinación gasolinera/combustible. La vista V_PRECIO_ACTUAL elige el vigente
por FECHA_REGISTRO DESC, ID_PRECIO DESC; V_MAPA_GASOLINERA aporta las etiquetas públicas.
REGISTRAR_PRECIO agrega historial y solo genera avisos personales de bajadas según
preferencias activas. Nada de ese funcionamiento se sustituye.

El endpoint calcula `LAG(PRECIO)` particionado por ID_GASOLINERA e ID_COMBUSTIBLE,
ordenando por FECHA_REGISTRO e ID_PRECIO. Filtra anterior nulo y precio idéntico
DESPUÉS del cálculo. Por ello el primer precio no es una subida y dos combustibles
o estaciones nunca comparten predecesor. Las etiquetas provienen de la vista ya
consultada por el lector. No se consulta USUARIO, NOTIFICACION o preferencias.

La lectura usa **el mismo pool y credenciales de GASOLINAGT_API** y una transacción
READ ONLY. No usa cuentas de autenticación/operaciones ni crea otra conexión
configurada. Solo se añaden consultas a ese pool, respetando sus límites y timeout.
Los fallos devuelven 503 y un mensaje seguro, sin DSN/password ni datos locales.

La respuesta está limitada: predeterminado 25, máximo 100, más una fila interna
para determinar si hay otra página. Oracle calcula los predecesores; el backend no
descarga todo el historial. El análisis sí necesita leer/ordenar el historial en
Oracle: no se promete coste constante si aumenta mucho su tamaño. Evaluar planes
con el DBA si crece; esta entrega no crea índices ni altera el esquema.

## Contrato público

`GET /public/price-alerts?limit=25&cursor=<nextCursor>`

Solo GET. POST/PUT/PATCH/DELETE sobre esa ruta dan 405. No exige cookie ni lee
identidad; React envía `credentials: 'omit'`. Se conserva CORS existente y el
despliegue HTTPS actual. Las respuestas llevan Cache-Control: no-store.

Campos de respuesta:

| Campo | Significado |
| --- | --- |
| source | `oracle` |
| count | Cantidad de avisos de esta página, no total histórico |
| fetchedAt | Fecha UTC de la consulta |
| limit | Límite solicitado |
| nextCursor | Token de continuación o null |
| activatedAt | Instante de activación configurado, o null |
| alerts | Lista de cambios efectivos |

Cada aviso incluye `id` con prefijo `public-price:`, `priceId` de Oracle como cadena,
`stationId`, `stationName`, `brand`, `fuel` (regular/premium/diesel), `previousPrice`,
`newPrice`, `difference` con signo, `type` up/down, `createdAt`, `context` y `source`.
La UI presenta quetzales con dos decimales y el importe absoluto de la variación.
No se añade un ID a la tabla NOTIFICACION ni se utiliza su namespace.

El cursor codifica fecha TIMESTAMP(6) e ID del último precio de la página. Se valida
su formato/longitud y se pasa a Oracle mediante binds, nunca se concatena a SQL.
La siguiente página usa una comparación estricta por fecha/ID en orden descendente,
con conversión explícita TO_TIMESTAMP del bind ISO para conservar los seis decimales,
no OFFSET: insertar un precio más reciente no desplaza las páginas anteriores ni
repite registros. El cliente deduplica por ID y conserva el orden de Oracle,
incluidos microsegundos; Date de JavaScript solo tiene precisión de milisegundos.
Refrescar vuelve a la primera página y descarta las páginas antiguas cargadas.

La paginación no mantiene una transacción Oracle abierta entre HTTP requests ni
una instantánea distribuida: si alguien corrige/elimina historial o inserta precios
con fechas antiguas por fuera del procedimiento, se requiere refrescar. Las etiquetas
reflejan el catálogo actual y solo se incluyen combinaciones presentes en
V_MAPA_GASOLINERA. El esquema actual conserva las 75 combinaciones; no se inventan
etiquetas de combinaciones eliminadas.

## Histórico de demostración y activación real

Oracle no guarda una columna de procedencia. No es posible certificar por el
respaldo cuáles cambios son comerciales reales y cuáles pertenecen a una prueba.
Tampoco se ha inventado un corte basado en la fecha de esta conversación.

Por defecto `PUBLIC_PRICE_ALERTS_ACTIVATED_AT` está vacío. Todos los cambios tienen
`context: unclassified` y la UI indica «Histórico · origen sin verificar», con una
explicación de que puede incluir demostraciones. No se anuncia como cambio nuevo.

Si el equipo quiere distinguir el período de activación, el administrador registra
UNA VEZ el instante real acordado, ISO 8601 con zona, en la nueva variable privada:

```dotenv
PUBLIC_PRICE_ALERTS_ACTIVATED_AT=
```

La plantilla está vacía deliberadamente. Al activar, el operador puede obtener la
hora real con `date --iso-8601=seconds` en Oracle Linux y conservar ese valor por el
mecanismo privado de entorno del servicio. No volver a calcularlo en cada reinicio,
no copiar una fecha ilustrativa ni reemplazar las variables actuales. Codex no
edita `backend/.env` ni el entorno privado del servidor.

Con esa configuración, el contexto es `before_activation` o `after_activation`
según FECHA_REGISTRO. Es una distinción temporal, no una afirmación de autenticidad
del precio ni un indicador de usuario que lo guardó. El historial anterior sigue
visible y etiquetado, en vez de desaparecer. Una fecha sin zona o inválida produce
un error de configuración al iniciar, sin elegir un corte alternativo.

Se reutiliza la convención ya existente `ORACLE_DATA_UTC_OFFSET` para interpretar
el TIMESTAMP sin zona de Oracle. No cambia esa variable, la zona de la sesión Oracle
ni fechas almacenadas. Confirmar la convención histórica con el DBA si no se hizo
en fases 4/5. Una interpretación temporal equivocada afectaría las etiquetas y la
hora mostrada, no el cálculo Decimal de la variación.

## React y actualización automática

El componente permanece montado dentro de las siete secciones, como el resto de
la aplicación. Consulta al abrir y cada 30 segundos después de completar la petición,
además de al recuperar foco o usar Actualizar. No hay llamadas solapadas: foco,
temporizador y clics se unen a una petición pendiente. StrictMode descarta el setup
inicial antes de iniciar la consulta y se ignoran respuestas/callbacks antiguos.
Al cargar páginas anteriores se pausa el temporizador hasta terminar esa petición.

La lista pública es independiente de la sesión y del filtro personal de favoritos.
No necesita permiso del navegador. Se muestran errores sin reemplazarlos por datos
de localStorage y se reintenta en el siguiente ciclo o manualmente. Con historial
vacío aparece «Todavía no hay cambios efectivos de precios registrados».
El contador/campana de no leídas sigue contando avisos personales, no estados LEIDA
inventados para los generales. Los controles personales y el archivo local no cambian.

El navegador puede retrasar temporizadores en segundo plano. No es streaming ni
Web Push/VAPID, no exige servicios externos y no envía avisos con la app cerrada.
Al abrirla de nuevo consulta la primera página reciente.

## Permiso mínimo pendiente de revisión

El lector ya necesita SELECT sobre las tres vistas de las fases anteriores. Para
ver histórico, puede faltarle SELECT sobre PRECIO. Revisar únicamente:

`database/oracle/avisos_publicos_permisos_revision.sql`

Contiene `GRANT SELECT ON GASOLINAGT.PRECIO TO GASOLINAGT_API`. Si ya lo tiene, no
hace falta concederlo otra vez. El DBA lo revisa y ejecuta manualmente en FREEPDB1
solo si corresponde. No se concede escritura, EXECUTE, acceso a datos personales,
privilegios ANY ni se crea una cuenta nueva. No se ejecutó aquí.

## Integración mediante GitHub (manual, sin acciones automáticas)

En Windows:

1. Revisar el diff y las pruebas. En Source Control de VS Code preparar únicamente
   los archivos del inventario inferior; revisar aparte los cambios anteriores que
   ya estaban pendientes. No preparar `.env`, `.env.local`, hashes o SQLite.
2. Verificar lo preparado con `git diff --cached --stat` y
   `git diff --cached --check`; revisar `git diff --cached` antes de confirmar.
3. Cuando el equipo lo apruebe, hacer commit y push manual en la rama acordada.
   Anotar el hash con `git rev-parse HEAD`. Esta tarea no ejecuta esos comandos
   de publicación ni solicita credenciales de GitHub.

En Oracle Linux, dentro del checkout existente:

```bash
git status --short
git fetch origin
git log --oneline HEAD..origin/<rama_acordada>
git pull --ff-only origin <rama_acordada>
git rev-parse HEAD
```

Sustituir `<rama_acordada>` por la rama revisada, sin los signos `< >`. Si hay cambios
locales o no puede hacerse fast-forward, detener la actualización para conciliarlos;
no usar reset --hard ni sobrescribir archivos privados. Confirmar el mismo hash
revisado en Windows. No hay instalación de dependencias ni importación de respaldo.

El DBA revisa el permiso SELECT. El operador registra el instante opcional de
activación por su mecanismo privado actual; no es obligatorio para leer el histórico.
Reiniciar FastAPI mediante el procedimiento/servicio ya utilizado por el equipo,
sin cambiar Tailscale, puertos, HTTPS, cuentas, passwords o el `.env` privado.
Publicar/recargar el frontend por su flujo habitual. Si usa PWA, confirmar que se
actualizó el service worker y no se está mostrando un bundle anterior.

## Prueba coordinada A/B/C

1. Sin sesión en B (ventana privada), abrir Notificaciones: Avisos generales debe
   consultar GET `/public/price-alerts?limit=25` con HTTP 200; Mis notificaciones
   explica que requiere sesión. No se solicita permiso del navegador.
2. Confirmar registros y etiquetas históricas. Sin fecha de activación deben estar
   sin clasificar. Un 503 exige revisar el permiso SELECT y la conexión existente;
   no habilitar cuentas administrativas para la ruta pública.
3. En A, iniciar sesión con el administrador humano existente y elegir un precio
   DISPONIBLE autorizado para la demostración. Guardar una subida real mediante el
   formulario existente. Verificar el nuevo ID en el historial administrativo.
4. B y C, sin sesión, deben ver el mismo `public-price:<ID_PRECIO>` y la subida en
   unos 30 segundos en una pestaña activa, o al usar Actualizar avisos generales.
   Verificar estación, combustible, anterior, nuevo, diferencia y fecha.
5. Repetir con una bajada autorizada y verificar type down/importe positivo en el
   texto. Las notificaciones personales solo aparecen si cumple su preferencia;
   que no haya aviso personal de la subida es el comportamiento anterior esperado.
6. Pedir cambios anteriores; no deben repetirse IDs si entra un precio reciente
   en A entre páginas. Actualizar vuelve a la página más reciente.
7. El escritor actual rechaza un precio idéntico: no crea registro ni aviso. Los
   históricos de valores iguales ya existentes y el primer precio tampoco aparecen
   como variación. No insertar pruebas manuales de SQL en la base real para forzarlos.
8. Comprobar en A marcado LEIDA, logout y protección de administración. Confirmar
   que B/C no reciben mensajes personales, y que mapa, marcas, filtros, comparador,
   favoritos y las siete secciones mantienen su funcionamiento.
9. Cerrar y abrir B: vuelve a consultar el histórico reciente. No esperar un aviso
   con la aplicación cerrada. No borrar historial para deshacer pruebas.

## Archivos y pruebas

Modificados: `backend/main.py` (ruta/repositorio adicionales), `backend/.env.example`
(variable opcional vacía), `src/services/apiClient.js` (GET público independiente),
`src/App.jsx` (apartados dentro de la pantalla existente).

Nuevos: `backend/public_price_alerts.py`, `backend/tests/test_public_price_alerts.py`,
`src/services/publicPriceAlertsService.js`, `src/services/publicPriceAlertsLoader.js`,
`src/hooks/usePublicPriceAlerts.js`, `src/components/PublicPriceAlerts.jsx`,
`tests/public-price-alerts.test.mjs`, el SQL de permiso y esta guía.

```powershell
backend/.venv-tests/Scripts/python.exe -B -m unittest discover -s backend/tests -t . -v
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Las pruebas nuevas ejecutan la consulta analítica de producción sobre SQLite en
memoria (traducen FETCH FIRST a LIMIT y emulan TO_TIMESTAMP) para comprobar LAG, particiones, iguales,
primer registro, fecha/microsegundos/desempate y paginación con inserciones nuevas.
El driver/pool está simulado y HTTP usa TestClient. Eso NO certifica sintaxis, grants
ni ejecución en Oracle real. Las pruebas frontend simulan HTTP y timers, incluyen
contratos, cookies omitidas, signos, contextos, deduplicación, polling, limpieza,
errores y recuperación. Se ejecutan también todas las suites anteriores para
autenticación, escritura, privacidad personal, catálogo, mapa, filtros y favoritos.

La comprobación real A/B/C queda pendiente de despliegue y permiso del equipo.

Resultado local de esta entrega: 67 pruebas Python y 67 pruebas frontend aprobadas;
lint sin advertencias y build/PWA completado. Tras ajustar la conversión explícita
del cursor TIMESTAMP(6), las ocho pruebas nuevas de backend volvieron a pasar.
Starlette muestra una advertencia de deprecación de su integración con HTTPX y
Vite informa del tiempo del callback de generación de PWA: no fallaron pruebas ni
compilación, y no se actualizaron dependencias ajenas a esta tarea.

Referencia de la consulta: [Oracle 26ai: LAG](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/LAG.html)
y [funciones analíticas](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/Analytic-Functions.html).
