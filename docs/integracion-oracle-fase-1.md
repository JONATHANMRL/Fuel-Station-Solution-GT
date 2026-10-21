# Integración Oracle, fase 1: consultas de lectura

## Alcance implementado

Se aprovecha la misma aplicación FastAPI de `backend/main.py`. Se añaden lecturas
Oracle a `/stations`, `/brands` y `/prices`, sin cambiar React, sus estilos, su
catálogo, sus favoritos ni su almacenamiento. No se ejecuta el respaldo SQL.
No se incorporan autenticación, escrituras, alertas Oracle ni Electron.

**React todavía usa sus servicios locales.** Esta fase prepara y comprueba el
backend; activar las consultas HTTP en React y conciliar los identificadores es
el siguiente cambio coordinado. `src/realStations.js` permanece intacto como
referencia de conciliación: el nuevo repositorio Oracle nunca lo importa ni lo
utiliza como sustituto de una consulta fallida.

Las rutas heredadas `/favorites`, `/notifications`, `/notifications/push/subscribe`
y `/admin/prices` se conservan aparte, etiquetadas como demostración heredada en
OpenAPI. No se conectan a Oracle ni se deben consumir como servicios integrados.
La actualización administrativa sigue bloqueada. Sus datos en memoria no se
mezclan con las tres rutas de consulta Oracle. `/health` solo indica que el proceso
responde; **no verifica la base de datos**.

## Archivos y responsabilidades

| Archivo | Responsabilidad |
|---|---|
| `backend/main.py` | Aplicación existente, fábrica para pruebas, CORS y cierre del repositorio |
| `backend/config.py` | Variables del servidor y validación de configuración |
| `backend/oracle_repository.py` | Pool lazy, consultas de solo lectura, límites de tiempo y errores seguros |
| `backend/station_contract.py` | Agrupación y conversión sin FastAPI ni Oracle; se prueba con biblioteca estándar |
| `backend/read_api.py` | Rutas y modelos JSON de respuesta |
| `backend/.env.example` | Plantilla vacía, sin IP fija ni contraseña |
| `backend/requirements.txt` | Dependencias de ejecución, incluido `oracledb` |
| `backend/requirements-test.txt` | Dependencias para pruebas HTTP en memoria |
| `backend/tests/` | Datos sintéticos y pruebas sin servidor ni Oracle |

## Configuración privada

`OracleSettings.from_env()` lee el entorno del proceso. **No carga un `.env`
automáticamente**. Se puede tomar la plantilla para preparar un archivo privado
del servicio fuera del repositorio, por ejemplo `/etc/fuel-station/oracle.env`,
con acceso restringido al usuario del servicio. También se pueden definir las
variables directamente en la sesión que ejecutará FastAPI.

| Variable | Uso |
|---|---|
| `ORACLE_ENABLED` | `false` por defecto; debe cambiarse explícitamente a `true` |
| `ORACLE_HOST` | Host de Oracle, sin valor por defecto |
| `ORACLE_PORT` | Puerto TCP, `1521` por defecto |
| `ORACLE_SERVICE_NAME` | Servicio de la PDB; para el servidor comunicado: `FREEPDB1` |
| `ORACLE_USER`, `ORACLE_PASSWORD` | Cuenta de lectura y su contraseña, solo en el servidor |
| `ORACLE_SCHEMA` | Propietario de las vistas si difiere del usuario; identificador simple sin comillas |
| `ORACLE_POOL_MAX` | Máximo de conexiones, por defecto 4 |
| `ORACLE_POOL_WAIT_MS` | Espera máxima para obtener conexión, por defecto 5000 ms |
| `ORACLE_CONNECT_TIMEOUT_S` | Tiempo de conexión TCP, por defecto 5 s |
| `ORACLE_CALL_TIMEOUT_MS` | Límite por llamada Oracle, por defecto 5000 ms |
| `CORS_ORIGINS` | Orígenes HTTP(S) explícitos separados por comas; no admite `*` |

Las claves privadas no deben utilizar nombres `VITE_*` ni guardarse en React,
`public/`, el instalador o el respaldo versionado. `.env` y `.env.*` están
ignorados, salvo `.env.example`. La contraseña no aparece en el `repr` de la
configuración ni en las respuestas de error. No se registran excepciones del
driver con sus datos de conexión.

La cuenta Oracle debe tener `CREATE SESSION` y `SELECT` sobre las tres vistas del
propietario correspondiente. No necesita DML, ejecución de `REGISTRAR_PRECIO`,
privilegios DBA, ni las cuentas `SYS` o `SYSTEM`. El equipo DBA debe confirmar los
permisos efectivos; aquí no se crean cuentas ni se ejecutan `GRANT`.

## Consultas y consistencia

Cada petición adquiere una conexión del pool, inicia `SET TRANSACTION READ ONLY`
y lee las tres vistas en la misma transacción consistente:

1. `V_GASOLINERA_UBICACION`: conjunto base, coordenadas, dirección y geografía.
2. `V_MAPA_GASOLINERA`: marca y correspondencia estación–combustible.
3. `V_PRECIO_ACTUAL`: precios vigentes y disponibilidad.

