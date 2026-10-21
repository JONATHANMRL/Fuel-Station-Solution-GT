// References supplied by the user; only corroborated locations have coordinates.
// updatedAt is the date of a price update, not the date of catalogue research.
const reviewedAt = '2026-10-19'
const copar = 'https://copargt.com/puntos-de-servicio-gasolineras-don-arturo/'
const shell = (id, slug) => `https://find.shell.com/gt/fuel/${id}-${slug}/es_GT`

export const realStations = [
  {
    id: 'hue-real-01', name: 'Gasolinera Pegaso Hospital Nacional', brand: 'Pegaso',
    address: 'Referencia aportada: Hospital Nacional, Huehuetenango.', zone: 'Por verificar',
    verificationNote: 'No se confirmó la estación próxima al hospital. No confundir con Pegaso Chiantla ni Pegaso de Santa Bárbara.',
  },
  {
    id: 'hue-real-02', name: 'Puma Energy Estación Cuevas', brand: 'Puma',
    address: 'Aldea Tojocaz, km 257, ruta CA-1 Occidente.', zone: 'Aldea Tojocaz',
    sources: ['https://www.optioon.com/informacion.aspx?de=Puma_Energy_Huehuetenango_Gasolinera'],
    verificationNote: 'Nombre y dirección corroborados; faltan coordenadas inequívocas de esta estación.',
  },
  {
    id: 'hue-real-03', name: 'Shell – Calzada Kaibil Balam', brand: 'Shell',
    address: 'Calzada Kaibil Balam, Huehuetenango.', zone: 'Por verificar',
    possibleDuplicateIds: ['hue-real-04', 'hue-real-10', 'hue-real-12'],
    sources: [shell('10128474', 'shell-cascadas')],
    verificationNote: 'La calzada contiene varias Shell. Cascadas es una candidata; falta el enlace exacto de Google Maps para identificar esta referencia y descartar duplicados.',
  },
  {
    id: 'hue-real-04', name: 'Shell – Zona 5', brand: 'Shell',
    address: 'Cantón San José, zona 5; Shell El Bosque Huehuetenango.', zone: 'Zona 5',
    lat: 15.312197, lng: -91.479833, locationStatus: 'verified',
    sources: [shell('10128254', 'shell-el-bosque-huehuetenango'), 'https://www.waze.com/es-419/live-map/directions/gasolinera-shell-el-bosque-7-avenida%2C-zona-5-huehuetenango?to=place.w.175964313.1759774203.6801598'],
    verificationNote: 'Correspondencia por zona y dirección: Shell El Bosque. Coordenadas publicadas por el localizador oficial de Shell.',
  },
  {
    id: 'hue-real-05', name: 'Gasolinera METRO Huehuetenango', brand: 'METRO',
    address: '1.ª calle, zona 8; Gasolinera Metro Zaculeu. Referencia 8GC3+MWR.', zone: 'Zona 8',
    lat: 15.3217122, lng: -91.4951885, locationStatus: 'verified',
    sources: ['https://www.openstreetmap.org/node/5342118726', 'https://mapcarta.com/es/N5342118726'],
    verificationNote: 'Coordenadas del nodo OpenStreetMap 5342118726, corroboradas con el nombre y el código de ubicación del directorio.',
  },
  {
    id: 'hue-real-06', name: 'Gasolinera Don Arturo El Triángulo', brand: 'Don Arturo',
    address: 'Calzada Kaibil Balam, Cambote, zona 11. Referencia aportada: 8G54+QR3.', zone: 'Zona 11',
    lat: 15.30936, lng: -91.49295, locationStatus: 'verified', sources: [copar],
    verificationNote: 'Coordenadas del registro Triángulo, código 1020, del directorio de COPAR.',
  },
  {
    id: 'hue-real-07', name: 'Shell – Chimusinique', brand: 'Shell',
    address: 'Chimusinique, zona 12, km 258.4, carretera a La Mesilla; Shell Galicia.', zone: 'Zona 12',
    lat: 15.299516, lng: -91.503072, locationStatus: 'verified',
    sources: [shell('10128430', 'shell-galicia')],
    verificationNote: 'Correspondencia por Chimusinique: Shell Galicia. Coordenadas del localizador oficial de Shell.',
  },
  {
    id: 'hue-real-08', name: 'Gasolinera Texaco One Stop', brand: 'Texaco',
    address: 'Km 257, aldea El Cambote, zona 11, sector 7.', zone: 'Zona 11',
    lat: 15.296615, lng: -91.490723, locationStatus: 'verified', sources: [copar, 'https://www.waze.com/es/live-map/directions/gt/huehuetenango/huehuetenango/gasolinera-texaco-one-stop?to=place.ChIJPSPYKzcXjIURVzHBZ2SGXIs'],
    verificationNote: 'Coordenadas del registro One Stop, código 1026, de COPAR; nombre comercial Texaco contrastado con Waze.',
  },
  {
    id: 'hue-real-09', name: 'Uno Terminal Huehuetenango', brand: 'Uno',
    address: 'Zona 5, Cantón San José; referencia pública: 9.ª calle 12-97, 12 avenida.', zone: 'Zona 5',
    sources: ['https://es.cybo.com/GT-biz/uno-terminal-huehuetenango'],
    verificationNote: 'Dirección corroborada; no se obtuvieron coordenadas verificables del establecimiento.',
  },
  {
    id: 'hue-real-10', name: 'Shell – Barrio El Cambote', brand: 'Shell',
    address: 'Barrio El Cambote, Calzada Kaibil Balam; Shell Las Victorias.', zone: 'Zona 11',
    lat: 15.302, lng: -91.492668, locationStatus: 'verified',
    sources: [shell('10128310', 'shell-las-victorias')],
    verificationNote: 'Correspondencia por Barrio El Cambote: Shell Las Victorias. Coordenadas del localizador oficial de Shell.',
  },
  {
    id: 'hue-real-11', name: 'Puma Energy Centro Huehuetenango', brand: 'Puma',
    address: 'Zona 1; referencia pública: 1.ª calle 5-43.', zone: 'Zona 1',
    sources: ['https://www.optioon.com/informacion.aspx?de=Puma_Energy_Huehuetenango_Gasolinera'],
    verificationNote: 'Dirección de Puma Gasolub corroborada; falta confirmar el punto exacto. No se asignan coordenadas de otras Puma del centro.',
  },
  {
    id: 'hue-real-12', name: 'Shell – Aldea Tojocaz', brand: 'Shell',
    address: 'Aldea Tojocaz, Calzada Kaibil Balam, según referencia aportada.', zone: 'Aldea Tojocaz',
    possibleDuplicateIds: ['hue-real-03', 'hue-real-10'],
    sources: [shell('10128525', 'shell-huehuetenango')],
    verificationNote: 'Hay referencias Shell Huehuetenango y Las Vegas en Tojocaz. La dirección no identifica una sola estación; no se asignan coordenadas hasta confirmarla.',
  },
  {
    id: 'hue-real-13', name: 'Gasolinera Texaco', brand: 'Texaco',
    address: 'Huehuetenango. Referencia aportada de Google Maps: 8F2R+9GX.', zone: 'Por verificar',
    verificationNote: 'Código corto aportado por el usuario, sin ficha pública corroborada. No se convierte en coordenadas verificadas.',
  },
  {
    id: 'hue-real-14', name: 'PUMA ENERGY – Pradera Huehuetenango', brand: 'Puma',
    address: 'Referencia aportada: Centro Comercial Pradera Huehuetenango.', zone: 'Por verificar',
    verificationNote: 'Falta verificar el punto de la gasolinera. Las coordenadas del centro comercial o de una parada de bus no identifican sus surtidores.',
  },
  {
    id: 'hue-real-15', name: 'Shell – Zona 1', brand: 'Shell',
    address: 'Zona 1, Huehuetenango, según referencia aportada.', zone: 'Zona 1',
    sources: [shell('10128348', 'shell-el-tanque')],
    verificationNote: 'El Tanque es una candidata en zona 1, pero la referencia sin calle no permite confirmar la identidad exacta.',
  },
  {
    id: 'hue-real-16', name: 'Gasolinera Don Arturo Corona Roja', brand: 'Don Arturo',
    address: '1.ª avenida 1-23, El Calvario, zona 3. Referencia aportada: 8GFJ+GQR.', zone: 'Zona 3',
    lat: 15.32388, lng: -91.46816, locationStatus: 'verified', sources: [copar],
    verificationNote: 'Coordenadas del registro Corona Roja, código 1049, de COPAR. Se conserva como referencia la 1.ª calle aportada, pero el operador indica 1.ª avenida.',
    userReference: '1.ª calle, Huehuetenango; 8GFJ+GQR.',
  },
  {
    id: 'hue-real-17', name: 'Gasolinera Texaco Quetzal', brand: 'Texaco',
    address: '1.ª calle 0-50, zona 8. Referencia aportada: 8G9C+WHC.', zone: 'Zona 8',
    lat: 15.319722, lng: -91.478639, locationStatus: 'verified', sources: [copar, 'https://www.waze.com/es-419/live-map/directions/texaco-el-quetzal-1a-calle%2C-zona-8-huehuetenango?to=place.w.175964313.1759774204.225393'],
    verificationNote: 'Coordenadas del registro Quetzal, código 1024, de COPAR; Texaco El Quetzal contrastado con Waze.',
  },
].map((station) => ({
  municipality: 'Huehuetenango',
  lat: null, lng: null, locationStatus: 'pending',
  status: 'warning', updatedAt: null,
  prices: { premium: null, regular: null, diesel: null },
  isDemo: false, reviewedAt, sources: [],
  ...station,
}))
