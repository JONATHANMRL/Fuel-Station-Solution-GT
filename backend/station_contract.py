"""Pure Oracle-to-React adapter; no framework, driver, SQL file or local catalogue."""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any


FUEL_KEYS = ('premium', 'regular', 'diesel')
FUEL_IDS = {'1': ('regular', 'regular'), '2': ('premium', 'superior'), '3': ('diesel', 'diesel')}


class InvalidSnapshot(ValueError):
    """The view rows cannot safely be represented by the agreed contract."""


@dataclass(frozen=True)
class OracleSnapshot:
    locations: list[dict[str, Any]]
    map_rows: list[dict[str, Any]]
    price_rows: list[dict[str, Any]]


def identifier(value: Any) -> str:
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number <= 0 or number != number.to_integral_value():
            raise InvalidSnapshot('Identificador inválido.')
        return str(int(number))
    except (InvalidOperation, ValueError, TypeError):
        raise InvalidSnapshot('Identificador inválido.') from None


def fuel_key(row: dict[str, Any]) -> str:
    definition = FUEL_IDS.get(identifier(row['ID_COMBUSTIBLE']))
    name = ''.join(c for c in unicodedata.normalize('NFKD', str(row['COMBUSTIBLE']))
                   if not unicodedata.combining(c)).strip().lower()
    if definition is None or name != definition[1]:
        raise InvalidSnapshot('Identificador y nombre de combustible incompatibles.')
    return definition[0]


def _price(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = Decimal(str(value))
        if not number.is_finite() or not Decimal('0') < number <= Decimal('999999.99'):
            raise InvalidSnapshot('Precio inválido.')
        if number != number.quantize(Decimal('0.01')):
            raise InvalidSnapshot('El precio debe tener como máximo dos decimales.')
        return float(number)
    except (InvalidOperation, ValueError, TypeError):
        raise InvalidSnapshot('Precio inválido.') from None


def _coordinate(value: Any, limit: int) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) and abs(number) <= limit else None
    except (TypeError, ValueError, OverflowError):
        return None


def build_stations(snapshot: OracleSnapshot) -> list[dict[str, Any]]:
    stations: dict[str, dict[str, Any]] = {}
    for row in snapshot.locations:
        station_id = identifier(row['ID_GASOLINERA'])
        if station_id in stations:
            raise InvalidSnapshot('Ubicación duplicada.')
        lat, lng = _coordinate(row['LATITUD'], 90), _coordinate(row['LONGITUD'], 180)
        address = row['DIRECCION'] or ''
        zone = re.search(r'\bzona\s+(\d+)\b', address, re.IGNORECASE)
        stations[station_id] = {
            'id': station_id, 'name': row['GASOLINERA'], 'brand': 'Independiente',
            'address': address, 'municipality': row['MUNICIPIO'],
            'department': row['DEPARTAMENTO'],
            'zone': f'Zona {int(zone.group(1))}' if zone else 'Por verificar',
            'lat': lat if lng is not None else None,
            'lng': lng if lat is not None else None,
            # Valid ranges do not prove a physical location has been corroborated.
            'locationStatus': 'pending', 'source': 'oracle', 'isDemo': False,
            'stationStatus': row['ESTADO'],
            'status': 'active' if row['ESTADO'] == 'ACTIVA' else 'inactive',
            # The views do not expose the timestamp of the latest price.
            'updatedAt': None,
            'prices': {fuel: None for fuel in FUEL_KEYS},
            'availability': {fuel: 'NO_REGISTRADO' for fuel in FUEL_KEYS},
        }

    map_pairs: dict[tuple[str, str], tuple[float | None, str]] = {}
    brands: dict[str, str] = {}
    for row in snapshot.map_rows:
        station_id = identifier(row['ID_GASOLINERA'])
        if station_id not in stations:
            raise InvalidSnapshot('Estación sin ubicación en la vista.')
        brand = row['MARCA'] or 'Independiente'
        if station_id in brands and brands[station_id] != brand:
            raise InvalidSnapshot('Marca inconsistente.')
        brands[station_id] = brand
        stations[station_id]['brand'] = brand
        if row['ID_COMBUSTIBLE'] is None:
            continue  # LEFT JOIN: keep stations that have no price yet.
        pair = (station_id, fuel_key(row))
        if pair in map_pairs:
            raise InvalidSnapshot('Combustible duplicado en la vista del mapa.')
        map_pairs[pair] = (_price(row['PRECIO_ACTUAL']), row['DISPONIBILIDAD'])

    seen: set[tuple[str, str]] = set()
    for row in snapshot.price_rows:
        station_id, fuel = identifier(row['ID_GASOLINERA']), fuel_key(row)
        pair = (station_id, fuel)
        value, availability = _price(row['PRECIO_ACTUAL']), row['DISPONIBILIDAD']
        if station_id not in stations or pair in seen:
            raise InvalidSnapshot('Precio duplicado o sin estación.')
        if availability not in ('DISPONIBLE', 'AGOTADO'):
            raise InvalidSnapshot('Disponibilidad desconocida.')
        if map_pairs.get(pair) != (value, availability):
            raise InvalidSnapshot('Las vistas de mapa y precios no coinciden.')
        seen.add(pair)
        # Preserve the stored price even when exhausted; expose availability separately.
        stations[station_id]['prices'][fuel] = value
        stations[station_id]['availability'][fuel] = availability
    if set(map_pairs) != seen or set(brands) != set(stations):
        raise InvalidSnapshot('Las vistas no cubren las mismas estaciones y precios.')
    return sorted(stations.values(), key=lambda station: int(station['id']))


def build_brands(stations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for station in stations:
        counts[station['brand']] = counts.get(station['brand'], 0) + 1
    # "stations" preserves the count field exposed by the previous API.
    return [{'name': name, 'count': count, 'stations': count}
            for name, count in sorted(counts.items())]


def build_prices(stations: list[dict[str, Any]], fuel: str | None = None) -> list[dict[str, Any]]:
    if fuel is not None and fuel not in FUEL_KEYS:
        raise ValueError('Combustible inválido.')
    return [
        {
            'stationId': station['id'], 'stationName': station['name'],
            'brand': station['brand'], 'municipality': station['municipality'],
            'zone': station['zone'], 'fuel': key, 'price': station['prices'][key],
            'availability': station['availability'][key],
            'available': station['stationStatus'] == 'ACTIVA'
                         and station['availability'][key] == 'DISPONIBLE',
            'updatedAt': None,
        }
        for station in stations for key in FUEL_KEYS
        if (fuel is None or key == fuel) and station['prices'][key] is not None
    ]
