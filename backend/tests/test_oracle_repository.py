import unittest
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock, patch

from backend.config import OracleSettings
from backend.oracle_repository import OracleReadError, OracleStationRepository
from backend.tests.fixtures import snapshot


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []
        self.selected = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, statement):
        self.executed.append(statement)
        if statement == 'SET TRANSACTION READ ONLY':
            return
        self.selected = next(rows for view, rows in self.rows.items() if view in statement)
        # A real cursor has a description even when no rows are returned.
        columns = list(self.selected[0]) if self.selected else ['ID_GASOLINERA']
        self.description = [(name,) for name in columns]

    def fetchall(self):
        return [tuple(row.values()) for row in self.selected]


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.settings = OracleSettings(enabled=True, host='db.invalid', service_name='TEST',
                                       user='reader', password='private-test-password', schema='OWNER')

    def make_driver(self):
        rows = snapshot()
        cursor = FakeCursor({'V_GASOLINERA_UBICACION': rows.locations,
                             'V_MAPA_GASOLINERA': rows.map_rows,
                             'V_PRECIO_ACTUAL': rows.price_rows})
        connection = Mock()
        connection.__enter__ = Mock(return_value=connection)
        connection.__exit__ = Mock(return_value=False)
        connection.cursor.return_value = cursor
        pool = Mock()
        pool.acquire.return_value = connection
        driver = SimpleNamespace(create_pool=Mock(return_value=pool), POOL_GETMODE_TIMEDWAIT='timed')
        return driver, pool, connection, cursor

    def test_configuration_missing_never_imports_driver_or_connects(self):
        for settings in (OracleSettings(), replace(self.settings, password='')):
            with patch('backend.oracle_repository.import_module') as load:
                with self.assertRaises(OracleReadError) as error:
                    OracleStationRepository(settings).list_stations()
                self.assertEqual(error.exception.code, 'ORACLE_NOT_CONFIGURED')
                load.assert_not_called()

    def test_driver_and_pool_are_lazy_and_three_views_share_read_only_transaction(self):
        driver, pool, connection, cursor = self.make_driver()
        with patch('backend.oracle_repository.import_module', return_value=driver) as load:
            repository = OracleStationRepository(self.settings)
            load.assert_not_called()
            self.assertEqual(len(repository.list_stations()), 25)
            self.assertEqual(cursor.executed[0], 'SET TRANSACTION READ ONLY')
            self.assertEqual(len(cursor.executed), 4)
            self.assertTrue(all('FROM "OWNER".V_' in sql for sql in cursor.executed[1:]))
            self.assertEqual(connection.call_timeout, 5000)
            connection.commit.assert_not_called()
            self.assertEqual(driver.create_pool.call_args.kwargs['host'], 'db.invalid')
            self.assertEqual(driver.create_pool.call_args.kwargs['min'], 0)
            repository.list_stations()
            driver.create_pool.assert_called_once()
            self.assertEqual(pool.acquire.call_count, 2)
            repository.close()
            pool.close.assert_called_once()

    def test_missing_driver_returns_safe_error(self):
        with patch('backend.oracle_repository.import_module', side_effect=ImportError('secret')):
            with self.assertRaises(OracleReadError) as error:
                OracleStationRepository(self.settings).list_stations()
        self.assertEqual(str(error.exception), 'ORACLE_DRIVER_UNAVAILABLE')

    def test_pool_failure_is_sanitized_and_next_request_can_recreate_pool(self):
        driver, pool, _, _ = self.make_driver()
        driver.create_pool.side_effect = [RuntimeError('private-test-password @ db.invalid'), pool]
        with patch('backend.oracle_repository.import_module', return_value=driver):
            repository = OracleStationRepository(self.settings)
            with self.assertRaises(OracleReadError) as error:
                repository.list_stations()
            self.assertEqual(str(error.exception), 'ORACLE_UNAVAILABLE')
            self.assertEqual(len(repository.list_stations()), 25)

    def test_query_failure_is_sanitized_and_connection_is_released(self):
        driver, _, connection, cursor = self.make_driver()
        cursor.execute = Mock(side_effect=RuntimeError('private database error'))
        with patch('backend.oracle_repository.import_module', return_value=driver):
            with self.assertRaises(OracleReadError) as error:
                OracleStationRepository(self.settings).list_stations()
        self.assertEqual(str(error.exception), 'ORACLE_UNAVAILABLE')
        connection.__exit__.assert_called_once()

    def test_inconsistent_oracle_data_does_not_become_demo_data(self):
        driver, _, _, cursor = self.make_driver()
        cursor.rows['V_PRECIO_ACTUAL'].pop()
        with patch('backend.oracle_repository.import_module', return_value=driver):
            with self.assertRaises(OracleReadError) as error:
                OracleStationRepository(self.settings).list_stations()
        self.assertEqual(str(error.exception), 'ORACLE_INVALID_DATA')


if __name__ == '__main__':
    unittest.main()
