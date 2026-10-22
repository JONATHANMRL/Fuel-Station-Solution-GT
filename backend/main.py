from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import datetime, timezone
import os
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import ConfigurationError, OracleSettings
from .oracle_repository import OracleStationRepository
from .read_api import router as read_router
from .auth_api import router as auth_router, require_administrator, auth_error_handler
from .auth_config import AuthSettings
from .auth_core import AuthError, AuthService
from .auth_repository import OracleUserRepository

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


@legacy_router.post('/admin/prices', dependencies=[Depends(require_administrator)])
def update_price(request: PriceUpdateRequest) -> Dict[str, Any]:
    # Even an authenticated administrator cannot write prices in phase 3.
    raise HTTPException(status_code=503, detail={'code': 'PRICE_WRITES_DISABLED',
                                               'message': 'La actualización de precios todavía no está habilitada.'})


def create_app(settings: OracleSettings | None = None, repository: Any = None,
               auth_settings: AuthSettings | None = None, auth_service: Any = None) -> FastAPI:
    """Create the existing API, with an injectable read repository for offline tests."""
    resolved = settings if settings is not None else OracleSettings.from_env()
    reader = repository if repository is not None else OracleStationRepository(resolved)
    policy = auth_settings if auth_settings is not None else AuthSettings.from_env(resolved.cors_origins)
    if policy.enabled and not set(policy.allowed_origins).issubset(resolved.cors_origins):
        raise ConfigurationError('AUTH_ALLOWED_ORIGINS debe ser un subconjunto de CORS_ORIGINS.')
    user_reader = None
    if auth_service is None:
        credentials = replace(resolved, user=os.environ.get('AUTH_ORACLE_USER', ''),
                              password=os.environ.get('AUTH_ORACLE_PASSWORD', ''))
        user_reader = OracleUserRepository(credentials, resolved.user)
        auth_service = AuthService(policy, user_reader)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        # Pool creation is lazy: /health and offline tests never contact Oracle.
        try:
            yield
        finally:
            application.state.station_repository.close()
            if user_reader is not None:
                user_reader.close()

    application = FastAPI(title='Gasolina GT API', version='0.2.0', lifespan=lifespan)
    application.state.station_repository = reader
    application.state.auth_service = auth_service
    application.add_exception_handler(AuthError, auth_error_handler)

    @application.exception_handler(RequestValidationError)
    async def sanitized_validation(request, error):
        if request.url.path.startswith('/auth/'):
            # Never echo a submitted password through FastAPI validation details.
            return JSONResponse(status_code=422, content={'detail': {'code': 'INVALID_LOGIN_INPUT',
                                'message': 'Revisa los campos de acceso.'}}, headers={'Cache-Control': 'no-store'})
        from fastapi.exception_handlers import request_validation_exception_handler
        return await request_validation_exception_handler(request, error)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_credentials=True,
        allow_methods=['GET', 'POST'],
        allow_headers=['Content-Type', 'Authorization', 'X-Admin-Request'],
    )
    application.include_router(read_router)
    application.include_router(auth_router)
    application.include_router(legacy_router)
    return application


app = create_app()


if __name__ == '__main__':
    import uvicorn

    # Run from the repository root: python -m backend.main
    uvicorn.run('backend.main:app', host='127.0.0.1', port=8000)
