"""工作空间（Workspace）路由：隔离的文档目录管理。"""
import asyncio
import functools
import hashlib
import io
import logging
import mimetypes
import os
import re
import secrets
import shutil
import tempfile
import uuid
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
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from starlette.background import BackgroundTask

from app.core.config import settings
from app.core.database import get_session
from app.core.security import (
    CurrentUser,
    CurrentUserFromAny,
    CurrentUserFromQuery,
    CurrentUserOptional,
)
from app.models import Workspace, WorkspaceFile
from app.services.render import rewrite_md_images as _rewrite_md_images

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

logger = logging.getLogger(__name__)

# 工作空间写操作互斥（单 worker 进程内串行化；跨进程由 content_dir 乐观锁兜底）
_ws_locks: dict[int, asyncio.Lock] = {}


class ConflictError(Exception):
    """内容指针在本次操作期间被其他进程修改（乐观锁冲突）。"""


def _ws_lock(ws_id: int) -> asyncio.Lock:
    lock = _ws_locks.get(ws_id)
    if lock is None:
        lock = asyncio.Lock()
        _ws_locks[ws_id] = lock
    return lock


def _serialized_write(handler):
    """工作空间写操作串行化（与整包替换共用同一把锁）。

    单 worker 进程内互斥；FastAPI 通过 __wrapped__ 解析原函数签名，参数不受影响。
    """
    @functools.wraps(handler)
    async def wrapper(ws_id: int, *args, **kwargs):
        async with _ws_lock(ws_id):
            return await handler(ws_id, *args, **kwargs)
    return wrapper


def _content_root(ws: Workspace) -> str:
    """当前生效的内容根目录（整包替换的版本指针）。

    content_dir 为空 = 旧布局（内容直接在 storage_path 下，兼容存量数据）；
    非空 = 内容位于 storage_path/{content_dir}/（整包替换后的版本目录）。
    """
    if ws.content_dir:
        return os.path.join(ws.storage_path, ws.content_dir)
    return ws.storage_path


# ─── Pydantic models ───────────────────────────────────────────────

class WorkspaceCreate(BaseModel):
    name: str
    description: str | None = None


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


# ─── Helper functions ──────────────────────────────────────────────

def _safe_join(base: str, path: str) -> str:
    """防止路径穿越攻击。确保拼接后的路径仍在 base 目录下。"""
    base_norm = os.path.normpath(base)
    clean = path.lstrip("/\\")
    joined = os.path.normpath(os.path.join(base_norm, clean))
    if not joined.startswith(base_norm + os.sep) and joined != base_norm:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法路径")
    return joined


def _get_mime_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".md":
        return "text/markdown"
    if ext in (".html", ".htm"):
        return "text/html"
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


def _should_skip(name: str) -> bool:
    """跳过隐藏文件/目录和 node_modules。"""
    for part in name.replace("\\", "/").split("/"):
        if part.startswith(".") or part == "node_modules":
            return True
    return False


