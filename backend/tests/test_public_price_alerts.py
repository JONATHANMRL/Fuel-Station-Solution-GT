"""Offline tests: execute the production analytic SELECT in SQLite's window engine.

FETCH FIRST is translated to LIMIT and TO_TIMESTAMP is emulated; grants/driver stay mocked.
This verifies SQL behavior, not Oracle compatibility or a real connection.
"""
from datetime import datetime, timezone
import sqlite3
import unittest
from unittest.mock import Mock

from fastapi.testclient import TestClient

from backend.auth_config import AuthSettings
from backend.auth_core import AuthError
from backend.config import ConfigurationError, OracleSettings
from backend.main import create_app
from backend.oracle_repository import OracleReadError
from backend.public_price_alerts import (OraclePublicPriceAlertRepository, PublicAlertSettings,
                                        decode_cursor, encode_cursor)


class ReadCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, binds=None):
        self.connection.statements.append((sql, binds))
        if sql == 'SET TRANSACTION READ ONLY':
            return
        if not sql.lstrip().startswith('WITH HISTORIAL AS'):
            raise AssertionError('Only the read-only analytic query is allowed')
        sql = sql.replace('FETCH FIRST :page_size ROWS ONLY', 'LIMIT :page_size')
        binds = {key: value.isoformat(' ', timespec='microseconds') if isinstance(value, datetime) else value
                 for key, value in binds.items()}
        self.cursor = self.connection.engine.execute(sql, binds)
        self.description = self.cursor.description

    def fetchall(self):
        names = [column[0] for column in self.description]
        index = names.index('FECHA_REGISTRO')
        result = []
        for row in self.cursor.fetchall():
            row = list(row)
            row[index] = datetime.fromisoformat(row[index])
            result.append(tuple(row))
        return result


class ReadConnection:
    def __init__(self, engine):
        self.engine, self.statements = engine, []
        self.commit = Mock(side_effect=AssertionError('No commits in public reads'))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def cursor(self):
        return ReadCursor(self)


