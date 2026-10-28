"""Public, read-only price changes derived from PRECIO, not NOTIFICACION."""
import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import json
import os
import re

from fastapi import APIRouter, HTTPException, Query, Request, Response

from .config import ConfigurationError
from .operations_config import OperationsSettings
from .oracle_repository import OracleReadError
from .read_api import envelope
from .station_contract import InvalidSnapshot, _price, fuel_key, identifier


@dataclass(frozen=True)
class PublicAlertSettings:
    activated_at: datetime | None = None
    data_utc_offset: str = '-06:00'

    def __post_init__(self):
        OperationsSettings(data_utc_offset=self.data_utc_offset)
        if self.activated_at is not None and self.activated_at.tzinfo is None:
            raise ConfigurationError('PUBLIC_PRICE_ALERTS_ACTIVATED_AT debe incluir zona horaria.')

    @property
    def data_timezone(self):
        return OperationsSettings(data_utc_offset=self.data_utc_offset).timezone

    @classmethod
    def from_env(cls, env=None):
        values = os.environ if env is None else env
        value = values.get('PUBLIC_PRICE_ALERTS_ACTIVATED_AT', '').strip()
        try:
            activation = datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None
        except ValueError:
            raise ConfigurationError('PUBLIC_PRICE_ALERTS_ACTIVATED_AT debe ser una fecha ISO con zona, o vacío.') from None
        return cls(activation, values.get('ORACLE_DATA_UTC_OFFSET', '-06:00'))


def encode_cursor(date, price_id):
    payload = json.dumps({'v': 1, 'date': date.isoformat(timespec='microseconds'), 'id': price_id}, separators=(',', ':'))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')


def decode_cursor(value):
    if value is None:
        return None
    try:
        if not isinstance(value, str) or not 1 <= len(value) <= 256 or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
            raise ValueError()
        data = json.loads(base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True))
        if set(data) != {'v', 'date', 'id'} or data['v'] != 1 or not re.fullmatch(r'[1-9][0-9]{0,27}', data['id']):
            raise ValueError()
        date = datetime.fromisoformat(data['date'])
        if date.tzinfo is not None:
            raise ValueError()
        return date, data['id']
    except (ValueError, TypeError, KeyError, binascii.Error, OverflowError):
        raise ValueError('Cursor de avisos inválido.') from None


def build_alerts(rows, policy):
    """Only the bounded result page reaches Python; Oracle computes predecessors."""
    alerts, seen = [], set()
    for row in rows:
        price_id = identifier(row['ID_PRECIO'])
        if price_id in seen:
            raise InvalidSnapshot('Precio duplicado en avisos.')
        seen.add(price_id)
        previous, new = _price(row['PRECIO_ANTERIOR']), _price(row['PRECIO'])
        if previous is None or previous == new:
            continue
        if new is None:
            raise InvalidSnapshot('Precio nulo en avisos.')
        date = row['FECHA_REGISTRO']
        if not isinstance(date, datetime) or date.tzinfo is not None:
            raise InvalidSnapshot('PRECIO.FECHA_REGISTRO debe ser TIMESTAMP sin zona.')
        actual_date = date.replace(tzinfo=policy.data_timezone)
        difference = Decimal(str(new)) - Decimal(str(previous))
        context = ('unclassified' if policy.activated_at is None else
                   'after_activation' if actual_date >= policy.activated_at else 'before_activation')
        alerts.append({
            'id': f'public-price:{price_id}', 'priceId': price_id, 'source': 'oracle',
            'stationId': identifier(row['ID_GASOLINERA']), 'stationName': row['GASOLINERA'],
            'brand': row['MARCA'] or 'Independiente', 'fuel': fuel_key(row),
            'previousPrice': previous, 'newPrice': new, 'difference': float(difference),
            'type': 'up' if difference > 0 else 'down', 'createdAt': actual_date.isoformat(),
            'context': context,
        })
    return alerts


