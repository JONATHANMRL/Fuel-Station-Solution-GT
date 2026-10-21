import unittest

from backend.config import ConfigurationError, OracleSettings


class ConfigurationTests(unittest.TestCase):
    def test_disabled_by_default_and_no_fixed_host(self):
        settings = OracleSettings.from_env({})
        self.assertFalse(settings.enabled)
        self.assertFalse(settings.ready)
        self.assertEqual(settings.host, '')

    def test_settings_only_use_server_environment_and_hide_password_in_repr(self):
        settings = OracleSettings.from_env({
            'ORACLE_ENABLED': 'true', 'ORACLE_HOST': 'db.invalid',
            'ORACLE_SERVICE_NAME': 'SERVICE_TEST', 'ORACLE_USER': 'read_test',
            'ORACLE_PASSWORD': ' secret-test-password ', 'ORACLE_SCHEMA': 'gasolinagt',
        })
        self.assertTrue(settings.ready)
        self.assertEqual(settings.schema, 'GASOLINAGT')
        self.assertEqual(settings.password, ' secret-test-password ')
        self.assertNotIn('secret-test-password', repr(settings))

    def test_bad_schema_port_timeout_or_cors_is_rejected(self):
        for env in ({'ORACLE_SCHEMA': 'OWNER; DROP TABLE X'}, {'ORACLE_PORT': '0'},
                    {'ORACLE_PORT': 'text'}, {'ORACLE_POOL_MAX': '0'},
                    {'ORACLE_CALL_TIMEOUT_MS': '-1'}, {'ORACLE_ENABLED': 'yes'},
                    {'CORS_ORIGINS': '*'}, {'CORS_ORIGINS': 'http://localhost:5173/path'}):
            with self.subTest(env=env), self.assertRaises(ConfigurationError):
                OracleSettings.from_env(env)


if __name__ == '__main__':
    unittest.main()
