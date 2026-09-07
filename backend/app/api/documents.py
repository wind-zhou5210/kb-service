"""文件（Document）路由：上传、查看原文、下载、CRUD。"""
import io
import mimetypes
import os
import re
import secrets
import zipfile
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
from sqlmodel import func, select

from app.core.config import settings
from app.core.database import get_session
from app.core.security import CurrentUser, CurrentUserFromQuery
from app.models import Collection, Document, DocumentAsset, DocumentVersion, FileBlob
from app.services.render import rewrite_md_images, wrap_html_for_srcdoc
from app.storage import storage

router = APIRouter(tags=["documents"])

ALLOWED = {e.lower() for e in settings.allowed_exts}
PACKAGE_DOC_EXTS = {".md", ".html", ".htm"}
ASSET_EXTS = {e.lower() for e in settings.package_asset_exts}


def _ext(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


def _extract_text(data: bytes, ext: str) -> str:
    """从文件内容提取纯文本用于 FTS 索引。HTML 去标签，Markdown 原样使用。"""
    raw = data.decode("utf-8", errors="replace")
    if ext in ('.html', '.htm'):
        raw = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', raw, flags=re.DOTALL | re.IGNORECASE)
        raw = re.sub(r'<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', raw).strip()


def _package_skip(name: str) -> bool:
    """跳过包内隐藏文件/目录与 node_modules（与工作空间规则一致）。"""
    parts = name.replace("\\", "/").split("/")
    return any(p.startswith(".") or p == "node_modules" for p in parts)


async def _has_assets(session: AsyncSession, doc_id: int) -> bool:
    """文档是否挂有资产（有则 md serve 时才做图片重写，避免对旧文档行为变化）。"""
    row = (await session.execute(
        select(DocumentAsset.id).where(DocumentAsset.document_id == doc_id).limit(1)
    )).first()
    return row is not None


async def _set_document_assets(
    session: AsyncSession,
    doc_id: int,
    asset_specs: list[tuple[str, str, int, str]],
) -> None:
    """替换文档资产集：释放旧行与 blob 引用，插入新行并加引用。

    asset_specs: [(包内相对路径, sha1, size, mime)]。新旧交集的 sha1 不删物理文件。
    """
    new_sha1s = {s[1] for s in asset_specs}
    blob_cache: dict[str, FileBlob] = {}
    old = (await session.execute(
        select(DocumentAsset).where(DocumentAsset.document_id == doc_id)
    )).scalars().all()
    for row in old:
        blob = await session.get(FileBlob, row.sha1)
        if blob:
            blob.ref_count -= 1
            if blob.ref_count <= 0 and row.sha1 not in new_sha1s:
                await session.delete(blob)
                await storage.delete(row.sha1)
        await session.delete(row)
    # 先 flush 删除：SQLAlchemy 默认 inserts 先于 deletes，
    # 不 flush 则同键新行 INSERT 与 pending 旧行冲突（UNIQUE 约束）
    if old:
        await session.flush()
    for path, sha1, size, mime in asset_specs:
        blob = blob_cache.get(sha1)
        if blob is None:
            blob = await session.get(FileBlob, sha1)
        if blob:
            blob.ref_count += 1
        else:
            blob = FileBlob(sha1=sha1, ext=os.path.splitext(path)[1].lower(), size=size, ref_count=1)
            session.add(blob)
        # 同批次同 sha1 的 pending 行 session.get 取不到，需内存缓存避免重复 INSERT
        blob_cache[sha1] = blob
        session.add(DocumentAsset(
            document_id=doc_id, path=path, sha1=sha1, size=size, mime_type=mime,
        ))


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
    mode: Annotated[str, Query()] = "append",
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
    updated = []
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

        # Overwrite 模式：按 (collection_id, filename) 查找现有文档
        existing_doc: Document | None = None
        if mode == "overwrite":
            existing_doc = (await session.execute(
                select(Document).where(
                    Document.collection_id == col_id,
                    Document.filename == f.filename,
                )
            )).scalars().first()

        if existing_doc and mode == "overwrite":
            # 内容完全相同则跳过
            if existing_doc.content_sha1 == sha1:
                duplicated.append(f.filename or "")
                continue

            # 创建版本快照：记录当前内容
            max_ver = (await session.execute(
                select(func.coalesce(func.max(DocumentVersion.version), 0)).where(
                    DocumentVersion.document_id == existing_doc.id
                )
            )).scalar()
            old_ver = DocumentVersion(
                document_id=existing_doc.id,
                version=max_ver + 1,
                content_sha1=existing_doc.content_sha1,
                filename=existing_doc.filename,
                ext=existing_doc.ext,
                size=existing_doc.size,
            )
            session.add(old_ver)

            # 旧 blob 引用转移：文档原持有的一份引用转归版本行，不重复 +1
            # 新 blob 引用
            blob = await session.get(FileBlob, sha1)
            if blob:
                blob.ref_count += 1
            else:
                blob = FileBlob(sha1=sha1, ext=ext, size=size, ref_count=1)
                session.add(blob)

            # 更新 Document
            existing_doc.content_sha1 = sha1
            existing_doc.size = size
            existing_doc.ext = ext
            existing_doc.current_version += 1
            existing_doc.updated_at = datetime.now(timezone.utc)
            session.add(existing_doc)
            updated.append(existing_doc)
            file_data_list.append((data, ext))
        else:
            # 原有 append 逻辑
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

    # 全部文件均为重复内容（既没有新增也没有覆盖更新）
    if not created and not updated and duplicated:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"以下文件内容与集合中已有文件重复，已跳过: {', '.join(duplicated)}",
        )

    if created or updated:
        col.updated_at = datetime.now(timezone.utc)
        await session.commit()
        for d in created:
            await session.refresh(d)
        for d in updated:
            await session.refresh(d)

        # 同步 FTS 索引
        fts_data = list(zip(created, file_data_list[:len(created)]))
        fts_data += list(zip(updated, file_data_list[len(created):]))
        for d, (fdata, fext) in fts_data:
            body_text = _extract_text(fdata, fext)
            if d in updated:
                await session.execute(
                    text("DELETE FROM fts_index WHERE document_id = :doc_id"),
                    {"doc_id": d.id},
                )
            await session.execute(text(
                "INSERT INTO fts_index (document_id, title, collection_name, body_text) "
                "VALUES (:doc_id, :title, :col_name, :body)"
            ), {"doc_id": d.id, "title": d.title, "col_name": col.name, "body": body_text})
        await session.commit()

    return UploadResult(
        created=created,
        updated=updated,
        duplicated=duplicated,
    )


