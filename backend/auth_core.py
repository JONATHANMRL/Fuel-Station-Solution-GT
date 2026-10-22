"""Server-side opaque sessions and permissions. No Oracle writes."""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from threading import BoundedSemaphore

from .passwords import verify_password


class AuthError(Exception):
    def __init__(self, status, code, message, clear_cookie=False):
        self.status, self.code, self.message, self.clear_cookie = status, code, message, clear_cookie
        super().__init__(code)


def unavailable():
    return AuthError(503, 'AUTH_UNAVAILABLE', 'Acceso administrativo no disponible. Inténtalo más tarde.')


@dataclass(frozen=True)
class User:
    id: str
    email: str
    password_hash: str = field(repr=False)
    state: str


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class SessionStore:
    """Private SQLite runtime file, separate from the ten Oracle tables.

    Stores only SHA-256 token digests, never the cookie token or passwords.
    Transactions make revocation/rate limits work across API workers/restarts.
    """
    def __init__(self, path):
        self.path = path

    @contextmanager
    def connection(self):
        try:
            # Parent directory must already be provisioned privately by the operator.
            if not Path(self.path).exists():
                try:
                    fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                    os.close(fd)
                except FileExistsError:
                    pass
            if os.name == 'posix' and os.stat(self.path).st_mode & 0o077:
                raise unavailable()
            with closing(sqlite3.connect(self.path, timeout=5)) as connection:
                with connection:
                    connection.execute('CREATE TABLE IF NOT EXISTS sessions '
                                       '(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, '
                                       'credential_hash TEXT NOT NULL, expires REAL NOT NULL)')
                    connection.execute('CREATE TABLE IF NOT EXISTS attempts '
                                       '(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires REAL NOT NULL)')
                with connection:
                    yield connection
        except (sqlite3.Error, OSError):
            raise unavailable() from None

    def create(self, user, now, ttl):
        token = secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute('DELETE FROM sessions WHERE expires <= ?', (now,))
            db.execute('INSERT INTO sessions VALUES (?, ?, ?, ?)',
                       (digest(token), user.id, digest(user.password_hash), now + ttl))
        return token, now + ttl

    def get(self, token, now):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            return None
        with self.connection() as db:
            db.execute('DELETE FROM sessions WHERE expires <= ?', (now,))
            return db.execute('SELECT user_id, credential_hash, expires FROM sessions WHERE token_hash = ?',
                              (digest(token),)).fetchone()

    def revoke(self, token):
        if token:
            with self.connection() as db:
                db.execute('DELETE FROM sessions WHERE token_hash = ?', (digest(token),))

    def take_attempt(self, key, now, limit):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM attempts WHERE expires <= ?', (now,))
            row = db.execute('SELECT count FROM attempts WHERE key = ?', (key,)).fetchone()
            if row and row[0] >= limit:
                raise AuthError(429, 'LOGIN_LIMIT', 'Demasiados intentos. Espera unos minutos antes de reintentar.')
            db.execute('INSERT INTO attempts VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1',
                       (key, now + 300))


class AuthService:
    def __init__(self, settings, repository, store=None, clock=time.time, verifier=verify_password):
        self.settings, self.repository = settings, repository
        self.store = store if store is not None else SessionStore(settings.session_db)
        self.clock, self.verifier = clock, verifier
        self.hash_slots = BoundedSemaphore(2)

    def ensure_ready(self):
        if not self.settings.ready:
            raise unavailable()

    def login(self, email, password, address, previous_token=None):
        self.ensure_ready()
        if not isinstance(email, str) or not email.strip() or len(email) > 150 or not isinstance(password, str) or not 1 <= len(password) <= 1024 or len(password.encode()) > 4096:
            raise AuthError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos, o acceso no autorizado.')
        now = self.clock()
        email = email.strip().lower()
        for key, limit in [('global', 60), ('ip:' + digest(address), 30), ('email:' + digest(email), 5)]:
            self.store.take_attempt(key, now, limit)
        if not self.hash_slots.acquire(blocking=False):
            raise AuthError(429, 'LOGIN_BUSY', 'Inténtalo nuevamente en unos segundos.')
        try:
            user = self.repository.find_by_email(email)
            valid = self.verifier(password, user.password_hash if user else '')
        except AuthError:
            raise
        except Exception:
            raise unavailable() from None
        finally:
            self.hash_slots.release()
        if not valid or not user or user.state != 'ACTIVO' or user.id not in self.settings.admin_ids:
            raise AuthError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos, o acceso no autorizado.')
        token, expires = self.store.create(user, now, self.settings.ttl_seconds)
        self.store.revoke(previous_token)
        return token, self.profile(user, expires)

    def current(self, token):
        self.ensure_ready()
        session = self.store.get(token, self.clock())
        if not session:
            raise AuthError(401, 'SESSION_INVALID', 'La sesión no existe o ha vencido.', True)
        user_id, credential_hash, expires = session
        user = self.repository.find_by_id(user_id)
        if expires <= self.clock():
            self.store.revoke(token)
            raise AuthError(401, 'SESSION_INVALID', 'La sesión ha vencido.', True)
        if not user or user.state != 'ACTIVO' or user.id not in self.settings.admin_ids or not hmac.compare_digest(credential_hash, digest(user.password_hash)):
            self.store.revoke(token)
            raise AuthError(403, 'ADMIN_DENIED', 'La cuenta ya no tiene acceso administrativo.', True)
        return self.profile(user, expires)

    def logout(self, token):
        self.ensure_ready()
        self.store.revoke(token)

    @staticmethod
    def profile(user, expires):
        from datetime import datetime, timezone
        return {'authenticated': True, 'user': {'id': user.id, 'email': user.email, 'role': 'admin'},
                'expiresAt': datetime.fromtimestamp(expires, timezone.utc).isoformat()}
