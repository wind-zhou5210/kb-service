"""公开分享路由：无需鉴权，通过 share_token 只读访问集合。"""
import io
import zipfile
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.database import get_session
from app.models import Collection, Document
from app.storage import storage

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


@router.get("/{token}/download")
async def download_shared_collection(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """通过分享令牌下载集合内所有文档（ZIP 打包）。"""
    col = (await session.execute(
        select(Collection).where(Collection.share_token == token)
    )).scalars().first()
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")

    docs = (await session.execute(
        select(Document).where(Document.collection_id == col.id).order_by(Document.sort_order, Document.created_at)
    )).scalars().all()
    if not docs:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "集合内暂无文件")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            data = await storage.read(doc.content_sha1)
            zf.writestr(doc.filename, data)
    buf.seek(0)

    encoded_name = quote(f"{col.name}.zip")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"
        },
    )


@router.get("/{token}/download/{doc_id}")
async def download_doc_from_shared_collection(
    token: str,
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """通过分享令牌下载集合内的单个文档。"""
    col = (await session.execute(
        select(Collection).where(Collection.share_token == token)
    )).scalars().first()
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")

    doc = (await session.execute(
        select(Document).where(Document.id == doc_id, Document.collection_id == col.id)
    )).scalars().first()
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")

    data = await storage.read(doc.content_sha1)
    media = "text/markdown" if doc.ext == ".md" else "text/html"
    encoded_filename = quote(doc.filename)
    return Response(
        content=data,
        media_type=media,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
        },
    )
