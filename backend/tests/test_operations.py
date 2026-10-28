import tempfile
import unittest
from dataclasses import replace
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from threading import Lock
from uuid import uuid4
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend.auth_config import AuthSettings
from backend.auth_core import AuthError, AuthService, SessionStore, User
from backend.config import ConfigurationError, OracleSettings
from backend.main import create_app
from backend.operation_ledger import OperationLedger
from backend.operations_api import OperationsService, PriceChange
from backend.operations_config import OperationsSettings, writer_credentials
from backend.operations_repository import OperationsError, OracleOperationsRepository
from backend.station_contract import build_stations
from backend.tests.fixtures import snapshot


class FakeOperations:
    ready = True

    def __init__(self):
        self.calls = 0
        self.latest = {'priceId': '100', 'price': 30.0}
        self.rows = []
        self.notices = []
        self.reads = set()
        self.lock = Lock()

    def update_price(self, station, fuel, price, expected):
        with self.lock:
            if expected != self.latest['priceId']:
                raise OperationsError(409, 'PRICE_CONFLICT', 'changed')
            self.calls += 1
            result = {'source': 'oracle', 'priceId': str(100 + self.calls), 'stationId': station, 'fuel': fuel,
                      'previousPrice': self.latest['price'], 'newPrice': float(price), 'updatedAt': '2026-10-26T12:00:00-06:00'}
            self.rows.insert(0, {**result, 'id': result['priceId'], 'stationName': 'Fixture station', 'administrator': None})
            if price < Decimal(str(self.latest['price'])):
                self.notices.append({'id': str(self.calls), 'owner': '22'})
            self.latest = {'priceId': result['priceId'], 'price': float(price)}
            return result

    def states(self):
        return [{'stationId': '1', 'fuel': 'regular', 'priceId': self.latest['priceId'],
                 'price': self.latest['price'], 'available': True}]

    def history(self, limit, offset):
        return self.rows[offset:offset + limit]

    def notifications(self, user_id, limit, offset):
        return [{'id': row['id'], 'source': 'oracle', 'read': row['id'] in self.reads}
                for row in self.notices if row['owner'] == user_id][offset:offset + limit]

    def mark_read(self, user_id, notice_id):
        if not any(row['owner'] == user_id and row['id'] == notice_id for row in self.notices):
            raise OperationsError(404, 'NOTIFICATION_NOT_FOUND', 'not found')
        self.reads.add(notice_id)


class OperationsHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = str(Path(self.temp.name) / 'sessions.sqlite3')
        self.policy = AuthSettings(True, frozenset({'22', '23'}), path, 60, 'none', ('https://front.test.invalid',))
        users = Mock()
        users.find_by_email.return_value = User('22', 'admin@example.invalid', 'SIMULATED_HASH', 'ACTIVO')
        users.find_by_id.side_effect = lambda identity: User(identity, 'admin@example.invalid', 'SIMULATED_HASH', 'ACTIVO')
        self.auth = AuthService(self.policy, users, verifier=lambda password, hashed: password == 'SIMULATED')
        self.repo = FakeOperations()
        self.ledger = OperationLedger(SessionStore(path))
        self.service = OperationsService(self.repo, OperationsSettings(True, True), self.ledger)
        reader = Mock()
        reader.list_stations.return_value = build_stations(snapshot())
        self.app = create_app(OracleSettings(cors_origins=self.policy.allowed_origins), repository=reader,
                              auth_settings=self.policy, auth_service=self.auth, operations_service=self.service)
        self.client = TestClient(self.app, base_url='https://api.testserver')
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.headers = {'Origin': self.policy.allowed_origins[0], 'X-Admin-Request': '1'}

    def login(self, client=None):
        response = (client or self.client).post('/auth/login', headers=self.headers,
                    json={'email': 'admin@example.invalid', 'password': 'SIMULATED'})
        self.assertEqual(response.status_code, 200)

    def payload(self, **changes):
        return {**{'station_id': '1', 'fuel': 'regular', 'price': '29.00', 'expected_price_id': '100', 'request_id': str(uuid4())}, **changes}

    def test_update_and_replay_have_one_history_and_one_notice(self):
        self.login()
        body = self.payload()
        first = self.client.post('/admin/prices', json=body, headers=self.headers)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertFalse(first.json()['replayed'])
        # A different service instance/worker shares the durable receipt.
        self.service.ledger = OperationLedger(SessionStore(self.policy.session_db))
        replay = self.client.post('/admin/prices', json={**body, 'price': '29.0'}, headers=self.headers)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertTrue(replay.json()['replayed'])
        self.assertEqual(self.repo.calls, 1)
        self.assertEqual(len(self.repo.rows), 1)
        self.assertEqual(len(self.repo.notices), 1)
        history = self.client.get('/admin/history').json()['history'][0]
        self.assertEqual((history['previousPrice'], history['newPrice'], history['administrator']), (30, 29, None))
        self.assertEqual(self.client.get('/admin/prices').json()['prices'][0]['price'], 29)

    def test_auth_csrf_permissions_and_default_disabled(self):
        body = self.payload()
        for path in ['/admin/capabilities', '/admin/history', '/admin/prices', '/notifications']:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post('/admin/prices', json=body, headers=self.headers).status_code, 401)
        self.login()
        self.assertEqual(self.client.post('/admin/prices', json=body).status_code, 403)
        self.assertEqual(self.client.post('http://api.testserver/admin/prices', json=body, headers=self.headers).status_code, 403)
        self.service.policy = OperationsSettings()
        self.assertFalse(self.client.get('/admin/capabilities').json()['priceWrites'])
        self.assertEqual(self.client.post('/admin/prices', json=body, headers=self.headers).status_code, 503)
        self.assertEqual(self.client.get('/notifications').status_code, 503)
        self.auth.repository.find_by_id.side_effect = lambda identity: User(identity, 'admin@example.invalid', 'SIMULATED_HASH', 'INACTIVO')
        self.assertEqual(self.client.post('/admin/prices', json=body, headers=self.headers).status_code, 403)
        self.assertEqual(self.repo.calls, 0)

    def test_invalid_prices_ids_payload_and_pagination_rejected(self):
        self.login()
        for changes in [{'price': price} for price in ['0', '-1', 'NaN', 'Infinity', '0.001', '1000000', None, True, 'abc']] + [
            {'fuel': 'extra'}, {'station_id': 'est-1'}, {'request_id': 'bad'}, {'user': 'forged'}, {'expected_price_id': '0'}]:
            with self.subTest(changes=changes):
                self.assertEqual(self.client.post('/admin/prices', json=self.payload(**changes), headers=self.headers).status_code, 422)
        self.assertEqual(self.client.get('/admin/history?limit=101').status_code, 422)
        self.assertEqual(self.client.get('/notifications?offset=-1').status_code, 422)
        self.assertEqual(self.repo.calls, 0)

    def test_two_clients_see_same_data_and_stale_edit_is_rejected(self):
        self.login()
        with TestClient(self.app, base_url='https://api.testserver') as second:
            self.login(second)
            expected = second.get('/admin/prices').json()['prices'][0]['priceId']
            self.assertEqual(self.client.post('/admin/prices', json=self.payload(), headers=self.headers).status_code, 200)
            self.assertEqual(second.get('/admin/prices').json()['prices'][0]['price'], 29)
            response = second.post('/admin/prices', json=self.payload(price='28', expected_price_id=expected), headers=self.headers)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.repo.calls, 1)

    def test_pending_request_after_uncertain_commit_is_never_reexecuted(self):
        self.login()
        self.repo.update_price = Mock(side_effect=OperationsError(503, 'COMMIT_UNCERTAIN', 'uncertain'))
        body = self.payload()
        self.assertEqual(self.client.post('/admin/prices', json=body, headers=self.headers).status_code, 503)
        retry = self.client.post('/admin/prices', json=body, headers=self.headers)
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(retry.json()['detail']['code'], 'REQUEST_UNRESOLVED')
        self.assertEqual(self.repo.update_price.call_count, 1)

    def test_request_id_cannot_be_reused_for_another_payload_or_actor(self):
        self.login()
        body = self.payload()
        self.client.post('/admin/prices', json=body, headers=self.headers)
        self.assertEqual(self.client.post('/admin/prices', json={**body, 'price': '28'}, headers=self.headers).status_code, 409)
        with self.assertRaises(AuthError):
            self.ledger.claim(body['request_id'], '23', 'different')

    def test_personal_notifications_and_mark_read_cannot_cross_accounts(self):
        self.login()
        self.client.post('/admin/prices', json=self.payload(), headers=self.headers)
        self.repo.notices.append({'id': '999', 'owner': '23'})
        notices = self.client.get('/notifications')
        self.assertEqual(notices.headers['cache-control'], 'no-store')
        self.assertEqual(notices.json()['userId'], '22')
        self.assertEqual([row['id'] for row in notices.json()['notifications']], ['1'])
        self.assertEqual(self.client.post('/notifications/999/read', json={}, headers=self.headers).status_code, 404)
        for _ in range(2):
            self.assertEqual(self.client.post('/notifications/1/read', json={}, headers=self.headers).status_code, 204)
        self.assertTrue(self.client.get('/notifications').json()['notifications'][0]['read'])
        self.assertEqual(self.client.post('/notifications/0/read', json={}, headers=self.headers).status_code, 422)


