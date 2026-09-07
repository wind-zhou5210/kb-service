"""公开文档分享路由：无需鉴权，通过 share_token 只读访问单个文档。"""
import os
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.database import get_session
from app.models import Document, DocumentAsset
from app.services.render import rewrite_md_images, wrap_html_for_srcdoc
from app.storage import storage

router = APIRouter(prefix="/share/doc", tags=["share"])


@router.get("/{token}")
async def get_shared_document(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """通过分享令牌只读访问单个文档，返回文档元信息 + 内容。"""
    doc = (await session.execute(
        select(Document).where(Document.share_token == token)
    )).scalars().first()
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")
    data = await storage.read(doc.content_sha1)
    text = data.decode("utf-8", errors="replace")
    if doc.ext in (".html", ".htm"):
        content = wrap_html_for_srcdoc(text)
    else:
        content = text
        # 文档包图片：md 挂有资产时重写为分享资产端点（token 即能力，免鉴权）
        if doc.ext == ".md":
            has_asset = (await session.execute(
                select(DocumentAsset.id).where(
                    DocumentAsset.document_id == doc.id
                ).limit(1)
            )).first()
            if has_asset:
                content = rewrite_md_images(
                    content, f"/api/share/doc/{token}/assets/", doc.source_dir or ""
                )
    return {
        "document": {
            "id": doc.id, "title": doc.title, "ext": doc.ext,
            "size": doc.size, "created_at": doc.created_at,
        },
        "ext": doc.ext, "content": content,
    }


@router.get("/{token}/assets/{path:path}")
async def get_shared_document_asset(
    token: str,
    path: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """分享态 serve 文档包图片资产（token 即能力，无需登录）。"""
    doc = (await session.execute(
        select(Document).where(Document.share_token == token)
    )).scalars().first()
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")
    norm = os.path.normpath(path).replace("\\", "/")
    if norm.startswith("..") or os.path.isabs(norm):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法路径")
    row = (await session.execute(
        select(DocumentAsset).where(
            DocumentAsset.document_id == doc.id,
            DocumentAsset.path == norm,
        )
    )).scalars().first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "资产不存在")
    data = await storage.read(row.sha1, ext=os.path.splitext(norm)[1].lower())
    return Response(content=data, media_type=row.mime_type)


@router.get("/{token}/download")
async def download_shared_document(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """通过分享令牌下载单个文档原始文件。"""
    doc = (await session.execute(
        select(Document).where(Document.share_token == token)
    )).scalars().first()
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")
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