def _is_blocked_ext(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in settings.workspace_blocked_exts


def _sanitize_filename(name: str) -> str:
    """清理文件名中 Windows/Unix 非法字符（\\ / : * ? " < > | 及控制字符）。"""
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip()


def _fix_zip_filename(entry: zipfile.ZipInfo) -> str:
    """修正 zip 条目文件名中文乱码。

    zipfile 对未设置 UTF-8 标志位（0x800）的条目按 zip 规范用 cp437 解码，
    Windows 压缩工具打包的中文文件名（GBK 或未标记的 UTF-8）会因此变成乱码。
    此处还原 cp437 原始字节后依次尝试 UTF-8、GBK 解码。
    """
    if entry.flag_bits & 0x800:
        return entry.filename
    try:
        raw = entry.filename.encode("cp437")
    except UnicodeEncodeError:
        return entry.filename
    for enc in ("utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return entry.filename


def _build_tree(files: list[WorkspaceFile]) -> list[dict]:
    """将扁平的 WorkspaceFile 列表转换为嵌套目录树结构。"""
    tree: dict = {}
    for f in files:
        parts = f.path.replace("\\", "/").split("/")
        current = tree
        for i, part in enumerate(parts):
            is_last = i == len(parts) - 1
            if part not in current:
                if is_last:
                    current[part] = {
                        "name": part,
                        "type": "file",
                        "path": f.path,
                        "is_asset": f.is_asset,
                    }
                else:
                    current[part] = {"name": part, "type": "directory", "children": {}}
            if not is_last:
                current = current[part]["children"]

    def _dict_to_list(node):
        result = []
        for name, item in sorted(node.items()):
            if item["type"] == "directory":
                children = _dict_to_list(item["children"])
                result.append({"name": name, "type": "directory", "children": children})
            else:
                result.append(item)
        return result

    return _dict_to_list(tree)


# ─── Share endpoints (no auth, registered first to avoid path conflicts) ──

@router.get("/share/{token}")
async def get_shared_workspace(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """通过分享令牌获取工作空间信息（无需认证）。"""
    ws = (await session.execute(
        select(Workspace).where(Workspace.share_token == token)
    )).scalars().first()
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享不存在或已失效")
    stats = (await session.execute(
        select(
            func.count(WorkspaceFile.id).label("file_count"),
            func.coalesce(func.sum(WorkspaceFile.size), 0).label("total_size"),
        ).where(WorkspaceFile.workspace_id == ws.id)
    )).one()
    return {**ws.model_dump(), "file_count": stats[0], "total_size": stats[1]}


@router.get("/share/{token}/tree")
async def get_shared_tree(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """通过分享令牌获取工作空间目录树（无需认证）。"""
    ws = (await session.execute(
        select(Workspace).where(Workspace.share_token == token)
    )).scalars().first()
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享不存在或已失效")
    files = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws.id)
    )).scalars().all()
    return _build_tree(files)


@router.get("/share/{token}/serve/{path:path}")
async def serve_shared_file(
    token: str,
    path: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    render: str | None = Query(None),
):
    """通过分享令牌获取工作空间文件内容（无需认证）。"""
    ws = (await session.execute(
        select(Workspace).where(Workspace.share_token == token)
    )).scalars().first()
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享不存在或已失效")

    safe_path = _safe_join(_content_root(ws), path)
    if not os.path.isfile(safe_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")

    with open(safe_path, "rb") as f:
        content = f.read()

    mime_type = _get_mime_type(path)

    if path.lower().endswith(".md") and render == "md":
        text = content.decode("utf-8", errors="replace")
        file_dir = os.path.dirname(path)
        serve_prefix = f"/api/workspaces/share/{token}/serve/"
        text = _rewrite_md_images(text, serve_prefix, file_dir)
        content = text.encode("utf-8")

    # 内容可被整包替换或单文件更新：禁用缓存保证更新后立即生效
    # （HTML 内的相对引用无法携带版本参数，仅入口 URL 加 v 参数覆盖不到子资源）
    return Response(
        content=content,
        media_type=mime_type,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/share/{token}/download")
async def download_shared_workspace(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """通过分享令牌下载工作空间全部文件（ZIP 打包，无需认证）。"""
    ws = (await session.execute(
        select(Workspace).where(Workspace.share_token == token)
    )).scalars().first()
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享不存在或已失效")

    files = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws.id)
    )).scalars().all()
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "工作空间为空")

    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in files:
                disk_path = _safe_join(_content_root(ws), f.path)
                if not os.path.isfile(disk_path):
                    continue
                zf.write(disk_path, arcname=f.path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    download_name = _sanitize_filename(ws.name) or f"workspace-{ws.id}"
    encoded = quote(f"{download_name}.zip")
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
        background=BackgroundTask(os.unlink, tmp_path),
    )


# ─── Workspace CRUD ────────────────────────────────────────────────

