from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import OracleSettings
from .oracle_repository import OracleStationRepository
from .read_api import router as read_router

legacy_router = APIRouter(tags=['Demostración heredada — sin integración Oracle'])

# Only the pre-existing favorites/notifications/disabled admin routes use these
# legacy fixtures. Oracle GET /stations, /brands and /prices never read them.
stations: List[Dict[str, Any]] = [
    {
        'id': 'est-1',
        'name': 'Estación de Prueba Huehuetenango',
        'brand': 'Shell',
        'address': '5ta. Avenida 6-19, Zona 1',
        'zone': 'Zona 1',
        'municipality': 'Huehuetenango',
        'lat': 15.31487,
        'lng': -91.47527,
        'status': 'updated',
        'updatedAt': '2026-10-15T08:30:00-06:00',
        'prices': {'premium': 36.19, 'regular': 33.9, 'diesel': 30.55},
        'isDemo': True,
    },
    {
        'id': 'est-2',
        'name': 'Puma Centro',
        'brand': 'Puma',
        'address': '4ta. Calle 2-14, Colonia San Martín',
        'zone': 'San Martín',
        'municipality': 'Huehuetenango',
        'lat': 15.32034,
        'lng': -91.47098,
        'status': 'updated',
        'updatedAt': '2026-10-15T07:20:00-06:00',
        'prices': {'premium': 35.8, 'regular': 34.45, 'diesel': 31.2},
        'isDemo': True,
    },
    {
        'id': 'est-3',
        'name': 'Texaco del Norte',
        'brand': 'Texaco',
        'address': 'Carretera a Chiantla, km 6',
        'zone': 'Chiantla',
        'municipality': 'Huehuetenango',
        'lat': 15.33824,
        'lng': -91.46518,
        'status': 'warning',
        'updatedAt': '2026-10-14T12:50:00-06:00',
        'prices': {'premium': 36.7, 'regular': 35.2, 'diesel': 32.1},
        'isDemo': True,
    },
]

favorite_ids: set[str] = {'est-1', 'est-3'}
notifications: List[Dict[str, Any]] = [
    {
        'id': 'notif-1',
        'title': 'Gasolinera GT — Nuevo precio',
        'message': 'La Estación de Prueba Huehuetenango actualizó la gasolina regular de Q34.50 a Q33.90 por galón.',
        'fuel': 'regular',
        'type': 'down',
        'stationId': 'est-1',
        'createdAt': '2026-10-15T08:35:00-06:00',
    }
]


class FavoriteRequest(BaseModel):
    user_id: str = 'demo-user'
    station_id: str


class PriceUpdateRequest(BaseModel):
    station_id: str
    fuel: str
    price: float
    user: str = 'admin@gasolinagt.gt'


@legacy_router.get('/health', tags=['Estado del proceso'])
def health() -> Dict[str, Any]:
    return {
        'status': 'ok',
        'service': 'gasolina-gt',
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }


@legacy_router.get('/favorites')
def get_favorites() -> Dict[str, Any]:
    return {'favorites': [station for station in stations if station['id'] in favorite_ids]}


@legacy_router.post('/favorites')
def toggle_favorite(request: FavoriteRequest) -> Dict[str, Any]:
    if request.station_id not in {station['id'] for station in stations}:
        raise HTTPException(status_code=404, detail='Gasolinera no encontrada')
    if request.station_id in favorite_ids:
        favorite_ids.remove(request.station_id)
    else:
        favorite_ids.add(request.station_id)
    return {'favorites': sorted(favorite_ids)}


@legacy_router.get('/notifications')
def get_notifications() -> Dict[str, Any]:
    return {'notifications': notifications}


@legacy_router.post('/notifications/push/subscribe')
def subscribe_push(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'ok': True,
        'message': 'Suscripción de prueba registrada. En despliegue real se conectará con Web Push y VAPID.',
        'subscription': payload,
    }


def require_admin_access() -> None:
    # Keep administrative writes disabled until credentials, roles and sessions
    # are verified by this API. A client-supplied user name is not authorization.
    raise HTTPException(
        status_code=503,
        detail='Administración deshabilitada: autenticación de administradores pendiente de integración.',
    )


@legacy_router.post('/admin/prices', dependencies=[Depends(require_admin_access)])
def update_price(request: PriceUpdateRequest) -> Dict[str, Any]:
    if request.fuel not in {'premium', 'regular', 'diesel'}:
        raise HTTPException(status_code=400, detail='Combustible no válido')

    station = next((item for item in stations if item['id'] == request.station_id), None)
    if station is None:
        raise HTTPException(status_code=404, detail='Gasolinera no encontrada')

    previous_price = station['prices'][request.fuel]
    station['prices'][request.fuel] = round(float(request.price), 2)
    station['updatedAt'] = datetime.now().isoformat()
    station['status'] = 'updated' if request.price >= previous_price else 'warning'

    message = (
        f"La {station['name']} actualizó la gasolina {request.fuel} de Q{previous_price:.2f} a Q{request.price:.2f} por galón."
    )
    notifications.insert(0, {
        'id': f"notif-{len(notifications) + 1}",
        'title': 'Gasolina GT — Nuevo precio',
        'message': message,
        'fuel': request.fuel,
        'type': 'down' if request.price < previous_price else 'up',
        'stationId': request.station_id,
        'createdAt': datetime.now().isoformat(),
    })
    return {
        'ok': True,
        'station_id': request.station_id,
        'previous_price': previous_price,
        'new_price': round(float(request.price), 2),
        'message': message,
    }


def create_app(settings: OracleSettings | None = None, repository: Any = None) -> FastAPI:
    """Create the existing API, with an injectable read repository for offline tests."""
    resolved = settings if settings is not None else OracleSettings.from_env()
    reader = repository if repository is not None else OracleStationRepository(resolved)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        # Pool creation is lazy: /health and offline tests never contact Oracle.
        try:
            yield
        finally:
            application.state.station_repository.close()

    application = FastAPI(title='Gasolina GT API', version='0.2.0', lifespan=lifespan)
    application.state.station_repository = reader
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_credentials=True,
        allow_methods=['GET', 'POST'],
        allow_headers=['Content-Type', 'Authorization'],
    )
    application.include_router(read_router)
    application.include_router(legacy_router)
    return application


app = create_app()


if __name__ == '__main__':
    import uvicorn

    # Run from the repository root: python -m backend.main
    uvicorn.run('backend.main:app', host='127.0.0.1', port=8000)