No se consulta ninguna tabla de usuarios ni notificaciones. No hay `INSERT`,
`UPDATE`, `DELETE`, `COMMIT`, llamadas a procedimientos ni lectura del archivo SQL
en el repositorio. Al devolver la conexión se termina la transacción de lectura.

El pool se crea al llegar la primera lectura configurada, no al importar el
módulo o consultar `/health`. Usa modo Thin, tiempos máximos y comprobaciones de
conexiones del pool. Un fallo al crear el pool permite intentar su creación en la
siguiente petición. No se repiten automáticamente las consultas de una petición
fallida ni se guardan precios locales como sustitutos.

Los resultados no tienen fijado el número 25: deben reflejar la base consultada.
El respaldo actual establece la expectativa inicial de 25 estaciones, siete
marcas y 75 precios. Una base vacía devuelve colecciones vacías.

## Contrato JSON

Rutas:

| Petición | Resultado |
|---|---|
| `GET /stations` | `{source, count, fetchedAt, stations: [...]}` |
| `GET /brands` | `{source, count, fetchedAt, brands: [...]}` |
| `GET /prices` | `{source, count, fetchedAt, prices: [...]}` |
| `GET /prices?fuel=regular` | Solo precios de regular; también acepta `premium` y `diesel` |

`count` es el número de elementos de esa colección. `fetchedAt` es la fecha UTC
de la lectura de la API, **no** la fecha en que cambió un precio.

Ejemplo sintético de un elemento de `stations` (no representa una estación real):

```json
{
  "id": "1",
  "name": "Estación SIMULADA 1",
  "brand": "Shell",
  "address": "Zona 1, dirección SIMULADA",
  "municipality": "Municipio de prueba",
  "department": "Departamento de prueba",
  "zone": "Zona 1",
  "lat": 15.3,
  "lng": -91.4,
  "locationStatus": "pending",
  "stationStatus": "ACTIVA",
  "status": "active",
  "updatedAt": null,
  "prices": {"premium": 32.25, "regular": 31.25, "diesel": 33.25},
  "availability": {"premium": "DISPONIBLE", "regular": "DISPONIBLE", "diesel": "DISPONIBLE"},
  "source": "oracle",
  "isDemo": false
}
```

Reglas:

- Los identificadores son cadenas estables: no se presupone que sean consecutivos.
- Se valida la correspondencia del respaldo: 1 Regular → `regular`, 2 Superior →
  `premium`, 3 Diésel → `diesel`. Se tolera mayúsculas y ausencia de tilde. Un ID
  asociado a otro combustible produce un error de contrato.
- Los importes son números JSON, no cadenas. No se inventan ni se redondean
  precios del servidor. Las tres claves de precio existen incluso si son `null`.
- `AGOTADO` conserva el último importe y expone la falta de disponibilidad por
  separado. `/prices` añade `available: false` para combustible agotado o estación
  inactiva. Antes de activar React con estos datos, el comparador deberá excluir
  explícitamente los registros no disponibles; todavía no se cambia esa lógica.
- `NO_REGISTRADO` significa que las vistas no aportan precio/disponibilidad para
  esa clave. No permite inferir que la estación vende ese combustible.
- Se preservan estaciones sin precios gracias al conjunto base y al LEFT JOIN.
- `updatedAt` queda `null`: las vistas no exponen la fecha del precio. No se usa
  `FECHA_REGISTRO` de la gasolinera como fecha de actualización del combustible.
- `zone` se extrae solo si la dirección contiene `Zona N`; en otro caso es
  `Por verificar`. Es una derivación textual, no una nueva columna Oracle.
- Las coordenadas inválidas o incompletas se entregan como pareja `null`.
- **Todas las ubicaciones Oracle quedan `pending`** hasta conciliarlas. Valores
  dentro del rango no implican verificación física. El mapa React actual exige
  `verified`; no se cambia esa protección para hacer aparecer puntos dudosos.
- `source: oracle` e `isDemo: false` identifican la ruta de datos operativos, sin
  fixtures en memoria. No certifican precios de mercado ni convierten datos de
  prueba guardados en Oracle en datos verificados. El DBA debe confirmar su
  procedencia. Las filas de prueba automatizada viven únicamente en `backend/tests`.
- `/brands` incluye `count` y el alias histórico `stations` para mantener el campo
  de conteo expuesto por la API anterior.
- El respaldo utiliza galones para los tres combustibles. Las vistas no incluyen
  unidad; el DBA debe confirmar esta condición antes de conectar la interfaz que
  presenta precios por galón. No se convierten unidades silenciosamente.

Sin configuración válida o con fallo de lectura, las tres rutas responden 503:

```json
{"detail":{"code":"ORACLE_NOT_CONFIGURED","message":"No fue posible consultar Oracle. Revisa el servicio y su configuración privada."}}
```

Otros códigos: `ORACLE_DRIVER_UNAVAILABLE`, `ORACLE_UNAVAILABLE` y
`ORACLE_INVALID_DATA`. No se devuelven DSN, contraseñas ni mensajes internos.
Un combustible de consulta desconocido responde 422. No hay fallback demo.

