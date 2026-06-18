"""公开分享路由：无需鉴权，通过 share_token 只读访问集合。"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.database import get_session
from app.models import Collection, Document

router = APIRouter(prefix="/share", tags=["share"])


@router.get("/{token}")
async def get_shared_collection(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    col = (await session.execute(
        select(Collection).where(Collection.share_token == token)
    )).scalars().first()
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")
    docs = (await session.execute(
        select(Document).where(Document.collection_id == col.id)
        .order_by(Document.sort_order, Document.created_at.desc())
    )).scalars().all()
    return {"collection": col, "documents": docs}