@router.get("")
async def list_workspaces(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """列出所有工作空间，包含文件数和总大小。"""
    stmt = (
        select(
            Workspace,
            func.count(WorkspaceFile.id).label("file_count"),
            func.coalesce(func.sum(WorkspaceFile.size), 0).label("total_size"),
        )
        .outerjoin(WorkspaceFile, WorkspaceFile.workspace_id == Workspace.id)
        .group_by(Workspace.id)
        .order_by(Workspace.created_at.desc())
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [{**ws.model_dump(), "file_count": fc, "total_size": ts} for ws, fc, ts in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """创建新工作空间，同时创建磁盘目录。"""
    ws = Workspace(name=body.name, description=body.description, storage_path="")
    session.add(ws)
    await session.flush()
    # 用数据库分配的 ID 创建磁盘目录
    storage_path = str(settings.workspace_dir / str(ws.id))
    os.makedirs(storage_path, exist_ok=True)
    ws.storage_path = storage_path
    await session.commit()
    await session.refresh(ws)
    return ws


@router.get("/{ws_id}")
async def get_workspace(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """获取工作空间详情及统计。"""
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    stats = (await session.execute(
        select(
            func.count(WorkspaceFile.id).label("file_count"),
            func.coalesce(func.sum(WorkspaceFile.size), 0).label("total_size"),
        ).where(WorkspaceFile.workspace_id == ws_id)
    )).one()

    return {**ws.model_dump(), "file_count": stats[0], "total_size": stats[1]}


@router.patch("/{ws_id}")
async def update_workspace(
    ws_id: int,
    body: WorkspaceUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """更新工作空间名称/描述。"""
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ws, k, v)
    ws.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(ws)
    return ws


@router.delete("/{ws_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """删除工作空间：删除磁盘目录 + 数据库记录。"""
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    # 删除磁盘目录
    if os.path.isdir(ws.storage_path):
        shutil.rmtree(ws.storage_path)

    # 删除所有 workspace_file 记录
    files = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws_id)
    )).scalars().all()
    for f in files:
        await session.delete(f)

    # 删除 workspace
    await session.delete(ws)
    await session.commit()


# ─── Upload / Tree / Serve ─────────────────────────────────────────

def _extract_and_validate(data: bytes, dest_dir: str) -> list[dict]:
    """解压 zip 到 dest_dir 并逐条目校验，返回文件记录列表。

    校验失败抛 HTTPException（调用方负责清理暂存目录，线上内容不受影响）。
    - 目录与文件条目同规则：normpath 后拒绝 .. 与绝对路径
    - 跳过隐藏文件/目录、node_modules、禁止扩展名（沿用既有规则）
    - 条目数 ≤ workspace_max_entries；解压总量 ≤ workspace_max_extract_mb
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "压缩包损坏或不是有效的 zip 文件")

    records: list[dict] = []
    total_bytes = 0
    with zf:
        infos = zf.infolist()
        if len(infos) > settings.workspace_max_entries:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"压缩包条目过多（{len(infos)} 条，上限 {settings.workspace_max_entries}）",
            )
        for entry in infos:
            name = _fix_zip_filename(entry)
            rel = name.replace("\\", "/")
            norm = os.path.normpath(rel)
            # 路径安全：目录与文件条目同规则（修复旧实现目录条目绕过校验的问题）
            if norm in ("", ".") or norm.startswith("..") or os.path.isabs(norm):
                continue
            if _should_skip(rel):
                continue
            if entry.is_dir():
                os.makedirs(os.path.join(dest_dir, norm), exist_ok=True)
                continue
            if _is_blocked_ext(norm):
                continue

            content = zf.read(entry)
            total_bytes += len(content)
            if total_bytes > settings.workspace_max_extract_bytes:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    f"解压后总体积超限（上限 {settings.workspace_max_extract_mb}MB）",
                )
            full_path = os.path.join(dest_dir, norm)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "wb") as f:
                f.write(content)

            rel_norm = norm.replace("\\", "/")
            ext = os.path.splitext(rel_norm)[1].lower()
            records.append({
                "path": rel_norm,
                "sha1": hashlib.sha1(content).hexdigest(),
                "size": len(content),
                "mime_type": _get_mime_type(rel_norm),
                "is_asset": ext not in (".md", ".html", ".htm"),
            })
    return records


def _cleanup_old_content(storage_path: str, prev_content_dir: str | None, keep_dir: str) -> None:
    """提交成功后回收旧内容（尽力而为，失败仅记日志不影响请求）。

    prev_content_dir 为空（旧布局）时：清理根目录下散落的旧内容，
    保留新版本目录与 .staging；非空时：删除旧版本目录。
    """
    try:
        if prev_content_dir:
            shutil.rmtree(os.path.join(storage_path, prev_content_dir), ignore_errors=True)
            return
        for entry in os.listdir(storage_path):
            if entry in (keep_dir, ".staging"):
                continue
            p = os.path.join(storage_path, entry)
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                os.unlink(p)
    except OSError as exc:
        logger.warning("清理旧内容失败 storage_path=%s: %s", storage_path, exc)


def _cleanup_orphans(storage_path: str, current_dir: str | None) -> None:
    """惰性回收历史遗留的版本目录与暂存目录。

    孤儿产生于“rename 已就位但 DB 未提交”的进程崩溃场景；
    调用方必须持有该工作空间的写锁。
    """
    try:
        for entry in os.listdir(storage_path):
            if not entry.startswith("rev-") or entry == current_dir:
                continue
            shutil.rmtree(os.path.join(storage_path, entry), ignore_errors=True)
        staging_root = os.path.join(storage_path, ".staging")
        if os.path.isdir(staging_root):
            shutil.rmtree(staging_root, ignore_errors=True)
    except OSError as exc:
        logger.warning("回收孤儿内容目录失败 storage_path=%s: %s", storage_path, exc)


@router.post("/{ws_id}/upload", status_code=status.HTTP_201_CREATED)
async def upload_workspace_zip(
    ws_id: int,
    file: UploadFile,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """整包替换工作空间内容（安全版）。

    ZIP 作为完整新内容：同路径覆盖、新路径新增、包中缺失的旧文件删除；
    工作空间 ID / 名称 / 分享令牌保持不变。

    安全策略：内容先解压到 .staging 并全量校验，通过后才改名为版本目录；
    DB 提交是唯一发布点——任一环节失败都不影响当前线上内容。
    """
    lock = _ws_lock(ws_id)
    async with lock:
        ws = await session.get(Workspace, ws_id)
        if not ws:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
        baseline_dir = ws.content_dir  # 乐观锁基线

        data = await file.read()
        max_bytes = settings.workspace_max_upload_mb * 1024 * 1024
        if len(data) > max_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"文件过大（上限 {settings.workspace_max_upload_mb}MB）",
            )

        storage_path = ws.storage_path
        os.makedirs(storage_path, exist_ok=True)
        _cleanup_orphans(storage_path, ws.content_dir)

        # 1) 解压到暂存目录（线上内容完全不动）
        staging_dir = os.path.join(storage_path, ".staging", uuid.uuid4().hex)
        os.makedirs(staging_dir, exist_ok=True)
        try:
            records = _extract_and_validate(data, staging_dir)
        except BaseException:
            shutil.rmtree(staging_dir, ignore_errors=True)
            raise

        # 2) 有效文件数必须 > 0，避免空包/全跳过清空线上内容
        if not records:
            shutil.rmtree(staging_dir, ignore_errors=True)
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "压缩包内没有有效文件（全部被跳过或为空），已保留原内容",
            )

        # 3) 统计：按相对路径与 sha1 比对旧记录
        old_records = (await session.execute(
            select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws_id)
        )).scalars().all()
        old_sha = {r.path: r.sha1 for r in old_records}
        added = updated = unchanged = 0
        for r in records:
            prev = old_sha.get(r["path"])
            if prev is None:
                added += 1
            elif prev == r["sha1"]:
                unchanged += 1
            else:
                updated += 1
        new_paths = {r["path"] for r in records}
        removed = sum(1 for p in old_sha if p not in new_paths)

        # 4) 内容目录就位（同卷 rename；此时线上读路径仍指向旧目录）
        new_dir_name = f"rev-{uuid.uuid4().hex[:12]}"
        new_content_path = os.path.join(storage_path, new_dir_name)
        os.replace(staging_dir, new_content_path)

        # 5) DB 事务：content_dir 指针切换是唯一发布点
        try:
            # 乐观锁：确认指针未被其他进程改动（多 worker 场景兜底）
            current_pointer = (await session.execute(
                text("SELECT content_dir FROM workspace WHERE id = :i"), {"i": ws_id}
            )).scalar()
            if current_pointer != baseline_dir:
                raise ConflictError()

            for r in old_records:
                await session.delete(r)
            # 先 flush 删除：SQLAlchemy 默认 INSERT 先于 DELETE，
            # 不 flush 则同路径新行会撞唯一约束 uq_workspace_file
            if old_records:
                await session.flush()

            for r in records:
                session.add(WorkspaceFile(workspace_id=ws_id, **r))

            ws.content_dir = new_dir_name
            ws.updated_at = datetime.now(timezone.utc)
            await session.commit()
        except ConflictError:
            await session.rollback()
            shutil.rmtree(new_content_path, ignore_errors=True)
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "更新冲突：工作空间正被其他操作修改，请稍后重试",
            )
        except BaseException:
            await session.rollback()
            shutil.rmtree(new_content_path, ignore_errors=True)
            raise

        # 6) 提交成功后才回收旧内容（失败仅记日志）
        _cleanup_old_content(storage_path, baseline_dir, new_dir_name)

        return {
            "count": len(records),
            "added": added,
            "updated": updated,
            "removed": removed,
            "unchanged": unchanged,
        }


