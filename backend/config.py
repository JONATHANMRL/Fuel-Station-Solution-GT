"""Server-only configuration. Importing this module never connects to Oracle."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Mapping


class ConfigurationError(ValueError):
    pass


@dataclass(frozen=True)
class OracleSettings:
    enabled: bool = False
    host: str = ''
    port: int = 1521
    service_name: str = ''
    user: str = ''
    password: str = field(default='', repr=False)
    schema: str = ''
    pool_max: int = 4
    pool_wait_ms: int = 5000
    connect_timeout_s: int = 5
    call_timeout_ms: int = 5000
    cors_origins: tuple[str, ...] = ('http://localhost:5173', 'http://127.0.0.1:5173')

    def __post_init__(self) -> None:
        if not 1 <= self.port <= 65535:
            raise ConfigurationError('ORACLE_PORT debe estar entre 1 y 65535.')
        if not 1 <= self.pool_max <= 20:
            raise ConfigurationError('ORACLE_POOL_MAX debe estar entre 1 y 20.')
        if min(self.pool_wait_ms, self.connect_timeout_s, self.call_timeout_ms) <= 0:
            raise ConfigurationError('Los tiempos máximos de Oracle deben ser positivos.')
        if self.schema and not re.fullmatch(r'[A-Za-z][A-Za-z0-9_$#]{0,127}', self.schema):
            raise ConfigurationError('ORACLE_SCHEMA debe ser un identificador Oracle simple.')
        if '*' in self.cors_origins or any(
            not re.fullmatch(r'https?://[^/\s]+', origin) for origin in self.cors_origins
        ):
            raise ConfigurationError('CORS_ORIGINS debe contener orígenes HTTP(S) explícitos.')

    @property
    def ready(self) -> bool:
        return self.enabled and all((self.host, self.service_name, self.user, self.password))

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> OracleSettings:
        values = os.environ if env is None else env

        def integer(name: str, default: int) -> int:
            try:
                return int(values.get(name, str(default)))
            except ValueError:
                raise ConfigurationError(f'{name} debe ser un entero.') from None

        enabled = values.get('ORACLE_ENABLED', 'false').strip().lower()
        if enabled not in ('true', 'false'):
            raise ConfigurationError('ORACLE_ENABLED debe ser true o false.')
        origins = values.get('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
        return cls(
            enabled=enabled == 'true',
            host=values.get('ORACLE_HOST', '').strip(),
            port=integer('ORACLE_PORT', 1521),
            service_name=values.get('ORACLE_SERVICE_NAME', '').strip(),
            user=values.get('ORACLE_USER', '').strip(),
            password=values.get('ORACLE_PASSWORD', ''),
            schema=values.get('ORACLE_SCHEMA', '').strip().upper(),
            pool_max=integer('ORACLE_POOL_MAX', 4),
            pool_wait_ms=integer('ORACLE_POOL_WAIT_MS', 5000),
            connect_timeout_s=integer('ORACLE_CONNECT_TIMEOUT_S', 5),
            call_timeout_ms=integer('ORACLE_CALL_TIMEOUT_MS', 5000),
            cors_origins=tuple(origin.strip() for origin in origins.split(',') if origin.strip()),
        )
