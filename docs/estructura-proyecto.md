# Estructura de desarrollo frontend

Revisión del 20 de octubre de 2026. No se eliminaron ni movieron archivos. No se inició ningún servidor, no se ejecutó SQL y no se instaló ninguna dependencia.

## Aplicación actual

El frontend utiliza React, Vite y Leaflet. `src/services/gasolinaService.js` consulta el catálogo local y localStorage; no llama a `backend/main.py` ni conecta Oracle. Los scripts de package.json ejecutan Vite u Oxlint y no arrancan Python ni ejecutan SQL. La configuración Vite no incluye un proxy para la API.

La autenticación sigue bloqueada hasta integrar un mecanismo real. La dependencia declarada en backend/requirements.txt relacionada con Oracle no significa que exista una conexión implementada.

## Vista de trabajo en Visual Studio Code

Abre `Fuel-Station-Solution-GT.code-workspace` mediante Archivo → Abrir área de trabajo desde archivo. Mantiene la raíz del repositorio como carpeta de trabajo, por lo que los comandos npm siguen ejecutándose en la ubicación correcta.

Esta vista oculta `backend`, `database`, `node_modules` y `dist` en el explorador. No elimina, mueve ni excluye esos archivos del repositorio o de la compilación mediante reglas nuevas. Las carpetas siguen disponibles en el disco y al abrir la carpeta raíz sin este espacio de trabajo. También puedes desactivar las reglas de `files.exclude` en la configuración del área de trabajo.

```text
Fuel-Station-Solution-GT/
├── src/                         Interfaz, catálogo y servicios locales
├── public/                      Iconos y manifiesto
├── tests/                       Comprobaciones del catálogo y del acceso
├── docs/                        Documentación y fuentes de las estaciones
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
├── .oxlintrc.json
├── .gitignore
├── Fuel-Station-Solution-GT.code-workspace
├── README.md
├── backend/                     Conservado; oculto en esta vista
├── database/oracle/             Conservado; oculto en esta vista
├── node_modules/                Dependencias locales; ocultas
└── dist/                        Compilación generada; oculta
```

Las exclusiones de VS Code son una preferencia del explorador y pueden influir en sus búsquedas predeterminadas. Para revisar la integración, abre la raíz normalmente o desactiva esas exclusiones.

## Archivos que se deben conservar

| Archivo | Motivo |
|---|---|
| backend/main.py | API FastAPI preexistente, endpoints y bloqueo administrativo. No se conecta actualmente al frontend. Contiene tres estaciones y avisos de prueba; no debe usarse como fuente de precios reales. |
| backend/requirements.txt | Declaración de dependencias del componente Python. Debe revisarla el equipo de servidor al preparar su entorno. |
| database/oracle/01_schema.sql | Definiciones de tablas, relaciones e índices para la integración Oracle. No acredita que haya una base creada. |
| database/oracle/02_seed_demo.sql | Inserciones de roles, usuarios, marcas, estaciones y precios de prueba. Se conserva para el equipo, sin ejecutarlo ni incluirlo en el catálogo de la aplicación. |
| src/, public/ y configuración raíz | Son parte de la aplicación actual y deben mantenerse. |
| tests/, docs/ y package-lock.json | Verificación, trazabilidad y versiones de dependencias. |

## Candidatos a una limpieza posterior, sin ejecutar

| Ruta | Situación | Recomendación |
|---|---|---|
| backend/.venv/ | Entorno generado para Linux, Python 3.9.25, con rutas /usr/bin y estructura bin/lib. No es un entorno Windows reutilizable directamente. | Retirable de esta copia tras confirmación del equipo. Se recrea desde dependencias, no se comparte como código fuente. |
| backend/__pycache__/ | Bytecode de Python generado automáticamente. | Retirable tras confirmación; se regenera al ejecutar Python. |
| src/assets/react.svg y src/assets/vite.svg | Recursos de plantilla sin referencias encontradas en la aplicación. | Eliminación opcional, previa confirmación. |
| src/assets/hero.png y public/icons.svg | No se encontraron referencias en el código ni en la configuración revisados. | Conservar hasta confirmar que el equipo no los necesita. |
| dist/ | Resultado regenerable de npm run build. | Mantener fuera del control de versiones; no es necesario borrarlo para desarrollar. |
| node_modules/ | Dependencias instaladas necesarias para trabajar localmente. | Mantener localmente y fuera del control de versiones. No retirarlas ahora. |

Se detectaron 1,856 archivos generados de Python ya registrados en Git, entre `.venv` y `__pycache__`. Las reglas agregadas a `.gitignore` evitan nuevas incorporaciones, pero no retiran archivos ya versionados. No se ejecutó `git rm`, ni siquiera con `--cached`, ni se cambió el índice de Git. Cualquier retirada del repositorio o del disco queda pendiente de aprobación explícita.

No recomiendo borrar `02_seed_demo.sql` ni el resto del backend: pueden ser materiales de trabajo de los compañeros. Su presencia fuera del frontend no los convierte en dependencias de React.

## Preparación para Electron

Se conserva una sola aplicación React/Vite, su configuración, recursos y capa de servicios. No se creó un proyecto paralelo ni se cambiaron rutas, pantallas o funciones para este ordenamiento.

Electron todavía no está implementado: faltan su entrada de escritorio, configuración de carga de la interfaz y empaquetado. También se deberán comprobar las rutas de recursos y el comportamiento PWA al decidir cómo cargar el frontend en la ventana de escritorio. No se añadió Electron ni se generó un instalador.

Oracle y la futura API permanecen como componentes separados. La aplicación deberá consumir operaciones autenticadas de la API cuando esa integración esté disponible; mantener estas carpetas no obliga a ejecutar Oracle o Python en el equipo del frontend.
