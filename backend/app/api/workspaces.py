"""工作空间（Workspace）路由：隔离的文档目录管理。"""
import hashlib
import io
import mimetypes
import os
import re
import secrets
import shutil
import tempfile
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
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from starlette.background import BackgroundTask

from app.core.config import settings
from app.core.database import get_session
from app.core.security import CurrentUser, CurrentUserFromQuery, CurrentUserOptional
from app.models import Workspace, WorkspaceFile

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


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


def _rewrite_md_images(content: str, serve_prefix: str, file_dir: str) -> str:
    """将 Markdown 中相对路径的图片引用重写为绝对 URL。"""
    base_path = file_dir.replace("\\", "/").strip("/")
    if base_path:
        base_path += "/"

    def _replace(match):
        alt = match.group(1)
        src = match.group(2)
        if src.startswith(("http://", "https://", "data:", "//", "/")):
            return match.group(0)
        resolved = os.path.normpath(base_path + src).replace("\\", "/")
        return f"![{alt}]({serve_prefix}{resolved})"

    return re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', _replace, content)


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
    fc_stmt = select(func.count(WorkspaceFile.id)).where(
        WorkspaceFile.workspace_id == ws.id
    )
    fc = (await session.execute(fc_stmt)).scalar()
    return {**ws.model_dump(), "file_count": fc}


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

    safe_path = _safe_join(ws.storage_path, path)
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

    return Response(content=content, media_type=mime_type)


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

@router.post("/{ws_id}/upload", status_code=status.HTTP_201_CREATED)
async def upload_workspace_zip(
    ws_id: int,
    file: UploadFile,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """上传 zip 包替换工作空间全部文件。

    1. 清除当前目录内容
    2. 逐条目解压提取，跳过隐藏文件/目录、node_modules、禁止扩展名
    3. 清空并重建 workspace_file 数据库记录
    """
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    data = await file.read()
    max_bytes = settings.workspace_max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"文件过大（上限 {settings.workspace_max_upload_mb}MB）",
        )

    storage_path = ws.storage_path

    # 清空工作空间目录（保留根目录）
    if os.path.exists(storage_path):
        for entry in os.listdir(storage_path):
            entry_path = os.path.join(storage_path, entry)
            if os.path.isdir(entry_path):
                shutil.rmtree(entry_path)
            else:
                os.unlink(entry_path)

    records: list[WorkspaceFile] = []

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for entry in zf.infolist():
            # 修正中文等非 ASCII 文件名乱码
            name = _fix_zip_filename(entry)

            # 目录条目：创建空目录，但不生成记录
            if entry.is_dir():
                dir_path = os.path.join(storage_path, name)
                os.makedirs(dir_path, exist_ok=True)
                continue

            # 检查路径穿越
            norm_path = os.path.normpath(name)
            if norm_path.startswith("..") or os.path.isabs(norm_path):
                continue

            # 跳过隐藏文件/目录、node_modules
            if _should_skip(name):
                continue

            # 跳过禁止的扩展名
            if _is_blocked_ext(name):
                continue

            # 确保父目录存在
            full_path = os.path.join(storage_path, norm_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)

            # 写入磁盘
            content = zf.read(entry)
            with open(full_path, "wb") as f:
                f.write(content)

            # 计算元数据
            sha1 = hashlib.sha1(content).hexdigest()
            mime_type = _get_mime_type(norm_path)
            ext = os.path.splitext(norm_path)[1].lower()
            is_asset = ext not in (".md", ".html", ".htm")

            records.append(WorkspaceFile(
                workspace_id=ws_id,
                path=norm_path.replace("\\", "/"),
                sha1=sha1,
                size=len(content),
                mime_type=mime_type,
                is_asset=is_asset,
            ))

    # 删旧记录、插新记录
    old_records = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws_id)
    )).scalars().all()
    for r in old_records:
        await session.delete(r)

    for r in records:
        session.add(r)

    ws.updated_at = datetime.now(timezone.utc)
    await session.commit()

    return {"count": len(records)}


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
                disk_path = _safe_join(ws.storage_path, f.path)
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
    _user: CurrentUserOptional,
    render: str | None = Query(None),
):
    """提供工作空间内文件内容。

    支持 ?jwt=xxx 查询参数以兼容 iframe 内无法发送 Authorization header 的场景。
    对 .md 文件传入 ?render=md 时会自动重写相对图片路径为绝对 URL。
    """
    ws = await session.get(Workspace, ws_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")

    safe_path = _safe_join(ws.storage_path, path)
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

    return Response(content=content, media_type=mime_type)


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
