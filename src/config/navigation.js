export const navigation = Object.freeze([
  { id: 'inicio', label: 'Inicio' },
  { id: 'mapa', label: 'Mapa' },
  { id: 'marcas', label: 'Marcas' },
  { id: 'comparar', label: 'Comparar precios' },
  { id: 'favoritos', label: 'Favoritos' },
  { id: 'notificaciones', label: 'Notificaciones' },
  { id: 'admin', label: 'Acceso administrativo' },
])

export const navigationLabel = (item, session) => item.id === 'admin' && session?.authenticated === true &&
  session.user?.role === 'admin' ? 'Panel admin' : item.label
