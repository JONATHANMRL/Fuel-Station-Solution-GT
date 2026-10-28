"""Private feature switches and a third Oracle account; no network on import."""
import os
from dataclasses import dataclass, replace
from datetime import timedelta, timezone
import re

from .config import ConfigurationError


@dataclass(frozen=True)
class OperationsSettings:
    writes_enabled: bool = False
    notifications_enabled: bool = False
    data_utc_offset: str = '-06:00'

    def __post_init__(self):
        if not re.fullmatch(r'[+-](?:0\d|1[0-3]):[0-5]\d', self.data_utc_offset):
            raise ConfigurationError('ORACLE_DATA_UTC_OFFSET debe tener formato ±HH:MM (hasta 13:59).')

    @property
    def timezone(self):
        hours, minutes = map(int, self.data_utc_offset[1:].split(':'))
        return timezone(timedelta(minutes=(hours * 60 + minutes) * (-1 if self.data_utc_offset[0] == '-' else 1)))

    @classmethod
    def from_env(cls, env=None):
        values = os.environ if env is None else env
        def flag(name):
            value = values.get(name, 'false').strip().lower()
            if value not in ('true', 'false'):
                raise ConfigurationError(f'{name} debe ser true o false.')
            return value == 'true'
        return cls(flag('PRICE_WRITES_ENABLED'), flag('ORACLE_NOTIFICATIONS_ENABLED'),
                   values.get('ORACLE_DATA_UTC_OFFSET', '-06:00'))


def writer_credentials(reader, auth_user, env=None):
    values = os.environ if env is None else env
    settings = replace(reader, user=values.get('OPERATIONS_ORACLE_USER', '').strip(),
                       password=values.get('OPERATIONS_ORACLE_PASSWORD', ''))
    forbidden = {reader.user.upper(), auth_user.upper(), 'GASOLINAGT_API', 'GASOLINAGT_ADMIN', 'SYS', 'SYSTEM',
                 reader.schema.upper()}
    if settings.user and settings.user.upper() in forbidden:
        raise ConfigurationError('OPERATIONS_ORACLE_USER debe ser una cuenta técnica separada del lector, autenticación y propietario.')
    return settings
