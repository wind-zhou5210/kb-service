"""文件（Document）路由：上传、查看原文、下载、CRUD。"""
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import quote

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

    # 预查当前集合中所有文档的 content_sha1，用于去重
    existing_rows = (await session.execute(
        select(Document.content_sha1).where(Document.collection_id == col_id)
    )).all()
    existing_sha1s: set[str] = {row[0] for row in existing_rows}

    created = []
    duplicated: list[str] = []
    file_data_list: list[tuple[bytes, str]] = []
    seen_in_batch: set[str] = set()  # 同一批次内的 SHA1 去重

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

        # 去重检测：同批次内重复 或 集合中已存在相同内容的文档
        if sha1 in seen_in_batch or sha1 in existing_sha1s:
            duplicated.append(f.filename or "")
            continue

        seen_in_batch.add(sha1)

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

    # 全部文件均为重复内容
    if not created and duplicated:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"以下文件内容与集合中已有文件重复，已跳过: {', '.join(duplicated)}",
        )

    if created:
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

    return UploadResult(
        created=created,
        duplicated=duplicated,
    )


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
    encoded_filename = quote(doc.filename)
    return Response(
        content=data,
        media_type=media,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
        },
    )


class UploadResult(BaseModel):
    created: list  # list of Document — 实际新增的文档
    duplicated: list[str]  # 因内容重复被跳过的文件名列表


class DocumentUpdate(BaseModel):
    title: str | None = None
    tags: str | None = None
    note: str | None = None
    sort_order: int | None = None


class DocumentMove(BaseModel):
    collection_id: int


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
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(doc, k, v)
    doc.updated_at = datetime.now(timezone.utc)

    if "title" in updates:
        await session.execute(
            text("UPDATE fts_index SET title = :title WHERE document_id = :doc_id"),
            {"title": doc.title, "doc_id": doc_id},
        )

    await session.commit()
    await session.refresh(doc)
    return doc


@router.post("/documents/{doc_id}/move")
async def move_document(
    doc_id: int,
    body: DocumentMove,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")

    if doc.collection_id == body.collection_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "已在当前集合中")

    target_col = await session.get(Collection, body.collection_id)
    if not target_col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "目标集合不存在")

    old_col_id = doc.collection_id
    old_col = await session.get(Collection, old_col_id)

    # 更新归属
    doc.collection_id = body.collection_id
    doc.updated_at = datetime.now(timezone.utc)
    session.add(doc)

    # 更新新旧集合时间戳
    now = datetime.now(timezone.utc)
    if old_col:
        old_col.updated_at = now
        session.add(old_col)
    target_col.updated_at = now
    session.add(target_col)

    await session.commit()
    await session.refresh(doc)

    # 更新 FTS 索引中的集合名
    await session.execute(
        text("UPDATE fts_index SET collection_name = :name WHERE document_id = :doc_id"),
        {"name": target_col.name, "doc_id": doc_id},
    )
    await session.commit()

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


@router.post("/documents/{doc_id}/share")
async def create_doc_share(
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """生成（或复用）单个文档的只读分享令牌。需鉴权。"""
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    if not doc.share_token:
        doc.share_token = secrets.token_urlsafe(16)
        session.add(doc)
        await session.commit()
    return {"share_token": doc.share_token}


@router.delete("/documents/{doc_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_doc_share(
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """撤销单个文档的分享令牌。需鉴权。"""
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    doc.share_token = None
    session.add(doc)
    await session.commit()
