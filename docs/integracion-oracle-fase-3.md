# Fase 3: autenticación administrativa

## Alcance y modelo Oracle revisado

`USUARIO` tiene `ID_USUARIO`, `NOMBRE`, `CORREO` único, `CLAVE_HASH VARCHAR2(255)`,
`ESTADO` y `FECHA_REGISTRO`. `PREFERENCIA_ALERTA` y `NOTIFICACION` apuntan a su ID.
No hay roles ni sesiones en las diez tablas. El usuario exportado es de prueba,
con hash pendiente: no se habilita ni transforma en administrador.

No se ejecutó SQL ni se conectó al servidor. Los dos scripts `fase3_*_revision.sql`
se entregan separados para revisión. No modifican definiciones de las diez tablas.
El script de usuario humano propone un INSERT para ejecutar después de aprobarlo;
la aplicación no crea usuarios ni cambia hashes desde HTTP.

Las consultas públicas, siete secciones, Leaflet, filtros, favoritos y comparador
se mantienen. El panel aparece tras verificar una sesión real. El campo de acceso
utiliza correo, porque corresponde a `USUARIO.CORREO`; no existe un nombre de login
independiente en Oracle. Los controles para guardar precios permanecen deshabilitados.

## Separación de cuentas y autorización

- `GASOLINAGT_API`: sigue siendo la cuenta de consulta de vistas. No se le concede
  acceso a hashes, usuarios, procedimientos ni DML para esta fase.
- `GASOLINAGT_ADMIN`: cuenta de servicio separada, con contraseña distinta, propuesta
  para autenticación administrativa. Ahora solo necesita `CREATE SESSION` y
  `SELECT` sobre `USUARIO` del propietario. No requiere DBA, cuotas, creación de
  tablas, DML ni `EXECUTE REGISTRAR_PRECIO`. Los permisos de precios se evaluarán
  en otra fase; no se habilitan por haber iniciado sesión.
- Usuarios humanos: filas de `USUARIO` con hash válido y `ESTADO='ACTIVO'`.
  `AUTH_ADMIN_USER_IDS` contiene exclusivamente los IDs revisados por el equipo.
  No se autoriza por correo parecido, posición, el nombre admin ni pertenencia a
  Tailscale. La lista está vacía por defecto y no incluye implícitamente el ID 1.

`OracleUserRepository` utiliza un pool separado y SELECT con parámetros enlazados
para correo e ID. Rechaza usar la misma cuenta del lector, `GASOLINAGT_API`, `SYS`
o `SYSTEM`. Si hay correos que difieren solo en mayúsculas, falla sin escoger uno
arbitrariamente; el DBA debe conciliarlos antes de habilitar esa cuenta humana.

El backend comprueba estado y lista administrativa al iniciar sesión y en cada
petición administrativa. Un cambio de estado, contraseña/hash o autorización
invalida la sesión al siguiente acceso. Cambiar el archivo de configuración exige
reiniciar TODOS los procesos de FastAPI; no se promete recarga dinámica del entorno.

## Hash de contraseña

Se usa scrypt de la biblioteca estándar: N=131072, r=8, p=1, sal aleatoria de 16
bytes y derivación de 32 bytes. El formato cabe en `CLAVE_HASH(255)`. Solo se
acepta ese formato; valores demo, texto plano, parámetros alterados y hashes de
otros algoritmos no se interpretan como contraseñas válidas.

La utilidad, ejecutada por el operador en un equipo autorizado, pide la contraseña
dos veces con entrada oculta y produce únicamente el hash:

```bash
python -m backend.passwords
```

Requiere contraseña de 12 a 1024 caracteres y como máximo 4096 bytes UTF-8. No se
truncan contraseñas ni se pasan como argumentos de consola. Entregar el hash al
DBA mediante canal privado, enlazarlo en el SQL de usuario y no versionarlo.
Los cambios de contraseña y altas de cuentas no se implementan como endpoints.

Esta elección permite hashes seguros sin añadir otra dependencia de ejecución.
scrypt consume aproximadamente 128 MiB por verificación: se limitan a dos
verificaciones simultáneas por proceso. Dimensionar RAM según número de workers.
Verificar la disponibilidad de `hashlib.scrypt` en el Python 3.12 del servidor;
si una política FIPS lo impide, no habilitar login hasta acordar otro algoritmo.

