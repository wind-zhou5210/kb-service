"""知识集合（Collection）路由。"""
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.database import get_session
from app.core.security import CurrentUser
from app.models import Collection, Document

router = APIRouter(prefix="/collections", tags=["collections"])


class CollectionCreate(BaseModel):
    name: str
    description: str | None = None
    cover: str | None = None


class CollectionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    cover: str | None = None
    sort_order: int | None = None


@router.get("")
async def list_collections(
    session: Annotated[AsyncSession, Depends(get_session)],
):
    stmt = (
        select(Collection, func.count(Document.id).label("doc_count"))
        .outerjoin(Document, Document.collection_id == Collection.id)
        .group_by(Collection.id)
        .order_by(Collection.sort_order, Collection.created_at.desc())
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [{**col.model_dump(), "doc_count": count} for col, count in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_collection(
    body: CollectionCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    col = Collection(name=body.name, description=body.description, cover=body.cover)
    session.add(col)
    await session.commit()
    await session.refresh(col)
    return col


@router.patch("/{col_id}")
async def update_collection(
    col_id: int,
    body: CollectionUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    col = await session.get(Collection, col_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "集合不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(col, k, v)
    col.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(col)
    return col


@router.delete("/{col_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(
    col_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    col = await session.get(Collection, col_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "集合不存在")
    # 级联：删除集合下的文档（逻辑层），物理文件由引用计数处理
    docs = (await session.execute(
        select(Document).where(Document.collection_id == col_id)
    )).scalars().all()
    for d in docs:
        await session.delete(d)
    await session.delete(col)
    await session.commit()


@router.post("/{col_id}/share")
async def create_share_token(
    col_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    col = await session.get(Collection, col_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "集合不存在")
    if not col.share_token:
        col.share_token = secrets.token_urlsafe(16)
        await session.commit()
        await session.refresh(col)
    return {"share_token": col.share_token}


@router.delete("/{col_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share_token(
    col_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    col = await session.get(Collection, col_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "集合不存在")
    col.share_token = None
    await session.commit()
