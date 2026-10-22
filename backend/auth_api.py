from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, SecretStr

from .auth_core import AuthError

COOKIE = '__Host-fsgt_admin'
router = APIRouter(tags=['Autenticación administrativa'])


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=150)
    password: SecretStr


def secure_request(request):
    if request.url.scheme != 'https':
        raise AuthError(403, 'HTTPS_REQUIRED', 'El acceso administrativo requiere HTTPS.')
    origin = request.headers.get('origin')
    if origin is not None and origin not in request.app.state.auth_service.settings.allowed_origins:
        raise AuthError(403, 'ORIGIN_DENIED', 'Origen de solicitud no autorizado.')


def mutation_origin(request):
    secure_request(request)
    settings = request.app.state.auth_service.settings
    if request.headers.get('origin') not in settings.allowed_origins or request.headers.get('x-admin-request') != '1':
        raise AuthError(403, 'ORIGIN_DENIED', 'Origen de solicitud no autorizado.')


def clear_session_cookie(response, settings):
    response.delete_cookie(COOKIE, path='/', secure=True, httponly=True, samesite=settings.same_site)


def require_administrator(request: Request):
    secure_request(request)
    profile = request.app.state.auth_service.current(request.cookies.get(COOKIE))
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        mutation_origin(request)
    return profile


def auth_error_handler(request, error):
    response = JSONResponse(status_code=error.status, content={'detail': {'code': error.code, 'message': error.message}},
                            headers={'Cache-Control': 'no-store'})
    if error.status == 429:
        response.headers['Retry-After'] = '300'
    if error.clear_cookie:
        clear_session_cookie(response, request.app.state.auth_service.settings)
    return response


@router.post('/auth/login')
def login(body: LoginRequest, request: Request, response: Response):
    mutation_origin(request)
    service = request.app.state.auth_service
    token, profile = service.login(body.email, body.password.get_secret_value(),
                                   request.client.host if request.client else 'unknown', request.cookies.get(COOKIE))
    response.set_cookie(COOKIE, token, max_age=service.settings.ttl_seconds, path='/', secure=True,
                        httponly=True, samesite=service.settings.same_site)
    response.headers['Cache-Control'] = 'no-store'
    return profile


@router.get('/auth/session')
def session(response: Response, profile=Depends(require_administrator)):
    response.headers['Cache-Control'] = 'no-store'
    return profile


@router.post('/auth/logout', status_code=204)
def logout(request: Request):
    mutation_origin(request)
    service = request.app.state.auth_service
    service.logout(request.cookies.get(COOKIE))
    response = Response(status_code=204, headers={'Cache-Control': 'no-store'})
    clear_session_cookie(response, service.settings)
    return response
