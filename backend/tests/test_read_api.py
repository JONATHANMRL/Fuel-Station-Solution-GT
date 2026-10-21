"""In-process HTTP tests; no Uvicorn listener and no database connection."""

import importlib.util
import unittest
from unittest.mock import Mock, patch

from backend.config import OracleSettings
from backend.oracle_repository import OracleReadError
from backend.station_contract import build_stations
from backend.tests.fixtures import snapshot


HAS_HTTP_DEPENDENCIES = all(importlib.util.find_spec(name) is not None
                            for name in ('fastapi', 'pydantic', 'httpx'))


@unittest.skipUnless(HAS_HTTP_DEPENDENCIES, 'Requiere backend/requirements-test.txt; no se instala automáticamente.')
class ReadAPITests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from backend.main import create_app
        self.reader = Mock()
        self.reader.list_stations.return_value = build_stations(snapshot())
        self.client = TestClient(create_app(OracleSettings(), repository=self.reader))

    def test_http_json_contract_for_25_stations_and_75_prices(self):
        with patch('socket.create_connection', side_effect=AssertionError('No network allowed')):
            with self.client as client:
                response = client.get('/stations')
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertEqual(data['count'], 25)
                self.assertEqual(data['source'], 'oracle')
                self.assertEqual(len(data['stations']), 25)
                self.assertEqual(set(data['stations'][0]['prices']), {'premium', 'regular', 'diesel'})
                self.assertIsInstance(data['stations'][0]['prices']['regular'], float)
                self.assertEqual(client.get('/prices').json()['count'], 75)
                self.assertEqual(client.get('/prices?fuel=diesel').json()['count'], 25)
                self.assertEqual(client.get('/brands').json()['count'], 7)
        self.reader.close.assert_called_once()

    def test_missing_oracle_returns_503_without_fixtures_or_credentials(self):
        self.reader.list_stations.side_effect = OracleReadError('ORACLE_NOT_CONFIGURED')
        with self.client as client:
            for path in ('/stations', '/prices', '/brands'):
                response = client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()['detail']['code'], 'ORACLE_NOT_CONFIGURED')
                self.assertNotIn('est-1', response.text)

    def test_invalid_fuel_is_422_and_admin_write_remains_blocked(self):
        with self.client as client:
            self.assertEqual(client.get('/prices?fuel=kerosene').status_code, 422)
            response = client.post('/admin/prices', json={'station_id': '1', 'fuel': 'regular', 'price': 1})
            self.assertEqual(response.status_code, 503)

    def test_health_is_liveness_only_and_does_not_query_oracle(self):
        with self.client as client:
            self.assertEqual(client.get('/health').status_code, 200)
            self.reader.list_stations.assert_not_called()

    def test_unapproved_origin_does_not_receive_cors_permission(self):
        with self.client as client:
            response = client.get('/stations', headers={'Origin': 'https://not-approved.invalid'})
            self.assertNotIn('access-control-allow-origin', response.headers)
            response = client.get('/stations', headers={'Origin': 'http://localhost:5173'})
            self.assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:5173')


if __name__ == '__main__':
    unittest.main()
