import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

from backend.auth_config import AuthSettings
from backend.auth_core import AuthError, AuthService, User, digest
from backend.auth_repository import OracleUserRepository
from backend.config import ConfigurationError, OracleSettings
from backend.passwords import hash_password, verify_password
from backend.station_contract import build_stations
from backend.tests.fixtures import snapshot

PASSWORD = 'Simulated strong password 42!'


class FakeUsers:
    def __init__(self, hashed):
        self.users = {'42': User('42', 'admin@example.invalid', hashed, 'ACTIVO'),
                      '99': User('99', 'reader@example.invalid', hashed, 'ACTIVO'),
                      '1': User('1', 'demo@example.invalid', 'PENDIENTE_HASH_DEMO', 'ACTIVO')}

    def find_by_email(self, email):
        return next((user for user in self.users.values() if user.email == email), None)

    def find_by_id(self, user_id):
        return self.users.get(user_id)


class AuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hashed = hash_password(PASSWORD)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings = AuthSettings(True, frozenset({'42'}), str(Path(self.temp.name) / 'sessions.sqlite3'),
                                     60, 'none', ('https://frontend.example.invalid',))
        self.repo = FakeUsers(self.hashed)
        self.now = [2000000000.0]
        self.service = AuthService(self.settings, self.repo, clock=lambda: self.now[0])

    def login(self):
        return self.service.login('admin@example.invalid', PASSWORD, 'client')

    def test_scrypt_salt_and_hash_fit_oracle_and_verify(self):
        other = hash_password(PASSWORD)
        self.assertNotEqual(other, self.hashed)
        self.assertLessEqual(len(other), 255)
        self.assertNotIn(PASSWORD, other)
        self.assertTrue(verify_password(PASSWORD, other))
        self.assertFalse(verify_password('wrong', other))
        self.assertFalse(verify_password(PASSWORD, 'PENDIENTE_HASH_DEMO'))
        self.assertFalse(verify_password(PASSWORD, 'scrypt$999999999$8$1$bad$bad'))

    def test_login_success_profile_and_hashed_server_storage(self):
        token, profile = self.login()
        self.assertEqual(profile['user']['id'], '42')
        self.assertEqual(profile['user']['role'], 'admin')
        self.assertEqual(self.service.current(token), profile)
        contents = Path(self.settings.session_db).read_bytes()
        self.assertNotIn(token.encode(), contents)
        self.assertNotIn(PASSWORD.encode(), contents)
        self.assertNotIn(self.hashed.encode(), contents)
        with closing(sqlite3.connect(self.settings.session_db)) as db:
            self.assertEqual(db.execute('SELECT token_hash FROM sessions').fetchone()[0], digest(token))

    def test_incorrect_unknown_inactive_and_nonadmin_login_fail(self):
        for email, password in [('admin@example.invalid', 'wrong'), ('absent@example.invalid', PASSWORD),
                                ('reader@example.invalid', PASSWORD), ('demo@example.invalid', PASSWORD)]:
            with self.subTest(email=email), self.assertRaises(AuthError) as error:
                self.service.login(email, password, 'client')
            self.assertEqual(error.exception.status, 401)
        self.repo.users['42'] = replace(self.repo.users['42'], state='INACTIVO')
        with self.assertRaises(AuthError) as error:
            self.login()
        self.assertEqual(error.exception.status, 401)

    def test_expiry_and_logout_are_server_enforced(self):
        token, _ = self.login()
        self.now[0] += 60
        with self.assertRaises(AuthError) as error:
            self.service.current(token)
        self.assertEqual(error.exception.status, 401)
        token, _ = self.login()
        self.service.logout(token)
        with self.assertRaises(AuthError):
            self.service.current(token)

    def test_session_expiring_during_oracle_lookup_is_denied(self):
        token, _ = self.login()
        original = self.repo.find_by_id
        def delayed(user_id):
            self.now[0] += 61
            return original(user_id)
        self.repo.find_by_id = delayed
        with self.assertRaises(AuthError) as error:
            self.service.current(token)
        self.assertEqual(error.exception.status, 401)

    def test_revocation_survives_service_restart(self):
        token, _ = self.login()
        restarted = AuthService(self.settings, self.repo, clock=lambda: self.now[0])
        self.assertEqual(restarted.current(token)['user']['id'], '42')
        restarted.logout(token)
        with self.assertRaises(AuthError):
            self.service.current(token)

    def test_role_state_and_password_changes_revoke_existing_sessions(self):
        for change in ('policy', 'inactive', 'password'):
            with self.subTest(change=change):
                service = AuthService(self.settings, FakeUsers(self.hashed), clock=lambda: self.now[0])
                token, _ = service.login('admin@example.invalid', PASSWORD, 'client')
                if change == 'policy':
                    service.settings = replace(self.settings, admin_ids=frozenset({'99'}))
                elif change == 'inactive':
                    service.repository.users['42'] = replace(service.repository.users['42'], state='INACTIVO')
                else:
                    service.repository.users['42'] = replace(service.repository.users['42'], password_hash='different')
                with self.assertRaises(AuthError) as error:
                    service.current(token)
                self.assertEqual(error.exception.status, 403)

    def test_rotation_invalidates_previous_cookie(self):
        first, _ = self.login()
        second, _ = self.service.login('admin@example.invalid', PASSWORD, 'client', first)
        self.assertNotEqual(first, second)
        with self.assertRaises(AuthError):
            self.service.current(first)

    def test_login_rate_limit_is_persistent(self):
        service = AuthService(self.settings, self.repo, clock=lambda: self.now[0], verifier=lambda *_: False)
        for _ in range(5):
            with self.assertRaises(AuthError):
                service.login('admin@example.invalid', 'wrong', 'client')
        restarted = AuthService(self.settings, self.repo, clock=lambda: self.now[0])
        with self.assertRaises(AuthError) as error:
            restarted.login('admin@example.invalid', PASSWORD, 'another-client')
        self.assertEqual(error.exception.status, 429)

    def test_no_implicit_admin_or_repository_state_on_import(self):
        self.assertFalse(AuthSettings().ready)
        blocked = AuthService(AuthSettings(), Mock())
        with self.assertRaises(AuthError) as error:
            blocked.login('any', 'any', 'any')
        self.assertEqual(error.exception.status, 503)
        blocked.repository.find_by_email.assert_not_called()

    def test_private_config_and_oracle_account_separation(self):
        with self.assertRaises(ConfigurationError):
            AuthSettings(session_db=str(Path(__file__).resolve().parent / 'unsafe.sqlite3'))
        for user in ['GASOLINAGT_API', 'reader', 'SYS', 'SYSTEM']:
            repo = OracleUserRepository(OracleSettings(enabled=True, host='db.invalid', service_name='TEST',
                                                       user=user, password='fake'), 'reader')
            with patch.object(repo.reader, '_get_pool') as pool, self.assertRaises(AuthError):
                repo.find_by_email('admin@example.invalid')
            pool.assert_not_called()

    def test_oracle_lookup_uses_bound_select_on_separate_account(self):
        repo = OracleUserRepository(OracleSettings(enabled=True, host='db.invalid', service_name='TEST',
                                                   user='GASOLINAGT_ADMIN', password='fake', schema='OWNER'), 'GASOLINAGT_API')
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchmany.return_value = [(42, 'admin@example.invalid', self.hashed, 'ACTIVO')]
        conn = Mock()
        conn.__enter__ = Mock(return_value=conn)
        conn.__exit__ = Mock(return_value=False)
        conn.cursor.return_value = cursor
        pool = Mock()
        pool.acquire.return_value = conn
        with patch.object(repo.reader, '_get_pool', return_value=pool):
            self.assertEqual(repo.find_by_email("x' OR 1=1 --").id, '42')
        sql, binds = cursor.execute.call_args.args
        self.assertIn('"OWNER".USUARIO WHERE LOWER(CORREO) = :value', sql)
        self.assertNotIn("OR 1=1", sql)
        self.assertEqual(binds, {'value': "x' OR 1=1 --"})
        conn.commit.assert_not_called()


