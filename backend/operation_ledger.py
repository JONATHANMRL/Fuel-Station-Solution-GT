"""Auxiliary durable request receipts, sharing the existing private session store.

Not an Oracle audit column. A crash between Oracle COMMIT and receipt completion
leaves a pending receipt: never retry that write automatically.
"""
import json

from .auth_core import AuthError


class OperationLedger:
    def __init__(self, store):
        self.store = store

    def claim(self, request_id, actor, fingerprint):
        with self.store.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS price_requests (request_id TEXT PRIMARY KEY, '
                       'actor TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, result TEXT)')
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT actor, fingerprint, status, result FROM price_requests WHERE request_id=?',
                             (request_id,)).fetchone()
            if row:
                if row[0] != actor or row[1] != fingerprint:
                    raise AuthError(409, 'REQUEST_REUSED', 'El identificador ya corresponde a otra solicitud.')
                if row[2] == 'complete':
                    return json.loads(row[3])
                raise AuthError(409, 'REQUEST_UNRESOLVED',
                                'Solicitud pendiente o fallida. Consulta precios e historial antes de intentar otro cambio.')
            db.execute('INSERT INTO price_requests VALUES (?, ?, ?, ?, NULL)',
                       (request_id, actor, fingerprint, 'pending'))
        return None

    def finish(self, request_id, result=None):
        with self.store.connection() as db:
            db.execute('UPDATE price_requests SET status=?, result=? WHERE request_id=?',
                       ('complete' if result is not None else 'failed', json.dumps(result) if result is not None else None,
                        request_id))
