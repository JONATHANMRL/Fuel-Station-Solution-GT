"""Private administrative policy; no account is authorized by default."""
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .config import ConfigurationError, OracleSettings


@dataclass(frozen=True)
class AuthSettings:
    enabled: bool = False
    admin_ids: frozenset[str] = frozenset()
    session_db: str = ''
    ttl_seconds: int = 1800
    same_site: str = 'none'
    allowed_origins: tuple[str, ...] = ()

    def __post_init__(self):
        if not 60 <= self.ttl_seconds <= 28800:
            raise ConfigurationError('AUTH_SESSION_TTL_SECONDS debe estar entre 60 y 28800.')
        if self.same_site not in ('none', 'lax', 'strict'):
            raise ConfigurationError('AUTH_COOKIE_SAMESITE inválido.')
        if any(not value.isascii() or not value.isdigit() or int(value) <= 0 or str(int(value)) != value
               for value in self.admin_ids):
            raise ConfigurationError('AUTH_ADMIN_USER_IDS debe contener IDs positivos canónicos.')
        OracleSettings(cors_origins=self.allowed_origins)
        if any(urlsplit(origin).scheme == 'http' and urlsplit(origin).hostname not in ('localhost', '127.0.0.1', '::1')
               for origin in self.allowed_origins):
            raise ConfigurationError('Los orígenes administrativos remotos requieren HTTPS.')
        if self.session_db:
            path = Path(self.session_db)
            project = Path(__file__).resolve().parent.parent
            if not path.is_absolute() or path.resolve().is_relative_to(project):
                raise ConfigurationError('AUTH_SESSION_DB debe estar fuera del proyecto, con ruta absoluta.')

    @property
    def ready(self):
        return self.enabled and bool(self.admin_ids and self.session_db and self.allowed_origins)

    @classmethod
    def from_env(cls, origins):
        enabled = os.environ.get('AUTH_ENABLED', 'false').lower().strip()
        if enabled not in ('true', 'false'):
            raise ConfigurationError('AUTH_ENABLED debe ser true o false.')
        try:
            ttl = int(os.environ.get('AUTH_SESSION_TTL_SECONDS', '1800'))
        except ValueError:
            raise ConfigurationError('AUTH_SESSION_TTL_SECONDS debe ser un entero.') from None
        allowed = os.environ.get('AUTH_ALLOWED_ORIGINS')
        return cls(enabled == 'true',
                   frozenset(x.strip() for x in os.environ.get('AUTH_ADMIN_USER_IDS', '').split(',') if x.strip()),
                   os.environ.get('AUTH_SESSION_DB', ''), ttl,
                   os.environ.get('AUTH_COOKIE_SAMESITE', 'none'),
                   tuple(x.strip() for x in allowed.split(',') if x.strip()) if allowed is not None else origins)
