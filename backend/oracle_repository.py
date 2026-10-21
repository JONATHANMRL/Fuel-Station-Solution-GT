"""Read-only repository. No Oracle connection or import occurs at module import."""

from __future__ import annotations

from importlib import import_module
from threading import Lock
from typing import Any

from .config import OracleSettings
from .station_contract import InvalidSnapshot, OracleSnapshot, build_stations


class OracleReadError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)  # Never include DSN, credentials or driver exception text.


class OracleStationRepository:
    def __init__(self, settings: OracleSettings):
        self.settings = settings
        self._pool: Any = None
        self._lock = Lock()

    def _get_pool(self) -> Any:
        if not self.settings.ready:
            raise OracleReadError('ORACLE_NOT_CONFIGURED')
        with self._lock:
            if self._pool is None:
                try:
                    driver = import_module('oracledb')
                except ImportError:
                    raise OracleReadError('ORACLE_DRIVER_UNAVAILABLE') from None
                try:
                    self._pool = driver.create_pool(
                        user=self.settings.user, password=self.settings.password,
                        host=self.settings.host, port=self.settings.port,
                        service_name=self.settings.service_name,
                        min=0, max=self.settings.pool_max, increment=1,
                        getmode=driver.POOL_GETMODE_TIMEDWAIT,
                        wait_timeout=self.settings.pool_wait_ms,
                        tcp_connect_timeout=self.settings.connect_timeout_s,
                        retry_count=0, ping_interval=60,
                    )
                except Exception:
                    raise OracleReadError('ORACLE_UNAVAILABLE') from None
            return self._pool

    def list_stations(self) -> list[dict[str, Any]]:
        pool = self._get_pool()
        prefix = f'"{self.settings.schema}".' if self.settings.schema else ''

        def read(cursor: Any, columns: str, view: str) -> list[dict[str, Any]]:
            # Only validated schema + constant column/view names are interpolated.
            cursor.execute(f'SELECT {columns} FROM {prefix}{view} ORDER BY ID_GASOLINERA')
            names = [description[0] for description in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]

        try:
            with pool.acquire() as connection:
                connection.call_timeout = self.settings.call_timeout_ms
                with connection.cursor() as cursor:
                    # All three views belong to one consistent, read-only snapshot.
                    cursor.execute('SET TRANSACTION READ ONLY')
                    locations = read(cursor, 'ID_GASOLINERA, GASOLINERA, DIRECCION, MUNICIPIO, '
                                     'DEPARTAMENTO, LATITUD, LONGITUD, ESTADO',
                                     'V_GASOLINERA_UBICACION')
                    map_rows = read(cursor, 'ID_GASOLINERA, MARCA, ID_COMBUSTIBLE, COMBUSTIBLE, '
                                    'PRECIO_ACTUAL, DISPONIBILIDAD', 'V_MAPA_GASOLINERA')
                    price_rows = read(cursor, 'ID_GASOLINERA, ID_COMBUSTIBLE, COMBUSTIBLE, '
                                      'PRECIO_ACTUAL, DISPONIBILIDAD', 'V_PRECIO_ACTUAL')
            return build_stations(OracleSnapshot(locations, map_rows, price_rows))
        except (InvalidSnapshot, KeyError, TypeError, ValueError):
            raise OracleReadError('ORACLE_INVALID_DATA') from None
        except OracleReadError:
            raise
        except Exception:
            raise OracleReadError('ORACLE_UNAVAILABLE') from None

    def close(self) -> None:
        with self._lock:
            if self._pool is not None:
                self._pool.close()
                self._pool = None
