"""Existing schema only. Writes call REGISTRAR_PRECIO; no INSERT/UPDATE of PRECIO."""
from decimal import Decimal

from .auth_core import AuthError
from .oracle_repository import OracleStationRepository
from .station_contract import fuel_key, identifier

FUEL_IDS = {'regular': 1, 'premium': 2, 'diesel': 3}


class OperationsError(AuthError):
    pass


def unavailable():
    return OperationsError(503, 'OPERATIONS_UNAVAILABLE', 'No fue posible completar la operación Oracle. Revisa la configuración privada.')


class OracleOperationsRepository:
    def __init__(self, settings, policy):
        self.settings, self.policy = settings, policy
        self.reader = OracleStationRepository(settings)
        self.prefix = f'"{settings.schema}".' if settings.schema else ''

    @property
    def ready(self):
        return self.settings.ready

    def close(self):
        self.reader.close()

    def _date(self, value):
        return value.replace(tzinfo=self.policy.timezone).isoformat() if value.tzinfo is None else value.isoformat()

    def _history(self, cursor, limit, offset):
        # LAG is computed BEFORE pagination, ordered exactly like V_PRECIO_ACTUAL.
        cursor.execute(f'''SELECT P.ID_PRECIO, P.ID_GASOLINERA, G.NOMBRE,
            P.ID_COMBUSTIBLE, C.NOMBRE, P.ANTERIOR, P.PRECIO, P.FECHA_REGISTRO FROM (
              SELECT P.*, LAG(PRECIO) OVER (PARTITION BY ID_GASOLINERA, ID_COMBUSTIBLE
                ORDER BY FECHA_REGISTRO, ID_PRECIO) ANTERIOR FROM {self.prefix}PRECIO P
            ) P JOIN {self.prefix}GASOLINERA G ON G.ID_GASOLINERA=P.ID_GASOLINERA
            JOIN {self.prefix}COMBUSTIBLE C ON C.ID_COMBUSTIBLE=P.ID_COMBUSTIBLE
            ORDER BY P.FECHA_REGISTRO DESC, P.ID_PRECIO DESC
            OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY''', {'offset': offset, 'limit': limit})
        return [{'id': identifier(r[0]), 'stationId': identifier(r[1]), 'stationName': r[2],
                 'fuel': fuel_key({'ID_COMBUSTIBLE': r[3], 'COMBUSTIBLE': r[4]}),
                 'previousPrice': float(r[5]) if r[5] is not None else None, 'newPrice': float(r[6]),
                 'updatedAt': self._date(r[7]), 'administrator': None, 'source': 'oracle'} for r in cursor.fetchall()]

    def history(self, limit, offset):
        return self._read(lambda cursor: self._history(cursor, limit, offset))

    def _states(self, cursor):
        cursor.execute(f'''SELECT GC.ID_GASOLINERA, GC.ID_COMBUSTIBLE, C.NOMBRE,
            G.ESTADO, GC.ESTADO, C.ESTADO, P.ID_PRECIO, P.PRECIO FROM {self.prefix}GASOLINERA_COMBUSTIBLE GC
            JOIN {self.prefix}GASOLINERA G ON G.ID_GASOLINERA=GC.ID_GASOLINERA
            JOIN {self.prefix}COMBUSTIBLE C ON C.ID_COMBUSTIBLE=GC.ID_COMBUSTIBLE
            OUTER APPLY (SELECT ID_PRECIO, PRECIO FROM {self.prefix}PRECIO P
                WHERE P.ID_GASOLINERA=GC.ID_GASOLINERA AND P.ID_COMBUSTIBLE=GC.ID_COMBUSTIBLE
                ORDER BY FECHA_REGISTRO DESC, ID_PRECIO DESC FETCH FIRST 1 ROW ONLY) P
            ORDER BY GC.ID_GASOLINERA, GC.ID_COMBUSTIBLE''')
        return [{'stationId': identifier(r[0]), 'fuel': fuel_key({'ID_COMBUSTIBLE': r[1], 'COMBUSTIBLE': r[2]}),
                 'available': r[3] == 'ACTIVA' and r[4] == 'DISPONIBLE' and r[5] == 'ACTIVO',
                 'priceId': identifier(r[6]) if r[6] is not None else None,
                 'price': float(r[7]) if r[7] is not None else None} for r in cursor.fetchall()]

    def states(self):
        return self._read(self._states)

    def _read(self, operation):
        try:
            with self.reader._get_pool().acquire() as connection:
                connection.call_timeout = self.settings.call_timeout_ms
                with connection.cursor() as cursor:
                    cursor.execute('SET TRANSACTION READ ONLY')
                    return operation(cursor)
        except Exception:
            raise unavailable() from None

    def update_price(self, station_id, fuel, price, expected_id):
        commit_started = False
        try:
            with self.reader._get_pool().acquire() as connection:
                connection.call_timeout = self.settings.call_timeout_ms
                connection.autocommit = False
                try:
                    with connection.cursor() as cursor:
                        # A separate pool: do not change the existing read/auth session timezone.
                        cursor.execute(f"ALTER SESSION SET TIME_ZONE = '{self.policy.data_utc_offset}'")
                        cursor.execute(f'''SELECT GC.ESTADO, G.ESTADO, C.ESTADO, C.NOMBRE
                            FROM {self.prefix}GASOLINERA_COMBUSTIBLE GC
                            JOIN {self.prefix}GASOLINERA G ON G.ID_GASOLINERA=GC.ID_GASOLINERA
                            JOIN {self.prefix}COMBUSTIBLE C ON C.ID_COMBUSTIBLE=GC.ID_COMBUSTIBLE
                            WHERE GC.ID_GASOLINERA=:station AND GC.ID_COMBUSTIBLE=:fuel
                            FOR UPDATE OF GC.ESTADO WAIT 5''', {'station': int(station_id), 'fuel': FUEL_IDS[fuel]})
                        state = cursor.fetchone()
                        if not state or tuple(state[:3]) != ('DISPONIBLE', 'ACTIVA', 'ACTIVO'):
                            raise OperationsError(409, 'FUEL_UNAVAILABLE', 'Estación o combustible no disponible.')
                        fuel_key({'ID_COMBUSTIBLE': FUEL_IDS[fuel], 'COMBUSTIBLE': state[3]})
                        def current():
                            cursor.execute(f'''SELECT ID_PRECIO, PRECIO, FECHA_REGISTRO FROM {self.prefix}PRECIO
                                WHERE ID_GASOLINERA=:station AND ID_COMBUSTIBLE=:fuel
                                ORDER BY FECHA_REGISTRO DESC, ID_PRECIO DESC FETCH FIRST 1 ROW ONLY''',
                                           {'station': int(station_id), 'fuel': FUEL_IDS[fuel]})
                            return cursor.fetchone()
                        previous = current()
                        actual_id = identifier(previous[0]) if previous else None
                        if actual_id != expected_id:
                            raise OperationsError(409, 'PRICE_CONFLICT', 'El precio cambió en otro cliente. Actualiza antes de guardar.')
                        if previous and Decimal(str(previous[1])) == price:
                            raise OperationsError(409, 'PRICE_UNCHANGED', 'El precio nuevo es igual al vigente.')
                        cursor.callproc(f'{self.prefix}REGISTRAR_PRECIO', [int(station_id), FUEL_IDS[fuel], price])
                        saved = current()
                        if not saved or identifier(saved[0]) == actual_id or Decimal(str(saved[1])) != price:
                            raise unavailable()
                        result = {'source': 'oracle', 'priceId': identifier(saved[0]), 'stationId': station_id,
                                  'fuel': fuel, 'previousPrice': float(previous[1]) if previous else None,
                                  'newPrice': float(price), 'updatedAt': self._date(saved[2])}
                    commit_started = True
                    connection.commit()  # Price + procedure-generated notifications are one transaction.
                    return result
                except Exception:
                    try:
                        connection.rollback()
                    except Exception:
                        pass
                    raise
        except Exception as error:
            if commit_started:
                raise OperationsError(503, 'COMMIT_UNCERTAIN',
                                      'No se pudo confirmar el guardado. Consulta el historial; no reenvíes el cambio.') from None
            if isinstance(error, OperationsError):
                raise
            raise unavailable() from None

    def notifications(self, user_id, limit, offset):
        def query(cursor):
            cursor.execute(f'''SELECT N.ID_NOTIFICACION, P.ID_GASOLINERA, G.NOMBRE, P.ID_COMBUSTIBLE,
                C.NOMBRE, N.MENSAJE, N.PRECIO_ANTERIOR, P.PRECIO, N.ESTADO, N.FECHA_NOTIFICACION
                FROM {self.prefix}NOTIFICACION N JOIN {self.prefix}PRECIO P ON P.ID_PRECIO=N.ID_PRECIO
                JOIN {self.prefix}GASOLINERA G ON G.ID_GASOLINERA=P.ID_GASOLINERA
                JOIN {self.prefix}COMBUSTIBLE C ON C.ID_COMBUSTIBLE=P.ID_COMBUSTIBLE
                WHERE N.ID_USUARIO=:user_id AND N.ESTADO <> 'DESCARTADA'
                ORDER BY N.FECHA_NOTIFICACION DESC, N.ID_NOTIFICACION DESC
                OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY''',
                           {'user_id': int(user_id), 'offset': offset, 'limit': limit})
            return [{'id': identifier(r[0]), 'stationId': identifier(r[1]), 'title': f'{r[2]} — {r[4]}',
                     'fuel': fuel_key({'ID_COMBUSTIBLE': r[3], 'COMBUSTIBLE': r[4]}), 'message': r[5],
                     'previousPrice': float(r[6]) if r[6] is not None else None, 'newPrice': float(r[7]),
                     'read': r[8] == 'LEIDA', 'type': 'new' if r[6] is None else 'down' if r[7] < r[6] else 'up',
                     'createdAt': self._date(r[9]), 'source': 'oracle'} for r in cursor.fetchall()]
        return self._read(query)

    def mark_read(self, user_id, notification_id):
        try:
            with self.reader._get_pool().acquire() as connection:
                connection.call_timeout = self.settings.call_timeout_ms
                connection.autocommit = False
                try:
                    with connection.cursor() as cursor:
                        cursor.execute(f"UPDATE {self.prefix}NOTIFICACION SET ESTADO='LEIDA' "
                                       "WHERE ID_NOTIFICACION=:id AND ID_USUARIO=:user_id AND ESTADO IN ('PENDIENTE','LEIDA')",
                                       {'id': int(notification_id), 'user_id': int(user_id)})
                        if cursor.rowcount != 1:
                            raise OperationsError(404, 'NOTIFICATION_NOT_FOUND', 'Aviso no encontrado para esta cuenta.')
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
        except OperationsError:
            raise
        except Exception:
            raise unavailable() from None