HAS_HTTP = all(importlib.util.find_spec(name) is not None for name in ('fastapi', 'pydantic', 'httpx'))


@unittest.skipUnless(HAS_HTTP, 'Requiere requirements-test.txt')
class AuthHTTPTests(AuthTests):
    # Reuse setup and fixture only, not the core test methods below (see load_tests).
    def setUp(self):
        super().setUp()
        from fastapi.testclient import TestClient
        from backend.main import create_app
        reader = Mock()
        reader.list_stations.return_value = build_stations(snapshot())
        app = create_app(OracleSettings(cors_origins=self.settings.allowed_origins), repository=reader,
                         auth_settings=self.settings, auth_service=self.service)
        self.client = TestClient(app, base_url='https://api.testserver')
        self.headers = {'Origin': self.settings.allowed_origins[0], 'X-Admin-Request': '1'}
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def post_login(self, **kwargs):
        return self.client.post('/auth/login', json={'email': 'admin@example.invalid', 'password': PASSWORD},
                                headers=kwargs.pop('headers', self.headers), **kwargs)

    def test_http_cookie_login_session_logout_and_no_token_in_json(self):
        response = self.post_login()
        self.assertEqual(response.status_code, 200)
        cookie = response.headers['set-cookie']
        for attribute in ['__Host-fsgt_admin=', 'HttpOnly', 'Secure', 'Path=/', 'SameSite=none']:
            self.assertIn(attribute, cookie)
        self.assertNotIn('Domain=', cookie)
        self.assertNotIn(PASSWORD, response.text)
        self.assertNotIn(self.hashed, response.text)
        self.assertNotIn('token', response.json())
        self.assertEqual(self.client.get('/auth/session').status_code, 200)
        self.assertEqual(self.client.post('/auth/logout', json={}, headers=self.headers).status_code, 204)
        self.assertEqual(self.client.get('/auth/session').status_code, 401)

    def test_http_wrong_credentials_and_expired_session(self):
        response = self.client.post('/auth/login', json={'email': 'admin@example.invalid', 'password': 'wrong'}, headers=self.headers)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.post_login().status_code, 200)
        self.now[0] += 61
        self.assertEqual(self.client.get('/auth/session').status_code, 401)

    def test_http_admin_permission_and_price_writes_always_disabled(self):
        body = {'station_id': '1', 'fuel': 'regular', 'price': 1}
        self.assertEqual(self.client.post('/admin/prices', json=body, headers=self.headers).status_code, 401)
        self.post_login()
        response = self.client.post('/admin/prices', json=body, headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail']['code'], 'PRICE_WRITES_DISABLED')
        self.repo.users['42'] = replace(self.repo.users['42'], state='INACTIVO')
        self.assertEqual(self.client.get('/auth/session').status_code, 403)

    def test_http_csrf_origins_and_https_are_enforced(self):
        for headers in [{}, {'Origin': 'https://evil.invalid', 'X-Admin-Request': '1'}, {'Origin': self.headers['Origin']}]:
            self.assertEqual(self.post_login(headers=headers).status_code, 403)
        self.post_login()
        self.assertEqual(self.client.post('/auth/logout', json={}).status_code, 403)
        self.assertEqual(self.client.get('/auth/session').status_code, 200)
        self.assertEqual(self.client.get('http://api.testserver/auth/session').status_code, 403)

    def test_http_cors_and_validation_do_not_expose_credentials(self):
        result = self.client.options('/auth/login', headers={'Origin': self.headers['Origin'],
            'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-admin-request'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers['access-control-allow-credentials'], 'true')
        invalid = self.client.post('/auth/login', json={'email': [], 'password': PASSWORD}, headers=self.headers)
        self.assertEqual(invalid.status_code, 422)
        self.assertNotIn(PASSWORD, invalid.text)
        self.assertEqual(self.client.get('/stations').json()['count'], 25)


def load_tests(loader, tests, pattern):
    # Avoid running inherited core tests a second time with an HTTP fixture.
    suite = unittest.TestSuite(loader.loadTestsFromTestCase(AuthTests))
    suite.addTests(AuthHTTPTests(name) for name in dir(AuthHTTPTests) if name.startswith('test_http_'))
    return suite
