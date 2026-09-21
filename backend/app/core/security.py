"""鉴权：JWT 签发与校验、密码哈希、FastAPI 依赖。"""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Query, Response, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_prefix}/auth/login")

# 浏览器会话 cookie 名：用于浏览器自动发起的同源请求
# （iframe 内子资源 CSS/JS/图片、window.open 同源下载——它们无法携带 Authorization header 或 ?jwt=）
SESSION_COOKIE = "kb_sess"


def set_session_cookie(response: Response, token: str) -> None:
    """种下会话 cookie（httpOnly 防脚本读取，SameSite=Lax 限制跨站携带）。"""
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=settings.jwt_expire_minutes * 60,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def _decode_subject(token: str | None) -> str | None:
    """解析 JWT 取 sub；无效/过期返回 None。"""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload.get("sub")
    except JWTError:
        return None


def _token_from(bearer: str | None, jwt_query: str | None, cookie: str | None) -> str | None:
    """按优先级提取凭据：Authorization header > ?jwt= > 会话 cookie。"""
    if bearer and bearer.startswith("Bearer "):
        return bearer[7:]
    return jwt_query or cookie or None


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    subject = _decode_subject(token)
    if subject is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的认证凭据",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return subject


# 共享依赖类型，路由里直接用
CurrentUser = Annotated[str, Depends(get_current_user)]


async def get_current_user_from_query(
    token: str | None = Query(None, alias="jwt"),
    authorization: str | None = Header(None, alias="Authorization"),
) -> str:
    """兼容 iframe src 中通过 ?jwt=xxx 传递的 token（iframe 内无法发送 Authorization header）。"""
    subject = _decode_subject(_token_from(authorization, token, None))
    if subject is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的认证凭据")
    return subject


CurrentUserFromQuery = Annotated[str, Depends(get_current_user_from_query)]


async def get_current_user_from_any(
    authorization: Annotated[str | None, Header()] = None,
    token: Annotated[str | None, Query(alias="jwt")] = None,
    kb_sess: Annotated[str | None, Cookie()] = None,
) -> str:
    """统一鉴权依赖：Bearer / ?jwt= / 会话 cookie 三者任一有效即可。

    cookie 通道专为浏览器自动发起的同源请求设计：
    - iframe 内的子资源（CSS/JS/图片）请求
    - window.open 打开的同源下载链接
    这两类请求无法携带 Authorization header，也无法在 URL 上带 ?jwt=。
    """
    subject = _decode_subject(_token_from(authorization, token, kb_sess))
    if subject is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或登录已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return subject


CurrentUserFromAny = Annotated[str, Depends(get_current_user_from_any)]


async def get_current_user_optional(
    token: str | None = Query(None, alias="jwt"),
    authorization: str | None = Header(None, alias="Authorization"),
    kb_sess: str | None = Cookie(None),
) -> str | None:
    """可选鉴权：任一凭据有效则返回用户名，否则 None（不抛异常）。"""
    return _decode_subject(_token_from(authorization, token, kb_sess))


CurrentUserOptional = Annotated[str | None, Depends(get_current_user_optional)]
