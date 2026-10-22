"""Separate Oracle account, bound SELECTs only; never uses GASOLINAGT_API."""
from .auth_core import User, unavailable
from .oracle_repository import OracleStationRepository
from .station_contract import identifier


class OracleUserRepository:
    def __init__(self, settings, read_user):
        self.reader = OracleStationRepository(settings)
        self.settings, self.read_user = settings, read_user

    def _find(self, where, value):
        if not self.settings.ready or self.settings.user.upper() in (self.read_user.upper(), 'GASOLINAGT_API', 'SYS', 'SYSTEM'):
            raise unavailable()
        prefix = f'"{self.settings.schema}".' if self.settings.schema else ''
        try:
            with self.reader._get_pool().acquire() as connection:
                connection.call_timeout = self.settings.call_timeout_ms
                with connection.cursor() as cursor:
                    cursor.execute('SET TRANSACTION READ ONLY')
                    cursor.execute('SELECT ID_USUARIO, CORREO, CLAVE_HASH, ESTADO FROM '
                                   f'{prefix}USUARIO WHERE {where}', {'value': value})
                    rows = cursor.fetchmany(2)
            if len(rows) > 1:
                raise unavailable()  # Do not pick an arbitrary case-insensitive email duplicate.
            return User(identifier(rows[0][0]), rows[0][1], rows[0][2], rows[0][3]) if rows else None
        except Exception:
            raise unavailable() from None

    def find_by_email(self, email):
        return self._find('LOWER(CORREO) = :value', email)

    def find_by_id(self, user_id):
        return self._find('ID_USUARIO = :value', user_id)

    def close(self):
        self.reader.close()