## Sesiones

`POST /auth/login` verifica las credenciales y autorización. Emite un identificador
aleatorio de 256 bits en la cookie `__Host-fsgt_admin`, con `HttpOnly`, `Secure`,
`Path=/`, sin Domain y vencimiento absoluto. El token no se devuelve en JSON.
React solo mantiene temporalmente el correo y fecha de vencimiento; no guarda
contraseña, token, cookie ni una bandera de permiso en localStorage/sessionStorage.

`GET /auth/session` consulta la sesión y vuelve a comprobar al usuario Oracle.
`POST /auth/logout` revoca en el servidor y elimina la cookie, incluso si el token
ya no existe. Si el logout falla por red, React informa el error y no afirma que
la sesión haya sido revocada. El panel comprueba sesión al entrar y recuperar el
foco, y se cierra al alcanzar su vencimiento local. El backend es la autoridad de
permisos y vencimiento; los equipos deben tener la hora sincronizada.

La sesión dura 1800 segundos por defecto, sin renovación deslizante. Un login
nuevo rota la cookie anterior del mismo navegador. Otras sesiones del usuario
siguen siendo independientes hasta vencer o ser revocadas por estado/hash/política.

Para revocación persistente y varios workers en la MISMA VM, se usa un archivo
SQLite privado, fuera de Oracle y del repositorio. Es estado auxiliar de sesiones,
no una nueva tabla de GasolinaGT. Guarda el hash SHA-256 del token, ID de usuario,
huella del hash de contraseña y expiración; nunca la cookie ni la contraseña.
También almacena contadores de intentos. Se crea al primer uso habilitado, no al
importar la aplicación. La carpeta debe prepararla el operador con permisos 700;
el archivo se crea 600 y se rechazan permisos de grupo/otros en Linux. No compartir
este archivo por NFS, Git o entre hosts; si se despliega otra API en otra máquina,
será necesario acordar un almacén de sesiones central diferente.

Se limitan intentos durante ventanas de cinco minutos: cinco por correo, 30 por
IP visible al backend y 60 globales, persistentes entre procesos. El límite puede
afectar a usuarios legítimos y requerir espera; no se resetea mediante logout ni
reinicio. No se confía manualmente en cabeceras X-Forwarded-For enviadas por clientes.

## HTTPS, CORS y CSRF

Solo se aceptan operaciones administrativas sobre HTTPS. Detrás de Tailscale Serve,
Uvicorn debe confiar exclusivamente en el proxy local para reconocer el esquema:

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 \
  --proxy-headers --forwarded-allow-ips=127.0.0.1