class RepositoryTransactionTests(unittest.TestCase):
    def setUp(self):
        self.repo = OracleOperationsRepository(OracleSettings(schema='GASOLINAGT'), OperationsSettings(True, True))
        self.cursor = Mock()
        self.cursor.__enter__ = Mock(return_value=self.cursor)
        self.cursor.__exit__ = Mock(return_value=False)
        self.connection = Mock()
        self.connection.__enter__ = Mock(return_value=self.connection)
        self.connection.__exit__ = Mock(return_value=False)
        self.connection.cursor.return_value = self.cursor
        self.pool = Mock()
        self.pool.acquire.return_value = self.connection
        self.patch = patch.object(self.repo.reader, '_get_pool', return_value=self.pool)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.cursor.fetchone.side_effect = [('DISPONIBLE', 'ACTIVA', 'ACTIVO', 'Regular'),
            (100, Decimal('30'), datetime(2026, 10, 25)), (101, Decimal('29'), datetime(2026, 10, 26))]

    def update(self):
        return self.repo.update_price('1', 'regular', Decimal('29'), '100')

    def test_exact_procedure_signature_commit_once_no_direct_price_dml(self):
        result = self.update()
        self.cursor.callproc.assert_called_once_with('"GASOLINAGT".REGISTRAR_PRECIO', [1, 1, Decimal('29')])
        self.connection.commit.assert_called_once()
        self.connection.rollback.assert_not_called()
        sql = ' '.join(call.args[0] for call in self.cursor.execute.call_args_list)
        self.assertIn('FOR UPDATE OF GC.ESTADO WAIT 5', sql)
        self.assertNotIn('INSERT', sql)
        self.assertNotIn('UPDATE "GASOLINAGT".PRECIO', sql)
        self.assertTrue(result['updatedAt'].endswith('-06:00'))
        self.assertEqual(result['previousPrice'], 30)

    def test_procedure_failure_rolls_back_and_never_commits(self):
        self.cursor.callproc.side_effect = RuntimeError('private DSN or driver failure')
        with self.assertRaises(OperationsError) as error:
            self.update()
        self.assertEqual(error.exception.code, 'OPERATIONS_UNAVAILABLE')
        self.assertNotIn('private', str(error.exception))
        self.connection.rollback.assert_called_once()
        self.connection.commit.assert_not_called()

    def test_unavailable_conflict_and_noop_do_not_call_procedure(self):
        for state, previous in [(('AGOTADO', 'ACTIVA', 'ACTIVO', 'Regular'), None),
                                (('DISPONIBLE', 'ACTIVA', 'ACTIVO', 'Regular'), (99, 30, datetime.now())),
                                (('DISPONIBLE', 'ACTIVA', 'ACTIVO', 'Regular'), (100, 29, datetime.now()))]:
            self.cursor.fetchone.side_effect = [state, previous]
            with self.assertRaises(OperationsError):
                self.update()
        self.cursor.callproc.assert_not_called()
        self.connection.commit.assert_not_called()

    def test_commit_failure_is_uncertain_not_retryable(self):
        self.connection.commit.side_effect = RuntimeError('lost acknowledgement')
        with self.assertRaises(OperationsError) as error:
            self.update()
        self.assertEqual(error.exception.code, 'COMMIT_UNCERTAIN')

    def test_history_uses_real_price_predecessor_before_pagination_and_no_fake_admin(self):
        self.cursor.fetchall.return_value = [(101, 1, 'Station', 1, 'Regular', Decimal('30'), Decimal('29'), datetime(2026, 10, 26))]
        rows = self.repo.history(50, 50)
        sql, binds = self.cursor.execute.call_args.args
        self.assertIn('LAG(PRECIO)', sql)
        self.assertIn('ORDER BY FECHA_REGISTRO, ID_PRECIO', sql)
        self.assertEqual(binds, {'offset': 50, 'limit': 50})
        self.assertIsNone(rows[0]['administrator'])
        self.connection.commit.assert_not_called()

    def test_notification_read_is_bound_to_session_owner(self):
        self.cursor.rowcount = 1
        self.repo.mark_read('22', '123')
        sql, binds = self.cursor.execute.call_args.args
        self.assertIn('ID_USUARIO=:user_id', sql)
        self.assertEqual(binds, {'id': 123, 'user_id': 22})
        self.connection.commit.assert_called_once()

    def test_configuration_defaults_and_account_separation(self):
        self.assertFalse(OperationsSettings.from_env({}).writes_enabled)
        self.assertFalse(OperationsSettings.from_env({}).notifications_enabled)
        for account in ['GASOLINAGT_API', 'GASOLINAGT_ADMIN', 'SYS', 'SYSTEM', 'GASOLINAGT']:
            with self.assertRaises(ConfigurationError):
                writer_credentials(OracleSettings(user='GASOLINAGT_API', schema='GASOLINAGT'), 'GASOLINAGT_ADMIN',
                                   {'OPERATIONS_ORACLE_USER': account})
        with self.assertRaises(ConfigurationError):
            OperationsSettings.from_env({'PRICE_WRITES_ENABLED': 'yes'})
