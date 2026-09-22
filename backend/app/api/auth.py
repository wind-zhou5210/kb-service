"""鉴权路由：账号密码登录获取 JWT，以及 CLI 浏览器授权（授权码 + PKCE）。

MVP 使用配置文件中的单一管理员账号。CLI 授权端点复用同一凭据校验，
凭据本身不经过 URL：先由前端换取一次性授权码，再由 CLI 用 code + verifier 换取 JWT。
"""
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import cli_auth
from app.core.config import settings
from app.core.database import get_session
from app.core.security import (
    CurrentUser,
    clear_session_cookie,
    create_access_token,
    set_session_cookie,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
):
    if form.username != settings.admin_username or form.password != settings.admin_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(form.username)
    # 同时种下会话 cookie：iframe 子资源与同源下载等浏览器自动发起的请求需要它
    set_session_cookie(response, token)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/session", status_code=status.HTTP_204_NO_CONTENT)
async def establish_session(response: Response, user: CurrentUser):
    """基于当前 Bearer 凭据建立会话 cookie（幂等）。

    场景：升级前登录的用户本地有 token 但无 cookie。前端启动时静默调用一次补齐，
    否则工作空间 HTML 预览的 CSS/JS 子资源会因缺少凭据而 401。
    """
    set_session_cookie(response, create_access_token(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    """清除会话 cookie（前端同时清除本地 token）。"""
    clear_session_cookie(response)


class CliTokenRequest(BaseModel):
    """CLI 换取令牌的请求体（JSON）。"""

    code: str
    code_verifier: str


@router.post("/cli/authorize")
async def cli_authorize(
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    redirect_uri: Annotated[str, Form()],
    code_challenge: Annotated[str, Form()],
    state: Annotated[str, Form()],
):
    """CLI 浏览器授权：校验凭据与参数后签发一次性授权码。

    不直接 302，而是返回跳转地址由前端执行——这样凭据错误时可在页面内提示，
    而不是把用户甩到一个无法展示错误的回调地址上。
    """
    if not cli_auth.is_allowed_redirect_uri(redirect_uri):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="回调地址不被允许（仅支持本机回环地址）",
        )
    if not cli_auth.is_valid_challenge(code_challenge):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="code_challenge 格式不正确",
        )
    if not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="state 不能为空",
        )
    if username != settings.admin_username or password != settings.admin_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    code = cli_auth.issue_code(username, code_challenge, redirect_uri)
    separator = "&" if "?" in redirect_uri else "?"
    # 对 code 与 state 做百分号编码：state 由调用方生成，若含 # 或 & 会被浏览器
    # 当作 fragment/参数分隔符，导致回显被破坏、CLI 校验失败并静默等待超时
    return {
        "redirect": (
            f"{redirect_uri}{separator}code={quote(code)}&state={quote(state, safe='')}"
        )
    }


@router.post("/cli/token")
async def cli_token(payload: CliTokenRequest):
    """用授权码 + PKCE verifier 换取 JWT（授权码一次性，用过即废）。"""
    username = cli_auth.consume_code(payload.code, payload.code_verifier)
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="授权码无效、已使用或已过期，请重新执行 kb login",
        )
    return {
        "access_token": create_access_token(username),
        "token_type": "bearer",
        "username": username,
    }
