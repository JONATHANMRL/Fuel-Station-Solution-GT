# Fuel Station Solution GT — Aplicación

Aplicación React + Vite para consultar estaciones de combustible en Huehuetenango. Incluye 17 referencias reales aportadas por el usuario: ocho ubicaciones corroboradas en fuentes públicas y nueve sin coordenadas confirmadas. Los precios sin registro se muestran como «Precio no disponible». Consulta [el informe de fuentes y verificación](docs/estaciones-huehuetenango.md).

## Ejecutar localmente

Requisitos: Node.js 20.19 o posterior de la rama 20, o Node.js 22.12 o posterior. Instrucciones para PowerShell en Windows:

```powershell
npm.cmd ci --legacy-peer-deps
npm.cmd run dev
```

Abre en el navegador la dirección que indique Vite (normalmente `http://localhost:5173`).

Para comprobar la compilación:

```bash
npm run build
```

## Funcionalidades

- Mapa Leaflet/OpenStreetMap centrado en Huehuetenango con ocho ubicaciones corroboradas; las otras estaciones se listan sin inventar coordenadas.
- Filtros de búsqueda, marca, municipio, zona y combustible.
- Comparador con orden ascendente/descendente y selección de hasta dos estaciones.
- Favoritos, avisos, preferencias e historial guardados en el `localStorage` del navegador.
- Interfaz de acceso administrativo con usuario, contraseña y mostrar/ocultar. La edición de precios sigue bloqueada; el formulario administrativo y el historial se conservan en el código.
- PWA instalable con almacenamiento de recursos estáticos.

El permiso de notificaciones autoriza avisos del navegador. No hay Web Push conectado ni entrega con la aplicación cerrada. No se generan actualizaciones simuladas ni notificaciones iniciales.

La limpieza del 20 de octubre de 2026 retiró los seis registros ficticios del frontend. La lectura del almacenamiento anterior excluye sus estaciones, precios, favoritos, historial y notificaciones. Conserva los registros válidos asociados al catálogo real y las preferencias, sin reiniciar todo el almacenamiento del usuario. Los contadores reflejan únicamente esos registros.

## Preparar la integración futura

`src/services/gasolinaService.js` concentra las consultas y operaciones locales de estaciones, marcas, precios, historial, favoritos y notificaciones. La escritura de precios se rechaza antes de modificar datos. Todavía no hace solicitudes de red ni se conecta a una API. La futura integración debe enviar las operaciones administrativas a endpoints autenticados.

## Acceso administrativo: integración pendiente

La API existente no verifica contraseñas, roles ni sesiones. No hay cuentas habilitadas ni contraseñas de acceso en el frontend. El formulario no envía, registra ni persiste las credenciales: al enviarlo, muestra un mensaje de acceso no disponible y no crea una sesión. La contraseña solo permanece temporalmente en el formulario y se limpia al enviarlo o salir de la pantalla administrativa. Los detalles de integración se documentan aquí y no se muestran como avisos de desarrollo en el producto.

El panel y el historial administrativo no se renderizan. `updatePrice` rechaza cualquier actualización antes de escribir datos locales. Además, `POST /admin/prices` tiene una dependencia que responde HTTP 503 mientras no exista autenticación. Este bloqueo no valida identidades y no debe confundirse con un sistema de autenticación terminado.

El almacenamiento local está controlado por el navegador y no protege datos contra la edición manual de `localStorage`. En la implementación real, los precios y los permisos deben ser responsabilidad de la API.

Para habilitar administradores se necesita completar, dentro del backend existente:

1. Conectar el almacenamiento de usuarios y roles. Los scripts Oracle ya proponen `USUARIOS`, `PASSWORD_HASH` y `ROLES`, pero no hay integración ni cuentas operativas. No se han ejecutado esos scripts.
2. Crear cuentas mediante una herramienta administrativa del servidor, asignar el rol ADMIN y generar allí un hash seguro con sal por contraseña. No reutilizar los hashes de ejemplo ni incluir contraseñas en el frontend, archivos versionados o registros.
3. Implementar login con errores genéricos para credenciales incorrectas, límites de intentos y verificación del hash en el servidor.
4. Implementar sesiones con vencimiento y revocación al cerrar sesión; para el cliente web, usar cookies HttpOnly y Secure en producción y protección CSRF cuando corresponda. Restringir CORS a los orígenes autorizados y usar HTTPS.
5. Sustituir el bloqueo temporal de la API por verificación de sesión, cuenta activa y rol ADMIN en cada operación administrativa, incluidos cambios de precios y consulta del historial. Responder 401/403 según corresponda.
6. Conectar la interfaz al login, comprobación de sesión y logout. Solo entonces el componente de acceso podrá renderizar el panel y mostrar un botón de cierre de sesión. No autorizar el actual escritor de precios locales con una bandera del navegador: las escrituras deben pasar a la API protegida.
7. Probar sesiones expiradas, logout, permisos insuficientes y llamadas directas a la API sin sesión antes de habilitar las modificaciones.

No se ha creado ninguna base de datos ni servidor nuevo, y no se han instalado dependencias para esta interfaz. El cierre de sesión queda pendiente junto con las sesiones reales; actualmente ningún envío del formulario crea una sesión.

## Componentes de servidor y base de datos

- `backend/`: contiene `main.py`, una API de demostración FastAPI, `requirements.txt` y un entorno virtual generado (`.venv`). No es necesario para ejecutar el frontend. Las escrituras administrativas están bloqueadas mientras se integra autenticación.
- `database/oracle/`: contiene `01_schema.sql` con definiciones de tablas e índices Oracle y `02_seed_demo.sql` con inserciones de datos de prueba. No es necesario para ejecutar el frontend.

Esos elementos corresponden a las responsabilidades de los compañeros de servidor y base de datos; conviene conservarlos mientras sean parte del trabajo compartido. Si luego se confirma que tendrán repositorios separados, se pueden retirar de esta copia del frontend con autorización del equipo.
