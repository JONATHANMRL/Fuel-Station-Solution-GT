from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title='Gasolina GT API', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

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


@app.get('/health')
def health() -> Dict[str, Any]:
    return {
        'status': 'ok',
        'service': 'gasolina-gt',
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }


@app.get('/stations')
def get_stations() -> Dict[str, Any]:
    return {'stations': stations}


@app.get('/brands')
def get_brands() -> Dict[str, Any]:
    groups: Dict[str, int] = {}
    for station in stations:
        groups[station['brand']] = groups.get(station['brand'], 0) + 1
    return {
        'brands': [
            {'name': name, 'stations': count} for name, count in sorted(groups.items())
        ]
    }


@app.get('/favorites')
def get_favorites() -> Dict[str, Any]:
    return {'favorites': [station for station in stations if station['id'] in favorite_ids]}


@app.post('/favorites')
def toggle_favorite(request: FavoriteRequest) -> Dict[str, Any]:
    if request.station_id not in {station['id'] for station in stations}:
        raise HTTPException(status_code=404, detail='Gasolinera no encontrada')
    if request.station_id in favorite_ids:
        favorite_ids.remove(request.station_id)
    else:
        favorite_ids.add(request.station_id)
    return {'favorites': sorted(favorite_ids)}


@app.get('/notifications')
def get_notifications() -> Dict[str, Any]:
    return {'notifications': notifications}


@app.post('/notifications/push/subscribe')
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


@app.post('/admin/prices', dependencies=[Depends(require_admin_access)])
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


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('main:app', host='0.0.0.0', port=8000, reload=True)