@router.post("/{ws_id}/files")
@_serialized_write
async def upsert_workspace_file(
    ws_id: int,
    file: UploadFile,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
    path: str = Query(...),
):
    """单文件上传/替换（增量更新）。

    按 path 定位工作空间内文件：不存在则新建，存在且内容变化则覆盖，
    sha1 相同则跳过写盘与 DB 更新。内容更新不影响分享链接（不修改 share_token）。
    """
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    content = await file.read()
    max_bytes = settings.workspace_max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"文件过大（上限 {settings.workspace_max_upload_mb}MB）",
        )

    # 路径校验：防穿越、跳过规则、禁止扩展名
    norm_path = os.path.normpath(path)
    if norm_path in ("", "."):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法路径")
    if norm_path.startswith("..") or os.path.isabs(norm_path):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法路径")
    if _should_skip(path) or _is_blocked_ext(path):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不允许的文件类型或路径")
    full_path = _safe_join(_content_root(ws), norm_path)

    # 统一存储路径与元数据
    rel_path = norm_path.replace("\\", "/")
    sha1 = hashlib.sha1(content).hexdigest()
    mime_type = _get_mime_type(rel_path)
    ext = os.path.splitext(rel_path)[1].lower()
    is_asset = ext not in (".md", ".html", ".htm")

    record = (await session.execute(
        select(WorkspaceFile).where(
            WorkspaceFile.workspace_id == ws_id,
            WorkspaceFile.path == rel_path,
        )
    )).scalars().first()

    if record and record.sha1 == sha1 and os.path.isfile(full_path):
        # 内容未变化且磁盘文件存在：不写盘、不更新 DB
        return {
            "status": "unchanged",
            "path": rel_path,
            "sha1": sha1,
            "size": len(content),
        }

    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "wb") as f:
        f.write(content)

    if record:
        record.sha1 = sha1
        record.size = len(content)
        record.mime_type = mime_type
        result_status = "updated"
    else:
        session.add(WorkspaceFile(
            workspace_id=ws_id,
            path=rel_path,
            sha1=sha1,
            size=len(content),
            mime_type=mime_type,
            is_asset=is_asset,
        ))
        result_status = "created"

    ws.updated_at = datetime.now(timezone.utc)
    await session.commit()

    return {
        "status": result_status,
        "path": rel_path,
        "sha1": sha1,
        "size": len(content),
    }


