"""scrypt per OWASP: N=2**17, r=8, p=1, unique random salt; fits CLAVE_HASH(255)."""
import base64
import hashlib
import hmac
import secrets

PREFIX = 'scrypt$131072$8$1'


def _derive(password, salt):
    return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=131072, r=8, p=1,
                          dklen=32, maxmem=256 * 1024 * 1024)


def _encode(value):
    return base64.urlsafe_b64encode(value).decode('ascii')


def hash_password(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 1024 or len(password.encode()) > 4096:
        raise ValueError('Usa una contraseña de 12 a 1024 caracteres (máximo 4096 bytes).')
    salt = secrets.token_bytes(16)
    return f'{PREFIX}${_encode(salt)}${_encode(_derive(password, salt))}'


def verify_password(password, stored):
    # Unknown/placeholder hashes incur the same work as a normal password check.
    salt, expected, valid = bytes(16), bytes(32), False
    try:
        parts = stored.split('$')
        if len(parts) == 6 and '$'.join(parts[:4]) == PREFIX:
            decoded_salt = base64.b64decode(parts[4], altchars=b'-_', validate=True)
            decoded_hash = base64.b64decode(parts[5], altchars=b'-_', validate=True)
            if len(decoded_salt) == 16 and len(decoded_hash) == 32:
                salt, expected, valid = decoded_salt, decoded_hash, True
    except (AttributeError, ValueError, TypeError):
        pass
    actual = _derive(password, salt)
    return hmac.compare_digest(actual, expected) and valid


if __name__ == '__main__':
    from getpass import getpass
    first = getpass('Nueva contraseña (no se muestra): ')
    if first != getpass('Repetir contraseña: '):
        raise SystemExit('Las contraseñas no coinciden.')
    print(hash_password(first))
