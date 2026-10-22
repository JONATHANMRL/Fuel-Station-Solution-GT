# Fuel Station Solution GT — Aplicación

Aplicación React + Vite para consultar estaciones de combustible en Huehuetenango mediante FastAPI y Oracle. La fase 2 consume las consultas HTTP con carga, errores y actualización manual. Configura la URL accesible del backend según [la guía de fase 2](docs/integracion-oracle-fase-2.md). El catálogo de 17 referencias se conserva únicamente para conciliación; no alimenta la aplicación. Consulta [el informe de fuentes y verificación](docs/estaciones-huehuetenango.md).

## Área de trabajo frontend en Windows

Abre `Fuel-Station-Solution-GT.code-workspace` en Visual Studio Code para una vista centrada en el frontend. Oculta en el explorador `backend`, `database`, `node_modules` y `dist`, conservándolos en el disco y manteniendo la raíz para los comandos npm. No elimina ni mueve archivos.

Consulta [la revisión de estructura y los candidatos a limpieza](docs/estructura-proyecto.md). El backend y los scripts Oracle se conservan para la integración del equipo. Electron todavía no está implementado y no se ha generado un instalador.

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

- Mapa Leaflet/OpenStreetMap centrado en Huehuetenango. Las coordenadas Oracle siguen pendientes; existe un modo de demostración opcional y señalado para visualizarlas.
- Filtros de búsqueda, marca, municipio, zona y combustible.
- Comparador con orden ascendente/descendente y selección de hasta dos estaciones.
- Favoritos Oracle, avisos y preferencias locales. Los favoritos del catálogo anterior se conservan por separado, sin equivalencias automáticas.
- Interfaz de acceso administrativo con usuario, contraseña y mostrar/ocultar. La edición de precios sigue bloqueada; el formulario administrativo y el historial se conservan en el código.
- PWA instalable con almacenamiento de recursos estáticos.

El permiso de notificaciones autoriza avisos del navegador. No hay Web Push conectado ni entrega con la aplicación cerrada. No se generan actualizaciones simuladas ni notificaciones iniciales.

La limpieza del 20 de octubre de 2026 retiró los seis registros ficticios del frontend. La lectura del almacenamiento anterior excluye sus estaciones, precios, favoritos, historial y notificaciones. Conserva los registros válidos asociados al catálogo real y las preferencias, sin reiniciar todo el almacenamiento del usuario. Los contadores reflejan únicamente esos registros.

## Preparar la integración futura

La primera fase de lectura Oracle del backend fue comprobada por el equipo en Oracle Linux. Consulta
[la guía de integración Oracle, fase 1](docs/integracion-oracle-fase-1.md) para
configuración privada, contrato JSON, pruebas offline y comandos de conexión
futuros. La [fase 2 de React](docs/integracion-oracle-fase-2.md) ya consume los
endpoints; falta publicar la URL central por Tailscale para probar desde Windows.

`src/services/gasolinaService.js` consulta estaciones, marcas y precios mediante HTTP. No utiliza precios locales como sustituto de fallos de Oracle. Favoritos, avisos e historial anterior mantienen almacenamiento local; la escritura de precios sigue bloqueada. La integración administrativa futura necesitará endpoints autenticados.

## Acceso administrativo

La [fase 3 de autenticación](docs/integracion-oracle-fase-3.md) implementa login por
correo, cookies HttpOnly/Secure, sesiones con vencimiento, logout y autorización
administrativa en FastAPI mediante una lista privada de IDs. Utiliza `USUARIO` y
`CLAVE_HASH` sin cambiar las diez tablas. La cuenta de lectura `GASOLINAGT_API`
permanece separada de la cuenta administrativa propuesta.

No hay administradores habilitados por defecto. El usuario del respaldo tiene un
hash de prueba y no se autoriza automáticamente. El operador debe revisar los SQL
separados, preparar la cuenta de servicio y un usuario humano con hash scrypt,
y configurar el entorno privado. El almacén auxiliar de sesiones SQLite queda
fuera de Oracle y del repositorio. No se guardan secretos de sesión en React.

El panel aparece tras confirmar la cookie con el servidor y permite cerrar sesión.
Las actualizaciones de precios siguen deshabilitadas en la interfaz y en la API,
incluso para administradores autenticados. La conexión real de autenticación queda
pendiente de configuración y prueba coordinada en Oracle Linux.

## Componentes de servidor y base de datos

- `backend/`: conserva la misma API FastAPI y añade consultas de lectura Oracle, configuración privada, adaptación del contrato y pruebas simuladas. Las rutas heredadas de demostración están separadas de las lecturas Oracle. No es necesario para ejecutar el frontend local y las escrituras administrativas siguen bloqueadas. El entorno `.venv` heredado es de Linux/Python 3.9; no se reutiliza en Windows.
- `database/oracle/`: contiene `GasolinaGT_Respaldo_Actualizado el 19 y 20 de octubre.sql`, analizado sin ejecutarlo. Los antiguos `01_schema.sql` y `02_seed_demo.sql` fueron retirados previamente. El backend no ejecuta ni lee el respaldo para atender peticiones: consultará las vistas de la base existente cuando se configure y autorice la conexión.

Esos elementos corresponden a las responsabilidades de los compañeros de servidor y base de datos; conviene conservarlos mientras sean parte del trabajo compartido. Si luego se confirma que tendrán repositorios separados, se pueden retirar de esta copia del frontend con autorización del equipo.
