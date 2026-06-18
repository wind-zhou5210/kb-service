"""文件（Document）路由：上传、查看原文、下载、CRUD。"""
import os
import re
from datetime import datetime, timezone
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config import settings
from app.core.database import get_session
from app.core.security import CurrentUser
from app.models import Collection, Document, FileBlob
from app.services.render import wrap_html_for_srcdoc
from app.storage import storage

router = APIRouter(tags=["documents"])

ALLOWED = {e.lower() for e in settings.allowed_exts}


def _ext(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


def _extract_text(data: bytes, ext: str) -> str:
    """从文件内容提取纯文本用于 FTS 索引。HTML 去标签，Markdown 原样使用。"""
    raw = data.decode("utf-8", errors="replace")
    if ext in ('.html', '.htm'):
        raw = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', raw, flags=re.DOTALL | re.IGNORECASE)
        raw = re.sub(r'<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', raw).strip()


@router.get("/collections/{col_id}/documents")
async def list_documents(
    col_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    stmt = select(Document).where(Document.collection_id == col_id).order_by(
        Document.sort_order, Document.created_at.desc()
    )
    return (await session.execute(stmt)).scalars().all()


@router.post("/collections/{col_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    col_id: int,
    files: Annotated[list[UploadFile], File(...)],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    col = await session.get(Collection, col_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "集合不存在")

    created = []
    file_data_list: list[tuple[bytes, str]] = []
    for f in files:
        ext = _ext(f.filename or "")
        if ext not in ALLOWED:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"不支持的文件类型: {f.filename}（仅支持 {', '.join(settings.allowed_exts)}）",
            )
        data = await f.read()
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"文件过大: {f.filename}（上限 {settings.max_upload_mb}MB）",
            )

        sha1, size = await storage.save(data, ext)

        # FileBlob 去重：存在则引用计数 +1
        blob = await session.get(FileBlob, sha1)
        if blob:
            blob.ref_count += 1
        else:
            blob = FileBlob(sha1=sha1, ext=ext, size=size, ref_count=1)
            session.add(blob)

        doc = Document(
            collection_id=col_id,
            title=os.path.splitext(f.filename)[0],
            filename=f.filename,
            ext=ext,
            content_sha1=sha1,
            size=size,
        )
        session.add(doc)
        created.append(doc)
        file_data_list.append((data, ext))

    col.updated_at = datetime.now(timezone.utc)
    await session.commit()
    for d in created:
        await session.refresh(d)

    # 同步 FTS 索引
    for d, (fdata, fext) in zip(created, file_data_list):
        body_text = _extract_text(fdata, fext)
        await session.execute(text(
            "INSERT INTO fts_index (document_id, title, collection_name, body_text) "
            "VALUES (:doc_id, :title, :col_name, :body)"
        ), {"doc_id": d.id, "title": d.title, "col_name": col.name, "body": body_text})
    await session.commit()

    return created


@router.get("/documents/{doc_id}")
async def get_document(
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    return doc


@router.get("/documents/{doc_id}/raw")
async def get_raw(
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    format: Annotated[str | None, Query()] = None,  # html 时返回包装后的 srcdoc 内容
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    data = await storage.read(doc.content_sha1)
    text = data.decode("utf-8", errors="replace")

    if doc.ext == ".html" or doc.ext == ".htm" or format == "html":
        wrapped = wrap_html_for_srcdoc(text)
        return PlainTextResponse(wrapped, media_type="text/plain; charset=utf-8")
    return PlainTextResponse(text, media_type="text/plain; charset=utf-8")


@router.get("/documents/{doc_id}/download")
async def download_document(
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    data = await storage.read(doc.content_sha1)
    media = "text/markdown" if doc.ext == ".md" else "text/html"
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{doc.filename}"'},
    )


class DocumentUpdate(BaseModel):
    title: str | None = None
    tags: str | None = None
    note: str | None = None
    sort_order: int | None = None


@router.patch("/documents/{doc_id}")
async def update_document(
    doc_id: int,
    body: DocumentUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(doc, k, v)
    await session.commit()
    await session.refresh(doc)
    return doc


@router.delete("/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    sha1 = doc.content_sha1
    col_id = doc.collection_id

    # 清理 FTS 索引
    await session.execute(text("DELETE FROM fts_index WHERE document_id = :doc_id"), {"doc_id": doc_id})

    await session.delete(doc)

    # 引用计数 -1，归零删物理文件
    blob = await session.get(FileBlob, sha1)
    if blob:
        blob.ref_count -= 1
        if blob.ref_count <= 0:
            await session.delete(blob)
            await storage.delete(sha1)

    col = await session.get(Collection, col_id)
    if col:
        col.updated_at = datetime.now(timezone.utc)
    await session.commit()