class PublicAlertTests(unittest.TestCase):
    def setUp(self):
        self.engine = sqlite3.connect(':memory:', check_same_thread=False)
        self.engine.create_function('TO_TIMESTAMP', 2, lambda value, mask: datetime.fromisoformat(value).isoformat(' ', timespec='microseconds'))
        self.addCleanup(self.engine.close)
        self.engine.execute('CREATE TABLE PRECIO (ID_PRECIO INTEGER PRIMARY KEY, ID_GASOLINERA INTEGER, '
                            'ID_COMBUSTIBLE INTEGER, PRECIO NUMERIC, FECHA_REGISTRO TEXT)')
        self.engine.execute('CREATE TABLE V_MAPA_GASOLINERA (ID_GASOLINERA INTEGER, ID_COMBUSTIBLE INTEGER, '
                            'GASOLINERA TEXT, MARCA TEXT, COMBUSTIBLE TEXT)')
        self.engine.executemany('INSERT INTO V_MAPA_GASOLINERA VALUES (?,?,?,?,?)',
                               [(1, 1, 'Station A', 'Shell', 'Regular'), (1, 2, 'Station A', 'Shell', 'Superior'),
                                (2, 1, 'Station B', 'Puma', 'Regular')])
        self.date = datetime(2026, 10, 27, 12)
        for price_id, station, fuel, price in [(1, 1, 1, 30), (2, 2, 1, 100), (3, 1, 2, 40),
                                               (4, 1, 1, 31), (5, 2, 1, 99), (6, 1, 2, 40),
                                               (7, 1, 1, 30), (8, 1, 2, 41)]:
            self.insert(price_id, station, fuel, price)
        self.connection = ReadConnection(self.engine)
        self.reader = Mock()
        self.reader._get_pool.return_value.acquire.return_value = self.connection
        self.settings = OracleSettings(user='GASOLINAGT_API', cors_origins=('https://frontend.test.invalid',))
        self.policy = PublicAlertSettings()
        self.repo = OraclePublicPriceAlertRepository(self.reader, self.settings, self.policy)

    def insert(self, price_id, station, fuel, price, date=None):
        self.engine.execute('INSERT INTO PRECIO VALUES (?,?,?,?,?)',
                            (price_id, station, fuel, price, (date or self.date).isoformat(' ', timespec='microseconds')))

    def test_up_down_same_and_first_price_correctly_partitioned(self):
        result = self.repo.list_alerts(25)
        rows = result['alerts']
        self.assertEqual([row['priceId'] for row in rows], ['8', '7', '5', '4'])
        self.assertEqual([row['type'] for row in rows], ['up', 'down', 'down', 'up'])
        self.assertEqual([row['difference'] for row in rows], [1, -1, -1, 1])
        self.assertEqual([(r['stationId'], r['fuel'], r['previousPrice']) for r in rows],
                         [('1', 'premium', 40), ('1', 'regular', 31), ('2', 'regular', 100), ('1', 'regular', 30)])
        self.assertTrue(all(r['id'] == 'public-price:' + r['priceId'] for r in rows))
        self.assertEqual(len({r['id'] for r in rows}), len(rows))
        self.assertIsNone(result['nextCursor'])

    def test_keyset_pages_with_new_insert_have_no_duplicates_or_shifted_predecessors(self):
        first = self.repo.list_alerts(2)
        self.insert(9, 1, 1, 29.50)
        second = self.repo.list_alerts(2, first['nextCursor'])
        self.assertEqual([row['priceId'] for row in first['alerts']], ['8', '7'])
        self.assertEqual([row['priceId'] for row in second['alerts']], ['5', '4'])
        self.assertEqual(second['alerts'][-1]['previousPrice'], 30)
        self.assertIsNone(second['nextCursor'])
        self.assertEqual(self.repo.list_alerts(1)['alerts'][0]['priceId'], '9')

    def test_date_order_and_microseconds_precede_id_tiebreaker(self):
        self.insert(9, 1, 1, 29, self.date.replace(microsecond=999))
        self.insert(10, 1, 1, 28, self.date.replace(microsecond=1))
        result = self.repo.list_alerts(1)
        self.assertEqual(result['alerts'][0]['priceId'], '9')
        self.assertEqual(result['alerts'][0]['previousPrice'], 28)
        self.assertEqual(decode_cursor(result['nextCursor'])[0].microsecond, 999)
        second = self.repo.list_alerts(1, result['nextCursor'])
        self.assertEqual(second['alerts'][0]['priceId'], '10')

    def test_activation_is_explicit_not_invented_or_a_demo_provenance_claim(self):
        self.assertIsNone(self.repo.list_alerts(25)['activatedAt'])
        self.assertEqual({r['context'] for r in self.repo.list_alerts(25)['alerts']}, {'unclassified'})
        policy = PublicAlertSettings(datetime(2026, 10, 27, 18, 0, 0, 1, tzinfo=timezone.utc))
        repo = OraclePublicPriceAlertRepository(self.reader, self.settings, policy)
        self.insert(9, 1, 1, 29, self.date.replace(microsecond=2))
        rows = repo.list_alerts(25)['alerts']
        self.assertEqual(rows[0]['context'], 'after_activation')
        self.assertEqual(rows[1]['context'], 'before_activation')
        for value in ['yesterday', '2026-10-27T12:00:00']:
            with self.assertRaises(ConfigurationError):
                PublicAlertSettings.from_env({'PUBLIC_PRICE_ALERTS_ACTIVATED_AT': value})

    def test_read_pool_only_bounded_query_and_bound_cursor(self):
        cursor = encode_cursor(self.date, '8')
        self.repo.list_alerts(2, cursor)
        sql, binds = self.connection.statements[-1]
        self.assertIn('PARTITION BY ID_GASOLINERA, ID_COMBUSTIBLE', sql)
        self.assertIn('ORDER BY FECHA_REGISTRO, ID_PRECIO', sql)
        self.assertNotIn('NOTIFICACION', sql)
        self.assertNotIn('USUARIO', sql)
        self.assertEqual(binds, {'date_before': self.date.isoformat(timespec='microseconds'), 'id_before': 8, 'page_size': 3})
        self.assertIn('TO_TIMESTAMP(:date_before', sql)
        self.assertNotIn(cursor, sql)
        self.assertEqual(self.connection.statements[0][0], 'SET TRANSACTION READ ONLY')
        self.connection.commit.assert_not_called()

    def test_cursor_validation_errors_and_empty_history(self):
        for value in ['', 'bad!', 'a' * 257, 'bm90LWpzb24']:
            with self.assertRaises(ValueError):
                decode_cursor(value)
        self.engine.execute('DELETE FROM PRECIO')
        page = self.repo.list_alerts(25)
        self.assertEqual(page['alerts'], [])
        self.assertIsNone(page['nextCursor'])

    def test_driver_failure_is_sanitized(self):
        self.reader._get_pool.side_effect = RuntimeError('PRIVATE DSN/password')
        with self.assertRaises(OracleReadError) as caught:
            self.repo.list_alerts(25)
        self.assertEqual(caught.exception.code, 'ORACLE_UNAVAILABLE')
        self.assertNotIn('PRIVATE', str(caught.exception))

    def test_http_public_without_session_is_read_only_personal_remains_private(self):
        policy = AuthSettings(allowed_origins=('https://frontend.test.invalid',))
        auth = Mock(settings=policy)
        auth.current.side_effect = AuthError(401, 'SESSION_INVALID', 'No session')
        app = create_app(self.settings, repository=self.reader, auth_settings=policy, auth_service=auth,
                         public_alert_repository=self.repo)
        with TestClient(app, base_url='https://api.testserver') as client:
            response = client.get('/public/price-alerts?limit=2', headers={'Origin': policy.allowed_origins[0]})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['count'], 2)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(response.headers['access-control-allow-origin'], policy.allowed_origins[0])
            auth.current.assert_not_called()
            for method in ['post', 'put', 'patch', 'delete']:
                self.assertEqual(getattr(client, method)('/public/price-alerts').status_code, 405)
            self.assertEqual(client.get('/notifications').status_code, 401)
            for query in ['limit=101', 'limit=0', 'cursor=bad!', 'cursor=' + 'a' * 257]:
                self.assertEqual(client.get('/public/price-alerts?' + query).status_code, 422)
            unauthorized = client.get('/public/price-alerts', headers={'Origin': 'https://other.test.invalid'})
            self.assertNotIn('access-control-allow-origin', unauthorized.headers)
            self.reader._get_pool.side_effect = RuntimeError('PRIVATE DSN/password')
            failure = client.get('/public/price-alerts')
            self.assertEqual(failure.status_code, 503)
            self.assertNotIn('PRIVATE', failure.text)