@router.post("/collections/{col_id}/documents/package", status_code=status.HTTP_201_CREATED)
async def upload_document_package(
    col_id: int,
    file: Annotated[UploadFile, File(...)],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
    mode: Annotated[str, Query()] = "append",
):
    """上传文档包（zip：md/html 入口 + 图片资产）。

    每个 md/html 入口各建一个 Document；包内全部图片资产挂到每个文档下
    （path 为包内相对路径），md 相对图片引用在 serve 期重写为资产端点。
    """
    col = await session.get(Collection, col_id)
    if not col:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "集合不存在")

    data = await file.read()
    if len(data) > settings.package_max_upload_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"包过大（上限 {settings.package_max_upload_mb}MB）",
        )
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不是有效的 zip 文件")

    # zip 炸弹防护：解压前校验累计未压缩大小
    if sum(i.file_size for i in zf.infolist()) > settings.package_max_upload_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"包解压后大小超限（上限 {settings.package_max_upload_mb}MB）",
        )

    doc_entries: list[tuple[str, bytes]] = []
    asset_specs: list[tuple[str, str, int, str]] = []
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            norm = os.path.normpath(info.filename)
            if norm.startswith("..") or os.path.isabs(norm) or _package_skip(norm):
                continue
            path = norm.replace("\\", "/")
            ext = os.path.splitext(path)[1].lower()
            if ext in PACKAGE_DOC_EXTS:
                doc_entries.append((path, zf.read(info)))
            elif ext in ASSET_EXTS:
                content = zf.read(info)
                sha1, size = await storage.save(content, ext)
                mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
                asset_specs.append((path, sha1, size, mime))
    if not doc_entries:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "包内未找到 markdown/html 文档条目"
        )

    # 预查集合内已有文档 sha1 用于去重
    existing_rows = (await session.execute(
        select(Document.content_sha1).where(Document.collection_id == col_id)
    )).all()
    existing_sha1s: set[str] = {row[0] for row in existing_rows}

    created: list[Document] = []
    updated: list[Document] = []
    duplicated: list[str] = []
    seen_in_batch: set[str] = set()
    file_data_list: list[tuple[bytes, str]] = []

    for path, content in doc_entries:
        ext = os.path.splitext(path)[1].lower()
        filename = os.path.basename(path)
        source_dir = os.path.dirname(path)
        sha1, size = await storage.save(content, ext)

        if sha1 in seen_in_batch or sha1 in existing_sha1s:
            duplicated.append(filename)
            continue
        seen_in_batch.add(sha1)

        existing_doc: Document | None = None
        if mode == "overwrite":
            existing_doc = (await session.execute(
                select(Document).where(
                    Document.collection_id == col_id,
                    Document.filename == filename,
                )
            )).scalars().first()

        if existing_doc and mode == "overwrite":
            if existing_doc.content_sha1 == sha1:
                duplicated.append(filename)
                continue
            # 版本快照 + blob 引用（与单文件 overwrite 语义一致）
            max_ver = (await session.execute(
                select(func.coalesce(func.max(DocumentVersion.version), 0)).where(
                    DocumentVersion.document_id == existing_doc.id
                )
            )).scalar()
            session.add(DocumentVersion(
                document_id=existing_doc.id,
                version=max_ver + 1,
                content_sha1=existing_doc.content_sha1,
                filename=existing_doc.filename,
                ext=existing_doc.ext,
                size=existing_doc.size,
            ))
            # 旧 blob 引用转移：文档原持有的一份引用转归版本行，不重复 +1
            blob = await session.get(FileBlob, sha1)
            if blob:
                blob.ref_count += 1
            else:
                session.add(FileBlob(sha1=sha1, ext=ext, size=size, ref_count=1))
            existing_doc.content_sha1 = sha1
            existing_doc.size = size
            existing_doc.ext = ext
            existing_doc.source_dir = source_dir
            existing_doc.current_version += 1
            existing_doc.updated_at = datetime.now(timezone.utc)
            session.add(existing_doc)
            await _set_document_assets(session, existing_doc.id, asset_specs)
            updated.append(existing_doc)
            file_data_list.append((content, ext))
        else:
            blob = await session.get(FileBlob, sha1)
            if blob:
                blob.ref_count += 1
            else:
                session.add(FileBlob(sha1=sha1, ext=ext, size=size, ref_count=1))
            doc = Document(
                collection_id=col_id,
                title=os.path.splitext(filename)[0],
                filename=filename,
                ext=ext,
                content_sha1=sha1,
                size=size,
                source_dir=source_dir,
            )
            session.add(doc)
            await session.flush()  # 取 doc.id 写资产行
            await _set_document_assets(session, doc.id, asset_specs)
            created.append(doc)
            file_data_list.append((content, ext))

    if not created and not updated and duplicated:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"以下文件内容与集合中已有文件重复，已跳过: {', '.join(duplicated)}",
        )

    if created or updated:
        col.updated_at = datetime.now(timezone.utc)
        await session.commit()
        for d in created:
            await session.refresh(d)
        for d in updated:
            await session.refresh(d)

        fts_data = list(zip(created, file_data_list[:len(created)]))
        fts_data += list(zip(updated, file_data_list[len(created):]))
        for d, (fdata, fext) in fts_data:
            body_text = _extract_text(fdata, fext)
            if d in updated:
                await session.execute(
                    text("DELETE FROM fts_index WHERE document_id = :doc_id"),
                    {"doc_id": d.id},
                )
            await session.execute(text(
                "INSERT INTO fts_index (document_id, title, collection_name, body_text) "
                "VALUES (:doc_id, :title, :col_name, :body)"
            ), {"doc_id": d.id, "title": d.title, "col_name": col.name, "body": body_text})
        await session.commit()

    return UploadResult(
        created=created,
        updated=updated,
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

    # 文档包图片：md 挂有资产时将相对图片重写为资产端点（前端 img 追加 ?jwt= 鉴权）
    if doc.ext == ".md" and await _has_assets(session, doc.id):
        text = rewrite_md_images(text, f"/api/documents/{doc.id}/assets/", doc.source_dir or "")

    if doc.ext == ".html" or doc.ext == ".htm" or format == "html":
        wrapped = wrap_html_for_srcdoc(text)
        return PlainTextResponse(wrapped, media_type="text/plain; charset=utf-8")
    return PlainTextResponse(text, media_type="text/plain; charset=utf-8")


@router.get("/documents/{doc_id}/assets/{path:path}")
async def get_document_asset(
    doc_id: int,
    path: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    _user: CurrentUserFromQuery,
):
    """serve 文档包图片资产。Authorization header 或 ?jwt= query（<img> 用后者）。"""
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    norm = os.path.normpath(path).replace("\\", "/")
    if norm.startswith("..") or os.path.isabs(norm):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法路径")
    row = (await session.execute(
        select(DocumentAsset).where(
            DocumentAsset.document_id == doc_id,
            DocumentAsset.path == norm,
        )
    )).scalars().first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "资产不存在")
    data = await storage.read(row.sha1, ext=os.path.splitext(norm)[1].lower())
    return Response(content=data, media_type=row.mime_type)


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
    updated: list  # list of Document — 被覆盖更新的文档
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

    # 释放文档包资产（行 + blob 引用）
    assets = (await session.execute(
        select(DocumentAsset).where(DocumentAsset.document_id == doc_id)
    )).scalars().all()
    for a in assets:
        blob = await session.get(FileBlob, a.sha1)
        if blob:
            blob.ref_count -= 1
            if blob.ref_count <= 0:
                await session.delete(blob)
                await storage.delete(a.sha1)
        await session.delete(a)

    # 查询所有版本（含当前内容 sha1）
    versions = (await session.execute(
        select(DocumentVersion).where(DocumentVersion.document_id == doc_id)
    )).scalars().all()

    # 收集所有 blob sha1，去重后统一释放 ref_count
    all_sha1s = {sha1}  # 当前内容
    for v in versions:
        all_sha1s.add(v.content_sha1)

    # 删除所有版本
    for v in versions:
        await session.delete(v)

    # 删除文档
    await session.delete(doc)

    # 逐个释放 ref_count 并清理物理文件
    for s in all_sha1s:
        blob = await session.get(FileBlob, s)
        if blob:
            count = 1 if s == sha1 else 0
            count += sum(1 for v in versions if v.content_sha1 == s)
            blob.ref_count -= count
            if blob.ref_count <= 0:
                await session.delete(blob)
                await storage.delete(s)

    col = await session.get(Collection, col_id)
    if col:
        col.updated_at = datetime.now(timezone.utc)
    await session.commit()