@router.delete("/{ws_id}/files", status_code=status.HTTP_204_NO_CONTENT)
@_serialized_write
async def delete_workspace_file(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
    path: str = Query(...),
):
    """单文件删除（增量更新）。

    删除磁盘文件与 DB 记录，并逐级清理变空的父目录。
    内容更新不影响分享链接（不修改 share_token）。
    """
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    norm_path = os.path.normpath(path)
    if norm_path in ("", "."):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法路径")
    if norm_path.startswith("..") or os.path.isabs(norm_path):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法路径")
    rel_path = norm_path.replace("\\", "/")

    record = (await session.execute(
        select(WorkspaceFile).where(
            WorkspaceFile.workspace_id == ws_id,
            WorkspaceFile.path == rel_path,
        )
    )).scalars().first()
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")

    full_path = _safe_join(_content_root(ws), norm_path)
    if os.path.isfile(full_path):
        os.unlink(full_path)

    # 逐级向上清理变空的父目录（到当前内容根目录为止，异常时静默停止）
    base_norm = os.path.normpath(_content_root(ws))
    parent = os.path.dirname(full_path)
    try:
        while os.path.normpath(parent) != base_norm and not os.listdir(parent):
            os.rmdir(parent)
            parent = os.path.dirname(parent)
    except OSError:
        pass

    await session.delete(record)
    ws.updated_at = datetime.now(timezone.utc)
    await session.commit()