class OraclePublicPriceAlertRepository:
    def __init__(self, reader, settings, policy):
        # Same existing read-only pool/account. Never auth_service or operations pool.
        self.reader, self.settings, self.policy = reader, settings, policy
        self.prefix = f'"{settings.schema}".' if settings.schema else ''

    def list_alerts(self, limit, cursor=None):
        boundary = decode_cursor(cursor)
        clause = ''
        binds = {'page_size': limit + 1}
        if boundary:
            # Bind a string and convert explicitly: an inferred Oracle DATE bind
            # for Python datetime can lose the TIMESTAMP(6) fractional seconds.
            timestamp = '''TO_TIMESTAMP(:date_before, 'YYYY-MM-DD"T"HH24:MI:SS.FF6')'''
            clause = f'AND (H.FECHA_REGISTRO < {timestamp} OR (H.FECHA_REGISTRO = {timestamp} AND H.ID_PRECIO < :id_before))'
            binds.update(date_before=boundary[0].isoformat(timespec='microseconds'), id_before=int(boundary[1]))
        try:
            with self.reader._get_pool().acquire() as connection:
                connection.call_timeout = self.settings.call_timeout_ms
                with connection.cursor() as db:
                    db.execute('SET TRANSACTION READ ONLY')
                    # No date/page filter inside HISTORIAL: it would corrupt LAG.
                    # The view supplies public labels using grants already present.
                    db.execute(f'''WITH HISTORIAL AS (
                        SELECT ID_PRECIO, ID_GASOLINERA, ID_COMBUSTIBLE, PRECIO, FECHA_REGISTRO,
                            LAG(PRECIO) OVER (PARTITION BY ID_GASOLINERA, ID_COMBUSTIBLE
                                ORDER BY FECHA_REGISTRO, ID_PRECIO) PRECIO_ANTERIOR
                        FROM {self.prefix}PRECIO
                    ), ETIQUETAS AS (
                        SELECT DISTINCT ID_GASOLINERA, ID_COMBUSTIBLE, GASOLINERA, MARCA, COMBUSTIBLE
                        FROM {self.prefix}V_MAPA_GASOLINERA
                    ) SELECT H.ID_PRECIO, H.ID_GASOLINERA, H.ID_COMBUSTIBLE, H.PRECIO,
                        H.PRECIO_ANTERIOR, H.FECHA_REGISTRO, E.GASOLINERA, E.MARCA, E.COMBUSTIBLE
                    FROM HISTORIAL H JOIN ETIQUETAS E ON E.ID_GASOLINERA=H.ID_GASOLINERA
                        AND E.ID_COMBUSTIBLE=H.ID_COMBUSTIBLE
                    WHERE H.PRECIO_ANTERIOR IS NOT NULL AND H.PRECIO <> H.PRECIO_ANTERIOR {clause}
                    ORDER BY H.FECHA_REGISTRO DESC, H.ID_PRECIO DESC
                    FETCH FIRST :page_size ROWS ONLY''', binds)
                    names = [column[0] for column in db.description]
                    rows = [dict(zip(names, row)) for row in db.fetchall()]
            page = rows[:limit]
            alerts = build_alerts(page, self.policy)
            return {**envelope('alerts', alerts), 'limit': limit,
                    'nextCursor': encode_cursor(page[-1]['FECHA_REGISTRO'], identifier(page[-1]['ID_PRECIO']))
                    if len(rows) > limit and page else None,
                    'activatedAt': self.policy.activated_at.isoformat() if self.policy.activated_at else None}
        except OracleReadError:
            raise
        except (InvalidSnapshot, KeyError, TypeError, ValueError):
            raise OracleReadError('ORACLE_INVALID_DATA') from None
        except Exception:
            raise OracleReadError('ORACLE_UNAVAILABLE') from None


router = APIRouter(tags=['Avisos públicos de precios'])


@router.get('/public/price-alerts')
def public_price_alerts(request: Request, response: Response, limit: int = Query(25, ge=1, le=100),
                        cursor: str | None = Query(None, min_length=1, max_length=256)):
    response.headers['Cache-Control'] = 'no-store'
    try:
        decode_cursor(cursor)
    except ValueError:
        raise HTTPException(422, detail={'code': 'INVALID_CURSOR', 'message': 'Cursor de avisos inválido.'}) from None
    try:
        return request.app.state.public_alert_repository.list_alerts(limit, cursor)
    except OracleReadError as error:
        raise HTTPException(503, detail={'code': error.code, 'message': 'No fue posible consultar los avisos de Oracle.'},
                            headers={'Cache-Control': 'no-store'}) from None
