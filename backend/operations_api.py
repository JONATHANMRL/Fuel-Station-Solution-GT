"""Additive phases 4/5 routes. Identity always comes from the existing session."""
import hashlib
import json
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, Query
from pydantic import BaseModel, ConfigDict, Field

from .auth_api import require_administrator
from .auth_core import AuthError
from .read_api import envelope

router = APIRouter(tags=['Precios, historial y avisos Oracle'])


class PriceChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    station_id: str = Field(pattern=r'^[1-9][0-9]{0,27}$')
    fuel: Literal['regular', 'premium', 'diesel']
    price: Decimal = Field(gt=0, le=Decimal('999999.99'), max_digits=8, decimal_places=2, allow_inf_nan=False)
    expected_price_id: str | None = Field(pattern=r'^[1-9][0-9]{0,27}$')
    request_id: UUID


def operations(request: Request, response: Response, profile=Depends(require_administrator)):
    response.headers['Cache-Control'] = 'no-store'
    return request.app.state.operations_service


def write_access(service=Depends(operations)):
    if not service.writes_available:
        raise AuthError(503, 'PRICE_WRITES_DISABLED', 'La escritura de precios no está habilitada de forma segura.')
    return service


def notification_access(service=Depends(operations)):
    if not service.notifications_available:
        raise AuthError(503, 'NOTIFICATIONS_DISABLED', 'Las notificaciones Oracle todavía no están habilitadas.')
    return service


class OperationsService:
    def __init__(self, repository, policy, ledger):
        self.repository, self.policy, self.ledger = repository, policy, ledger

    @property
    def writes_available(self):
        return self.policy.writes_enabled and self.repository.ready

    @property
    def notifications_available(self):
        return self.policy.notifications_enabled and self.repository.ready

    def update(self, body, actor):
        key = str(body.request_id)
        payload = [body.station_id, body.fuel, str(body.price.quantize(Decimal('0.01'))), body.expected_price_id]
        fingerprint = hashlib.sha256(json.dumps(payload).encode()).hexdigest()
        prior = self.ledger.claim(key, actor, fingerprint)
        if prior is not None:
            return {**prior, 'replayed': True}
        try:
            result = self.repository.update_price(body.station_id, body.fuel, body.price, body.expected_price_id)
        except AuthError as error:
            if error.code != 'COMMIT_UNCERTAIN':
                self.ledger.finish(key)
            raise
        # If the receipt write fails AFTER Oracle commit, pending stays pending.
        # Never report an ordinary rollback or automatically repeat the procedure.
        self.ledger.finish(key, result)
        return {**result, 'replayed': False}


@router.get('/admin/capabilities')
def capabilities(service=Depends(operations)):
    return {'priceWrites': service.writes_available, 'notifications': service.notifications_available,
            'history': service.repository.ready, 'historyAdministratorAvailable': False}


@router.get('/admin/prices')
def price_states(service=Depends(operations)):
    return envelope('prices', service.repository.states())


@router.post('/admin/prices')
def update_price(body: PriceChange, service=Depends(write_access), profile=Depends(require_administrator)):
    return service.update(body, profile['user']['id'])


@router.get('/admin/history')
def history(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            service=Depends(operations)):
    return {**envelope('history', service.repository.history(limit, offset)), 'limit': limit, 'offset': offset}


@router.get('/notifications')
def notifications(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
                  service=Depends(notification_access), profile=Depends(require_administrator)):
    return {**envelope('notifications', service.repository.notifications(profile['user']['id'], limit, offset)),
            'limit': limit, 'offset': offset, 'userId': profile['user']['id']}


@router.post('/notifications/{notification_id}/read', status_code=204)
def read_notification(notification_id: str, service=Depends(notification_access), profile=Depends(require_administrator)):
    if not notification_id.isascii() or not notification_id.isdecimal() or not 0 < len(notification_id) <= 28 or int(notification_id) <= 0:
        raise AuthError(422, 'INVALID_NOTIFICATION', 'Identificador de aviso inválido.')
    service.repository.mark_read(profile['user']['id'], notification_id)
    return Response(status_code=204, headers={'Cache-Control': 'no-store'})
