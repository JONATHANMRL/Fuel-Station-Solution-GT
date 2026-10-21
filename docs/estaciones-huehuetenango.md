# Catálogo de Huehuetenango

Revisión de fuentes públicas: 19 de octubre de 2026. El catálogo actual conserva los 17 nombres solicitados. La limpieza del 20 de octubre retiró los seis registros ficticios del frontend. No se agregó Pegaso Chiantla. No se ha verificado ningún precio actual: los tres combustibles de cada estación del catálogo tienen valor inicial `null` y la fecha de actualización de precios también es `null`.

## Coordenadas corroboradas en fuentes públicas

La verificación es documental, no una inspección de campo. Las correspondencias de nombres descriptivos se indican expresamente; conviene confirmar las fichas exactas de Google Maps antes de publicar un catálogo definitivo.

| N.º de solicitud | Estación | Latitud | Longitud | Evidencia |
|---|---|---:|---:|---|
| 4 | Shell – Zona 5 | 15.312197 | -91.479833 | Coincide por sector con [Shell El Bosque](https://find.shell.com/gt/fuel/10128254-shell-el-bosque-huehuetenango/es_GT); [Waze](https://www.waze.com/es-419/live-map/directions/gasolinera-shell-el-bosque-7-avenida%2C-zona-5-huehuetenango?to=place.w.175964313.1759774203.6801598) confirma zona 5. |
| 5 | METRO Huehuetenango | 15.3217122 | -91.4951885 | [OpenStreetMap, nodo 5342118726](https://www.openstreetmap.org/node/5342118726); coincide con Metro Zaculeu y la referencia 8GC3+MWR. |
| 6 | Don Arturo El Triángulo | 15.30936 | -91.49295 | [COPAR](https://copargt.com/puntos-de-servicio-gasolineras-don-arturo/), registro Triángulo, código 1020. |
| 7 | Shell – Chimusinique | 15.299516 | -91.503072 | Coincide por sector con [Shell Galicia](https://find.shell.com/gt/fuel/10128430-shell-galicia/es_GT). |
| 8 | Texaco One Stop | 15.296615 | -91.490723 | [COPAR](https://copargt.com/puntos-de-servicio-gasolineras-don-arturo/), One Stop, código 1026; [Waze](https://www.waze.com/es/live-map/directions/gt/huehuetenango/huehuetenango/gasolinera-texaco-one-stop?to=place.ChIJPSPYKzcXjIURVzHBZ2SGXIs) confirma el nombre Texaco. |
| 10 | Shell – Barrio El Cambote | 15.302 | -91.492668 | Coincide por sector con [Shell Las Victorias](https://find.shell.com/gt/fuel/10128310-shell-las-victorias/es_GT). |
| 16 | Don Arturo Corona Roja | 15.32388 | -91.46816 | [COPAR](https://copargt.com/puntos-de-servicio-gasolineras-don-arturo/), Corona Roja, código 1049. La fuente indica 1.ª avenida, no 1.ª calle; ambas referencias se conservan en los datos. |
| 17 | Texaco Quetzal | 15.319722 | -91.478639 | [COPAR](https://copargt.com/puntos-de-servicio-gasolineras-don-arturo/), Quetzal, código 1024; [Waze](https://www.waze.com/es-419/live-map/directions/texaco-el-quetzal-1a-calle%2C-zona-8-huehuetenango?to=place.w.175964313.1759774204.225393) confirma Texaco El Quetzal. |

Las coordenadas Shell se leyeron de los campos geográficos de sus páginas oficiales; las de COPAR, de los registros de su localizador público. METRO se contrastó con la respuesta pública de la API OpenStreetMap. Se conserva la atribución OpenStreetMap del mapa existente; sus datos están sujetos a ODbL.

## Referencias pendientes, sin marcador

1. Pegaso Hospital Nacional: no se confirmó una ficha inequívoca próxima al hospital. No se usaron coordenadas de otras Pegaso.
2. Puma Estación Cuevas: [Optioon](https://www.optioon.com/informacion.aspx?de=Puma_Energy_Huehuetenango_Gasolinera) confirma la referencia de km 257, Tojocaz; falta el punto exacto.
3. Shell Calzada Kaibil Balam: [Cascadas](https://find.shell.com/gt/fuel/10128474-shell-cascadas/es_GT) es una candidata, pero la calzada no identifica una sola estación.
9. Uno Terminal: [Cybo](https://es.cybo.com/GT-biz/uno-terminal-huehuetenango) aporta dirección en zona 5; no se pudieron corroborar coordenadas.
11. Puma Centro: [Optioon](https://www.optioon.com/informacion.aspx?de=Puma_Energy_Huehuetenango_Gasolinera) incluye Gasolub en 1.ª calle 5-43, zona 1; falta verificar el punto exacto.
12. Shell Aldea Tojocaz: hay referencias a Las Vegas y [Shell Huehuetenango](https://find.shell.com/gt/fuel/10128525-shell-huehuetenango/es_GT); falta el enlace concreto para decidir cuál corresponde.
13. Texaco, 8F2R+9GX: código corto aportado, sin identidad pública corroborada. No se convirtió en un marcador supuestamente verificado.
14. Puma Pradera: no se usó la ubicación del centro comercial o de una parada de autobús como ubicación de la estación.
15. Shell Zona 1: [El Tanque](https://find.shell.com/gt/fuel/10128348-shell-el-tanque/es_GT) es una candidata; zona 1 sin calle no basta para confirmar la ficha.

## Duplicados y conservación de datos

No se eliminó ni fusionó ninguna referencia real. Las referencias Shell 3 y 12 pueden solaparse con otras de la lista; se guardan como posibles coincidencias pendientes. Los seis registros ficticios anteriores se retiraron por solicitud del usuario; no se identificaron como establecimientos reales ni se transfirieron sus precios o coordenadas a otros registros.

`getStations` devuelve exclusivamente los 17 identificadores del catálogo real y conserva sus precios locales válidos. Excluye las estaciones de prueba antiguas, incluso si siguen guardadas en localStorage. Favoritos, historial y avisos se filtran por pertenencia al catálogo real y se excluyen los registros marcados como ficticios. No se reinician las preferencias ni se escribe sobre el almacenamiento durante las consultas.

## Comportamiento y límites

- Solo se dibujan las ocho ubicaciones corroboradas. Las otras nueve siguen accesibles en la tabla bajo el mapa, el comparador y los favoritos, sin marcador inventado.
- Los precios nulos se muestran como «Precio no disponible», nunca como Q0.00. Se ordenan al final y se excluyen de mínimos y diferencias.
- Las marcas se obtienen del catálogo. Los nuevos nombres aparecen en el selector administrativo existente, que sigue bloqueado por autenticación pendiente; no se ha habilitado ninguna cuenta.
- Se preparó el caso futuro de primer precio: el registro indica que no existe precio anterior y no inventa una subida o bajada. El bloqueo de autorización se ejecuta antes de cualquier escritura.
- No hay distribución de notificaciones entre equipos. No se inició servidor, no se cambió Oracle ni se instalaron dependencias.

Comprobaciones locales, sin servidor: `node --test tests/stations.test.mjs`, `npm run lint` y `npm run build`. La interacción visual en un navegador queda pendiente de revisión.
