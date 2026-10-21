"""Oracle reading endpoints; legacy demo routes are not a fallback."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .oracle_repository import OracleReadError
from .station_contract import build_brands, build_prices


router = APIRouter(tags=['Consultas Oracle'])
Fuel = Literal['premium', 'regular', 'diesel']
Availability = Literal['DISPONIBLE', 'AGOTADO', 'NO_REGISTRADO']


class FuelPrices(BaseModel):
    premium: float | None
    regular: float | None
    diesel: float | None


class FuelAvailability(BaseModel):
    premium: Availability
    regular: Availability
    diesel: Availability


class Station(BaseModel):
    id: str
    name: str
    brand: str
    address: str
    municipality: str
    department: str
    zone: str
    lat: float | None
    lng: float | None
    locationStatus: Literal['pending']
    stationStatus: str
    status: Literal['active', 'inactive']
    updatedAt: None = None
    prices: FuelPrices
    availability: FuelAvailability
    source: Literal['oracle'] = 'oracle'
    isDemo: Literal[False] = False


class OracleResponse(BaseModel):
    source: Literal['oracle'] = 'oracle'
    count: int
    fetchedAt: datetime


class StationsResponse(OracleResponse):
    stations: list[Station]


class Brand(BaseModel):
    name: str
    count: int
    stations: int


class BrandsResponse(OracleResponse):
    brands: list[Brand]


class Price(BaseModel):
    stationId: str
    stationName: str
    brand: str
    municipality: str
    zone: str
    fuel: Fuel
    price: float
    availability: Availability
    available: bool
    updatedAt: None = None


class PricesResponse(OracleResponse):
    prices: list[Price]


def get_read_stations(request: Request) -> list[dict[str, Any]]:
    try:
        return request.app.state.station_repository.list_stations()
    except OracleReadError as error:
        raise HTTPException(status_code=503, detail={
            'code': error.code,
            'message': 'No fue posible consultar Oracle. Revisa el servicio y su configuración privada.',
        }) from None


def envelope(key: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {'source': 'oracle', 'count': len(rows),
            'fetchedAt': datetime.now(timezone.utc), key: rows}


@router.get('/stations', response_model=StationsResponse)
def get_stations(stations: list[dict[str, Any]] = Depends(get_read_stations)) -> dict[str, Any]:
    return envelope('stations', stations)


@router.get('/brands', response_model=BrandsResponse)
def get_brands(stations: list[dict[str, Any]] = Depends(get_read_stations)) -> dict[str, Any]:
    return envelope('brands', build_brands(stations))


@router.get('/prices', response_model=PricesResponse)
def get_prices(fuel: Fuel | None = None,
               stations: list[dict[str, Any]] = Depends(get_read_stations)) -> dict[str, Any]:
    return envelope('prices', build_prices(stations, fuel))