```

No se ejecutó este comando en el servidor. No usar confianza `*` ni exponer Uvicorn
directamente mientras confía en cabeceras arbitrarias. Confirmar el proxy real y
su dirección antes de aplicar estos parámetros.

Las mutaciones de autenticación requieren Origin exactamente autorizado y la
cabecera `X-Admin-Request: 1`. La marca no es un secreto ni una contraseña: fuerza
el preflight y, junto con la comprobación de Origin, impide solicitudes CSRF desde
formularios/orígenes no autorizados. CORS permite esa cabecera y credenciales solo
a los orígenes configurados. No se aceptan comodines. Las respuestas de sesión y
errores administrativos llevan `Cache-Control: no-store`; los errores de validación
no reflejan el cuerpo con la contraseña.

`AUTH_COOKIE_SAMESITE=none` permite el flujo actual localhost → API HTTPS dentro
de la tailnet, pero algunos navegadores bloquean cookies de terceros. El frontend
comprueba la cookie con `/auth/session` después del login y NO muestra el panel si
no puede confirmarla. Para un despliegue estable se recomienda servir React y API
en el mismo origen HTTPS, conservando la interfaz; entonces configurar `lax` o
`strict`. No eliminar Secure/HttpOnly ni sustituir la cookie por tokens en storage
para eludir el bloqueo. La comprobación real de navegador queda pendiente del
despliegue HTTPS del equipo; TestClient no reproduce las políticas de terceros.

## Variables privadas del servidor

Mantener `ORACLE_USER` y `ORACLE_PASSWORD` para `GASOLINAGT_API` sin cambios.
Las nuevas credenciales heredan host, puerto, servicio y esquema de esa configuración,
pero utilizan su propio pool y usuario:

```dotenv
AUTH_ENABLED=false
AUTH_ADMIN_USER_IDS=
AUTH_ORACLE_USER=
AUTH_ORACLE_PASSWORD=
AUTH_SESSION_DB=
AUTH_SESSION_TTL_SECONDS=1800
AUTH_COOKIE_SAMESITE=none
# Si se omite, hereda los orígenes CORS explícitos existentes.
# AUTH_ALLOWED_ORIGINS=https://frontend.example.invalid
```

Ejemplo de ruta de estado, no secreto: `/var/lib/fuel-station/auth.sqlite3`.
`AUTH_ALLOWED_ORIGINS` debe corresponder al frontend real y también estar permitido
en `CORS_ORIGINS`. Solo HTTP de localhost se acepta para el desarrollo del frontend;
los orígenes remotos deben ser HTTPS. El transporte hacia la API siempre es HTTPS.

Activar `AUTH_ENABLED=true` únicamente después de preparar cuenta, usuario humano,
hash, lista de IDs y carpeta privada. Variables faltantes producen fallo cerrado;
no se reutiliza la contraseña de la cuenta de lectura. No existe clave secreta
de firma: las sesiones son opacas y aleatorias, no JWT. No hay variables nuevas
`VITE_*`, contraseñas ni ID administrativo fijo en React.

## Preparación del administrador de Oracle Linux

1. Revisar los dos SQL adjuntos y confirmar esquema propietario y FREEPDB1.
2. Crear la cuenta de servicio separada mediante su herramienta privada, conceder
   únicamente los permisos del script revisado y configurar sus credenciales fuera
   de Git. No ampliar `GASOLINAGT_API`.
3. Elegir una persona autorizada, generar el hash con entrada oculta y proponer una
   fila NUEVA mediante el SQL con binds. Revisar el ID retornado y hacer COMMIT solo
   después de aprobarlo. Si falla por una identidad desajustada, detenerse para
   revisión del DBA, sin sobrescribir al usuario de prueba ni alterar tablas aquí.
4. Configurar el ID real en la lista privada. No pegar contraseñas ni hashes en la
   conversación ni en archivos versionados.
5. Provisionar el directorio de sesiones, propietario del proceso FastAPI, con
   permisos 700; configurar ruta absoluta fuera del proyecto y almacenamiento local.
6. Revisar orígenes CORS/auth, proxy HTTPS, SameSite y política del navegador.
7. Reiniciar FastAPI con entorno privado (no carga `.env` automáticamente) y probar
   login, recarga, logout, vencimiento y denegación desde las tres computadoras.
8. Confirmar que consultas públicas siguen funcionando y que Guardar cambios sigue
   deshabilitado; un POST directo autenticado debe devolver 503 `PRICE_WRITES_DISABLED`.

## Pruebas y dependencias

Las dependencias de ejecución no cambian: hashing, sesiones y SQLite usan Python
estándar. Para verificar HTTP se preparó un entorno local aislado `.venv-tests`,
ignorado por Git, con FastAPI y HTTPX; no se instaló Oracle ni se abrió un servidor.
Los repositorios Oracle se simulan. El archivo SQLite de cada test es temporal.

```powershell
backend/.venv-tests/Scripts/python.exe -B -m unittest discover -s backend/tests -t . -v
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

En Oracle Linux utilizar el entorno existente preparado con `requirements-test.txt`
para los tests, y ejecutar la misma suite con `python -B -m unittest ...`.
Las pruebas cubren contraseña válida/incorrecta, hash demo, usuario inexistente,
inactivo o no autorizado, expiración, logout, rotación, reinicio, cambios de
permisos/hash, rate limit, HTTPS, cookies, Origin/CSRF, lectura pública y bloqueo de
escrituras. Los tests frontend verifican errores, cookie confirmada, vencimiento,
logout fallido y respuestas atrasadas sin reabrir el panel.

No se hizo commit ni push. La prueba de integración con Oracle y navegador real
requiere la configuración anterior y autorización del equipo.

## Referencias

- [OWASP: almacenamiento de contraseñas y scrypt](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP: cookies y sesiones](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP: cabeceras personalizadas y Origin contra CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