@router.get("/{ws_id}/tree")
async def get_workspace_tree(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """获取工作空间目录树。"""
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    files = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws_id)
    )).scalars().all()
    return _build_tree(files)


@router.get("/{ws_id}/download")
async def download_workspace_zip(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    _user: CurrentUserFromQuery,
):
    """将整个工作空间打包为 zip 下载。

    以 workspace_file 记录为打包清单（与目录树一致），zip 内平铺不含根目录，
    保证「下载 → 再上传」往返一致。临时文件打包，FileResponse 流式返回，
    响应完成后由 BackgroundTask 删除临时文件。
    支持 ?jwt=xxx 查询参数以兼容浏览器原生下载无法发送 Authorization header 的场景。
    """
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    files = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws_id)
    )).scalars().all()
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "工作空间为空")

    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in files:
                disk_path = _safe_join(_content_root(ws), f.path)
                # DB 有记录但磁盘缺失（如并发上传替换）：跳过不中断
                if not os.path.isfile(disk_path):
                    continue
                zf.write(disk_path, arcname=f.path)
    except BaseException:
        os.unlink(tmp_path)
        raise

    download_name = _sanitize_filename(ws.name) or f"workspace-{ws_id}"
    encoded = quote(f"{download_name}.zip")
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
        background=BackgroundTask(os.unlink, tmp_path),
    )


@router.get("/{ws_id}/serve/{path:path}")
async def serve_workspace_file(
    ws_id: int,
    path: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    _user: CurrentUserFromAny,
    render: str | None = Query(None),
):
    """提供工作空间内文件内容。

    支持三种凭据（任一有效即可）：Authorization header（前端 fetch / CLI）、
    ?jwt= 查询参数（iframe 主文档无法带 header）、会话 cookie（iframe 内
    CSS/JS/图片等子资源与同源下载——浏览器自动发起，无法带前述凭据）。
    对 .md 文件传入 ?render=md 时会自动重写相对图片路径为绝对 URL。
    """
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    safe_path = _safe_join(_content_root(ws), path)
    if not os.path.isfile(safe_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")

    with open(safe_path, "rb") as f:
        content = f.read()

    mime_type = _get_mime_type(path)

    # .md 文件 ?render=md 时重写相对图片路径
    if path.lower().endswith(".md") and render == "md":
        text = content.decode("utf-8", errors="replace")
        file_dir = os.path.dirname(path)
        serve_prefix = f"/api/workspaces/{ws_id}/serve/"
        text = _rewrite_md_images(text, serve_prefix, file_dir)
        content = text.encode("utf-8")

    # 内容可被整包替换或单文件更新：禁用缓存保证更新后立即生效
    return Response(
        content=content,
        media_type=mime_type,
        headers={"Cache-Control": "no-store"},
    )


# ─── Share management ──────────────────────────────────────────────

@router.post("/{ws_id}/share")
async def create_share_token(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """生成（或复用）工作空间只读分享令牌。"""
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    if not ws.share_token:
        ws.share_token = secrets.token_urlsafe(16)
        ws.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(ws)
    return {"share_token": ws.share_token}


@router.delete("/{ws_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share_token(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """撤销工作空间分享令牌。"""
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    ws.share_token = None
    ws.updated_at = datetime.now(timezone.utc)
    await session.commit()
