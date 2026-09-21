"""鉴权路由：登录获取 JWT。MVP 用配置文件里的单一管理员账号。"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

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