## Pruebas locales sin conexión

Desde la raíz, con Python 3.11 o 3.12 disponible:

```powershell
py -3.11 -B -m unittest discover -s backend/tests -t . -v
node --test tests/stations.test.mjs tests/map-brand-styles.test.mjs
npm.cmd run lint
```

Los tests de configuración, adaptador y repositorio usan solo la biblioteca
estándar. Simulan 25 estaciones con IDs no consecutivos, siete marcas y 75
precios. El driver y pool también son simulados: no se resuelve un host ni se
contacta con Oracle. Los tests HTTP usan `TestClient` en memoria, sin abrir un
servidor; se omiten con un motivo explícito si faltan FastAPI/Pydantic/HTTPX.

Para ejecutar también los tests HTTP, cuando se autorice preparar dependencias,
crear un entorno nuevo: el `.venv` heredado de Linux/Python 3.9 no es reutilizable
en Windows. No instalar esas dependencias en React.

## Preparación futura en Oracle Linux (comandos no ejecutados en esta fase)

Requisito: disponer de Python 3.11 o 3.12, acceso al proyecto y permisos acordados.
No se debe dar por disponible ese Python por el solo hecho de tener Oracle Linux.
Ejemplo desde la raíz del repositorio:

```bash
python3.11 -m venv backend/.venv-oracle
backend/.venv-oracle/bin/python -m pip install -r backend/requirements.txt
# Solo para verificar las pruebas HTTP, si se autoriza:
backend/.venv-oracle/bin/python -m pip install -r backend/requirements-test.txt
backend/.venv-oracle/bin/python -B -m unittest discover -s backend/tests -t . -v
```

El driver se instala como **`oracledb`**, no `python-oracledb`. En modo Thin no se
necesita Instant Client. Los requisitos tienen límites de versión; después de
validarlos en el servidor debe guardarse un bloqueo de versiones para reproducir
el despliegue. No se generó un bloqueo sin instalar y comprobar los paquetes.

Preparar las variables del servicio de manera privada. Si se usa un archivo de
entorno compatible con shell, cargado únicamente por el operador autorizado:

```bash
set -a
. /etc/fuel-station/oracle.env
set +a
backend/.venv-oracle/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Alternativamente, un servicio systemd puede leer su `EnvironmentFile` privado.
No poner la contraseña en el comando, en un commit ni en una captura. El comando
de arranque se ejecuta desde la raíz (`backend.main:app`); no `main:app` desde la
carpeta `backend`.

Después, desde ese mismo servidor, con el proceso autorizado en marcha:

```bash
curl --fail http://127.0.0.1:8000/health
curl --fail http://127.0.0.1:8000/stations
curl --fail http://127.0.0.1:8000/brands
curl --fail 'http://127.0.0.1:8000/prices?fuel=regular'
```

Solo las tres últimas peticiones intentarán consultar Oracle si está habilitado.
Comprobar 25 estaciones, siete marcas y 25 precios de regular contra el servidor;
no actualizar precios para esta prueba.

## Datos que necesitamos del equipo Oracle

1. Confirmación del servicio `FREEPDB1` abierto y del puerto de listener `1521`.
2. Nombre exacto del esquema propietario y confirmación de las tres vistas válidas.
3. Cuenta dedicada de solo lectura y contraseña entregada por un canal privado,
   directamente al operador del backend; no hace falta pegarla en la conversación.
4. Confirmación de `CREATE SESSION` y `SELECT` sobre las tres vistas.
5. Host según la ubicación final de FastAPI: si comparte VM, usar la dirección
   local donde escuche Oracle; si es remoto, la IP Tailscale actual comunicada es
   `100.99.27.57`, configurable mediante `ORACLE_HOST`, no fijada en Python.
6. Confirmación de Python compatible y dependencias preparadas en Oracle Linux.
7. Confirmación de las reglas de Tailscale y firewall que permitan solo el tráfico
   necesario. No se han probado ni cambiado en esta fase.
8. Validación de procedencia de precios, unidad galón y coordenadas antes de
   publicarlos como datos reales/verificados en React.

Para tres computadoras se recomienda una sola API central. Los clientes acceden
a su URL HTTPS privada por Tailscale; no reciben la contraseña Oracle. Si se usa
Tailscale Serve como proxy, FastAPI puede seguir escuchando en localhost. Si la
API y Oracle están separados, permitir TCP 1521 desde el backend autorizado;
no abrirlo a Internet ni a todos los clientes por defecto.

## Fuentes técnicas

- [Instalación y modo Thin de python-oracledb](https://python-oracledb.readthedocs.io/en/stable/user_guide/installation.html)
- [Pools, adquisición y conexiones Oracle](https://python-oracledb.readthedocs.io/en/stable/user_guide/connection_handling.html)
- [Pruebas FastAPI con dependencias sustituidas](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
- [Control de acceso Tailscale](https://tailscale.com/docs/features/access-control/grants)
