"""公开文档分享路由：无需鉴权，通过 share_token 只读访问单个文档。"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.database import get_session
from app.models import Document
from app.services.render import wrap_html_for_srcdoc
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
    return {
        "document": {
            "id": doc.id, "title": doc.title, "ext": doc.ext,
            "size": doc.size, "created_at": doc.created_at,
        },
        "ext": doc.ext, "content": content,
    }
