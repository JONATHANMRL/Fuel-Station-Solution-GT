# Gasolina GT — Frontend

Aplicación React + Vite para consultar estaciones de combustible de demostración en Huehuetenango. La información que se muestra en el frontend es ficticia y no debe interpretarse como una lista de estaciones o precios verificados.

## Ejecutar localmente

Requisitos: Node.js 20 o posterior.

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm install --legacy-peer-deps
npm run dev -- --host 0.0.0.0
```

Abre en el navegador la dirección que indique Vite (normalmente `http://localhost:5173`).

Para comprobar la compilación:

```bash
npm run build
```

## Funcionalidad de demostración

- Mapa Leaflet/OpenStreetMap centrado en Huehuetenango con marcadores ficticios.
- Filtros de búsqueda, marca, municipio, zona y combustible.
- Comparador con orden ascendente/descendente y selección de hasta dos estaciones.
- Favoritos, avisos, preferencias e historial guardados en el `localStorage` del navegador.
- Panel visual para cambiar precios de prueba; los cambios se reflejan en mapa, comparador, historial y notificaciones locales.
- PWA instalable con almacenamiento de recursos estáticos.

El permiso de notificaciones solo autoriza notificaciones del navegador en esta demostración. No hay Web Push conectado: no se promete entrega con la aplicación cerrada. Para cambios locales, si el navegador concedió permiso, puede aparecer un aviso mientras la aplicación está abierta.

## Preparar la integración futura

`src/services/gasolinaService.js` concentra operaciones de frontend con almacenamiento local: consultar estaciones, marcas, precios, historial, favoritos y notificaciones, además de actualizar precios de demostración. Todavía no hace solicitudes de red ni se conecta a una API. Cuando el servicio REST del equipo esté disponible, esta capa puede sustituirse por llamadas `fetch` sin acoplar la interfaz directamente a endpoints.

## Elementos preexistentes fuera del alcance frontend

No se modificaron ni eliminaron estas carpetas:

- `backend/`: contiene `main.py`, una API de demostración FastAPI, `requirements.txt` y un entorno virtual generado (`.venv`). No es necesario para ejecutar el frontend.
- `database/oracle/`: contiene `01_schema.sql` con definiciones de tablas e índices Oracle y `02_seed_demo.sql` con inserciones de datos de prueba. No es necesario para ejecutar el frontend.

Esos elementos corresponden a las responsabilidades de los compañeros de servidor y base de datos; conviene conservarlos mientras sean parte del trabajo compartido. Si luego se confirma que tendrán repositorios separados, se pueden retirar de esta copia del frontend con autorización del equipo.