@router.get("/documents/{doc_id}/versions")
async def list_versions(
    doc_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    stmt = select(DocumentVersion).where(
        DocumentVersion.document_id == doc_id
    ).order_by(DocumentVersion.version.desc())
    return (await session.execute(stmt)).scalars().all()


@router.get("/documents/{doc_id}/versions/{version}")
async def get_version(
    doc_id: int,
    version: int,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    ver = (await session.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == doc_id,
            DocumentVersion.version == version,
        )
    )).scalars().first()
    if not ver:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")
    data = await storage.read(ver.content_sha1)
    content = data.decode("utf-8", errors="replace")
    # 历史版本图片按当前资产解析（best-effort）
    if ver.ext == ".md" and await _has_assets(session, doc_id):
        content = rewrite_md_images(content, f"/api/documents/{doc_id}/assets/", doc.source_dir or "")
    return {
        "version": ver,
        "content": content,
    }


@router.post("/documents/{doc_id}/versions/{version}/restore")
async def restore_version(
    doc_id: int,
    version: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")

    target = (await session.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == doc_id,
            DocumentVersion.version == version,
        )
    )).scalars().first()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")

    # 先保存当前内容为新版本
    max_ver = (await session.execute(
        select(func.coalesce(func.max(DocumentVersion.version), 0)).where(
            DocumentVersion.document_id == doc_id
        )
    )).scalar()
    new_ver = DocumentVersion(
        document_id=doc_id,
        version=max_ver + 1,
        content_sha1=doc.content_sha1,
        filename=doc.filename,
        ext=doc.ext,
        size=doc.size,
    )
    session.add(new_ver)

    # 旧 blob 引用转移：文档原持有的一份引用转归新版本行，不重复 +1
    # 目标版本 blob ref_count++（Document 重新引用它）
    target_blob = await session.get(FileBlob, target.content_sha1)
    if target_blob:
        target_blob.ref_count += 1

    # 更新 Document
    doc.content_sha1 = target.content_sha1
    doc.size = target.size
    doc.ext = target.ext
    doc.current_version += 1
    doc.updated_at = datetime.now(timezone.utc)
    session.add(doc)

    # 更新 FTS 索引
    data = await storage.read(target.content_sha1)
    body_text = _extract_text(data, target.ext)
    await session.execute(
        text("DELETE FROM fts_index WHERE document_id = :doc_id"),
        {"doc_id": doc_id},
    )
    col = await session.get(Collection, doc.collection_id)
    col_name = col.name if col else ""
    await session.execute(
        text("INSERT INTO fts_index (document_id, title, collection_name, body_text) "
             "VALUES (:doc_id, :title, :col_name, :body)"),
        {"doc_id": doc_id, "title": doc.title, "col_name": col_name, "body": body_text},
    )

    await session.commit()
    await session.refresh(doc)
    return doc


@router.delete("/documents/{doc_id}/versions/{version}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_version(
    doc_id: int,
    version: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    ver = (await session.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == doc_id,
            DocumentVersion.version == version,
        )
    )).scalars().first()
    if not ver:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")

    blob = await session.get(FileBlob, ver.content_sha1)
    if blob:
        blob.ref_count -= 1
        if blob.ref_count <= 0:
            await session.delete(blob)
            await storage.delete(ver.content_sha1)

    await session.delete(ver)
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
