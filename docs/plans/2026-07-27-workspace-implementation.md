# Workspace 整文件夹上传与预览 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 kb-service 新增 Workspace 功能，支持产品团队整文件夹上传设计产物并在线预览

**Architecture:** 新增 Workspace + WorkspaceFile 数据模型，zip 解压到磁盘保留目录树。HTML 渲染通过 iframe src= 指向 Serve API，MD 渲染用 react-markdown + 后端图片路径重写。分享通过 share_token 实现无需认证的只读访问。

**Tech Stack:** FastAPI + SQLModel + aiosqlite + React 18 + Vite + Ant Design 5

---

## 后端任务

### Task 1: 配置项 — 追加 Workspace 相关配置

**Files:**
- Modify: `backend/app/core/config.py`

**Step 1: 追加配置字段**

在 `Settings` 类中追加以下字段：

```python
# workspace
workspace_dir: Path = Path("/data/workspaces")
workspace_max_upload_mb: int = 500
workspace_blocked_exts: list[str] = [
    ".exe", ".bat", ".cmd", ".com", ".sh", ".bash", ".dll", ".so",
    ".dylib", ".dmg", ".msi", ".scr", ".pif", ".vbs", ".vbe", ".js",
    ".jse", ".wsf", ".wsh", ".ps1", ".psm1",
]
```

同时追加 `workspace_dir.mkdir(parents=True, exist_ok=True)` 到文件末尾的 settings 初始化后。

**Step 2: 验证**

```bash
cd backend && python -c "from app.core.config import settings; print(settings.workspace_dir)"
```

预期输出：`\data\workspaces`

---

### Task 2: 数据模型 — 新增 Workspace + WorkspaceFile

**Files:**
- Modify: `backend/app/models.py`

**Step 1: 在文件末尾追加两个新模型**

```python
class Workspace(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str | None = None
    storage_path: str  # 磁盘路径 /data/workspaces/{id}/
    share_token: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WorkspaceFile(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("workspace_id", "path", name="uq_workspace_file"),
    )
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.id", index=True)
    path: str  # 相对于工作空间根的路径，如 "prd(1)/assets/x.png"
    sha1: str
    size: int
    mime_type: str
    is_asset: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

注意：需要在文件顶部 `from sqlmodel import Field, SQLModel, UniqueConstraint` 中确认 `UniqueConstraint` 已导入。

**Step 2: 验证语法**

```bash
cd backend && python -c "from app.models import Workspace, WorkspaceFile; print('OK')"
```

预期输出：`OK`

---

### Task 3: 数据库迁移 — init_db 中补充新表

**Files:**
- Modify: `backend/app/core/database.py`

**Step 1: 在 init_db 末尾追加新表创建**

`SQLModel.metadata.create_all` 会自动处理新注册的模型，所以无需额外操作。但需要确保 Workspace 和 WorkspaceFile 模型在 `init_db` 执行前已被导入（已通过文件顶部的 `import app.models` 实现）。

确认 `init_db` 函数前已有 `import app.models  # noqa: F401` 即可。

**无需修改代码，确认即可。**

---

### Task 4: API 路由 — 创建 workspaces.py

**Files:**
- Create: `backend/app/api/workspaces.py`

这是核心任务。包含以下端点：

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | /api/workspaces | ✅ | 列表 |
| POST | /api/workspaces | ✅ | 创建 |
| GET | /api/workspaces/{id} | ✅ | 详情 |
| PATCH | /api/workspaces/{id} | ✅ | 编辑 |
| DELETE | /api/workspaces/{id} | ✅ | 删除 |
| POST | /api/workspaces/{id}/upload | ✅ | zip 上传 |
| GET | /api/workspaces/{id}/tree | ✅ | 目录树 |
| GET | /api/workspaces/{id}/serve/{path:path} | ✅ | 文件 Serve |
| POST | /api/workspaces/{id}/share | ✅ | 生成分享令牌 |
| DELETE | /api/workspaces/{id}/share | ✅ | 撤销分享令牌 |
| GET | /api/workspaces/share/{token} | ❌ | 分享态信息 |
| GET | /api/workspaces/share/{token}/tree | ❌ | 分享态目录树 |
| GET | /api/workspaces/share/{token}/serve/{path:path} | ❌ | 分享态文件 Serve |

**完整实现要点：**

```python
"""工作空间（Workspace）路由：CRUD、zip 上传、文件 Serve、分享。"""
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, func

from app.core.config import settings
from app.core.database import get_session
from app.core.security import CurrentUser, get_current_user_optional  # 需要新增可选认证依赖
from app.models import Workspace, WorkspaceFile

router = APIRouter(tags=["workspaces"])

# ─── 工具函数 ───

def _safe_join(storage_path: str, user_path: str) -> str:
    """安全拼接路径，防止路径遍历攻击。"""
    full = os.path.normpath(os.path.join(storage_path, user_path.lstrip("/")))
    if not full.startswith(os.path.normpath(storage_path)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "路径越权")
    return full


def _get_mime_type(path: str) -> str:
    """获取文件的 MIME 类型。"""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".md":
        return "text/markdown"
    elif ext in (".html", ".htm"):
        return "text/html"
    mime, _ = mimetypes.guess_type(path)
    return mime or "application/octet-stream"


def _is_blocked_ext(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in settings.workspace_blocked_exts


def _should_skip(name: str) -> bool:
    """是否跳过此文件/目录（隐藏文件、node_modules 等）。"""
    if name.startswith("."):
        return True
    if name == "node_modules":
        return True
    return False


def _rewrite_md_images(content: str, workspace_id: int, file_dir: str, serve_prefix: str) -> str:
    """重写 MD 中的图片相对路径为绝对 URL。"""
    base_path = file_dir.replace("\\", "/").strip("/")
    if base_path:
        base_path += "/"
    
    def _replace_img(match):
        alt = match.group(1)
        src = match.group(2)
        # 外部 URL 或绝对路径不处理
        if src.startswith(("http://", "https://", "data:", "//", "/")):
            return match.group(0)
        # 相对路径 → 绝对 URL
        resolved = base_path + src
        # 规范化路径（去除 ./ 等）
        resolved = os.path.normpath(resolved).replace("\\", "/")
        abs_url = f"{serve_prefix}{resolved}"
        return f"![{alt}]({abs_url})"
    
    # 匹配 Markdown 图片: ![alt](src)
    content = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', _replace_img, content)
    # 匹配 HTML img 标签
    def _replace_html_img(match):
        src_match = re.search(r'src="([^"]+)"', match.group(0))
        if not src_match:
            return match.group(0)
        src = src_match.group(1)
        if src.startswith(("http://", "https://", "data:", "//", "/")):
            return match.group(0)
        resolved = base_path + src
        resolved = os.path.normpath(resolved).replace("\\", "/")
        abs_url = f"{serve_prefix}{resolved}"
        return match.group(0).replace(f'src="{src}"', f'src="{abs_url}"')
    
    content = re.sub(r'<img[^>]+>', _replace_html_img, content)
    return content


def _build_tree(files: list[WorkspaceFile]) -> list[dict]:
    """从 workspace_file 列表构建目录树。"""
    tree: dict[str, dict] = {}
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
    
    def _dict_to_list(node: dict) -> list[dict]:
        result = []
        for name, item in sorted(node.items()):
            if item["type"] == "directory":
                children = _dict_to_list(item["children"])
                result.append({
                    "name": name,
                    "type": "directory",
                    "children": children,
                })
            else:
                result.append({
                    "name": name,
                    "type": "file",
                    "path": item["path"],
                    "is_asset": item["is_asset"],
                })
        return result
    
    return _dict_to_list(tree)


# ─── CRUD ───

class WorkspaceCreate(BaseModel):
    name: str
    description: str | None = None


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


@router.get("/workspaces")
async def list_workspaces(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    """列出所有工作空间，含文件数和总大小统计。"""
    workspaces = (await session.execute(
        select(Workspace).order_by(Workspace.updated_at.desc())
    )).scalars().all()
    
    result = []
    for w in workspaces:
        stats = (await session.execute(
            select(
                func.count(WorkspaceFile.id).label("doc_count"),
                func.coalesce(func.sum(WorkspaceFile.size), 0).label("total_size"),
            ).where(WorkspaceFile.workspace_id == w.id)
        )).one()
        d = w.model_dump()
        d["doc_count"] = stats.doc_count
        d["total_size"] = stats.total_size
        result.append(d)
    return result


@router.post("/workspaces", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    w = Workspace(name=body.name, description=body.description)
    session.add(w)
    await session.commit()
    await session.refresh(w)
    # 创建磁盘目录
    storage_path = settings.workspace_dir / str(w.id)
    storage_path.mkdir(parents=True, exist_ok=True)
    w.storage_path = str(storage_path)
    session.add(w)
    await session.commit()
    await session.refresh(w)
    return w


@router.get("/workspaces/{ws_id}")
async def get_workspace(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    w = await session.get(Workspace, ws_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    stats = (await session.execute(
        select(
            func.count(WorkspaceFile.id).label("doc_count"),
            func.coalesce(func.sum(WorkspaceFile.size), 0).label("total_size"),
        ).where(WorkspaceFile.workspace_id == ws_id)
    )).one()
    d = w.model_dump()
    d["doc_count"] = stats.doc_count
    d["total_size"] = stats.total_size
    return d


@router.patch("/workspaces/{ws_id}")
async def update_workspace(
    ws_id: int,
    body: WorkspaceUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    w = await session.get(Workspace, ws_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(w, k, v)
    w.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(w)
    return w


@router.delete("/workspaces/{ws_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    w = await session.get(Workspace, ws_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    # 删除磁盘文件
    if w.storage_path and os.path.exists(w.storage_path):
        shutil.rmtree(w.storage_path)
    # 删除 DB 记录
    await session.execute(
        text("DELETE FROM workspace_file WHERE workspace_id = :id"), {"id": ws_id}
    )
    await session.delete(w)
    await session.commit()


# ─── 上传 ───

@router.post("/workspaces/{ws_id}/upload", status_code=status.HTTP_201_CREATED)
async def upload_workspace_zip(
    ws_id: int,
    file: UploadFile = File(...),
    session: Annotated[AsyncSession, Depends(get_session)] = Depends(),
    user: CurrentUser = Depends(),
):
    w = await session.get(Workspace, ws_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "仅支持 .zip 格式")
    
    data = await file.read()
    if len(data) > settings.workspace_max_upload_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"上传超过上限 {settings.workspace_max_upload_mb}MB")
    
    # 清理旧内容
    if w.storage_path and os.path.exists(w.storage_path):
        shutil.rmtree(w.storage_path)
    storage_path = settings.workspace_dir / str(ws_id)
    storage_path.mkdir(parents=True, exist_ok=True)
    w.storage_path = str(storage_path)
    
    # 解压 zip
    extracted_files: list[dict] = []  # [{path, sha1, size, mime_type, is_asset}]
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for info in zf.infolist():
                # 跳过目录
                if info.is_dir():
                    # 创建空目录
                    dir_path = storage_path / info.filename
                    if not dir_path.exists():
                        dir_path.mkdir(parents=True, exist_ok=True)
                    continue
                
                # 路径遍历检测
                norm_path = os.path.normpath(info.filename)
                if norm_path.startswith("..") or os.path.isabs(norm_path):
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"非法的文件路径: {info.filename}")
                
                # 跳过隐藏文件和 node_modules
                parts = norm_path.replace("\\", "/").split("/")
                if any(_should_skip(p) for p in parts):
                    continue
                
                # 跳过可执行文件
                if _is_blocked_ext(norm_path):
                    continue
                
                # 读取文件内容
                content = zf.read(info.filename)
                
                # 写磁盘
                target = storage_path / norm_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                
                sha1 = hashlib.sha1(content).hexdigest()
                mime = _get_mime_type(norm_path)
                is_asset = mime not in ("text/markdown", "text/html")
                
                extracted_files.append({
                    "path": norm_path.replace("\\", "/"),
                    "sha1": sha1,
                    "size": len(content),
                    "mime_type": mime,
                    "is_asset": is_asset,
                })
    except zipfile.BadZipFile:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "压缩包已损坏，请重新打包")
    
    # 更新 workspace_file 表
    await session.execute(
        text("DELETE FROM workspace_file WHERE workspace_id = :id"), {"id": ws_id}
    )
    for ef in extracted_files:
        wf = WorkspaceFile(workspace_id=ws_id, **ef)
        session.add(wf)
    
    w.updated_at = datetime.now(timezone.utc)
    await session.commit()
    
    return {
        "file_count": len(extracted_files),
        "skipped_dirs": 0,  # 简化处理
    }


# ─── 目录树 ───

@router.get("/workspaces/{ws_id}/tree")
async def get_workspace_tree(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    w = await session.get(Workspace, ws_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    files = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws_id)
        .order_by(WorkspaceFile.path)
    )).scalars().all()
    return _build_tree(list(files))


# ─── 文件 Serve（认证态）───

@router.get("/workspaces/{ws_id}/serve/{path:path}")
async def serve_workspace_file(
    ws_id: int,
    path: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
    render: str | None = Query(None),  # "md" 时触发 MD 图片重写
):
    w = await session.get(Workspace, ws_id)
    if not w or not w.storage_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    
    safe_path = _safe_join(w.storage_path, path)
    if not os.path.isfile(safe_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    
    data = Path(safe_path).read_bytes()
    mime = _get_mime_type(path)
    
    # MD 渲染：图片路径重写
    if mime == "text/markdown" and render == "md":
        content = data.decode("utf-8", errors="replace")
        file_dir = os.path.dirname(path).replace("\\", "/")
        serve_prefix = f"/api/workspaces/{ws_id}/serve/"
        content = _rewrite_md_images(content, ws_id, file_dir, serve_prefix)
        return Response(content=content, media_type="text/markdown; charset=utf-8")
    
    return Response(content=data, media_type=f"{mime}; charset=utf-8" if mime.startswith("text/") else mime)


# ─── 分享 ───

@router.post("/workspaces/{ws_id}/share")
async def create_workspace_share(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    w = await session.get(Workspace, ws_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    if not w.share_token:
        w.share_token = secrets.token_urlsafe(16)
        session.add(w)
        await session.commit()
    return {"share_token": w.share_token}


@router.delete("/workspaces/{ws_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_workspace_share(
    ws_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    w = await session.get(Workspace, ws_id)
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工作空间不存在")
    w.share_token = None
    session.add(w)
    await session.commit()


# ─── 分享 Serve（无需认证）───

@router.get("/workspaces/share/{token}")
async def get_shared_workspace(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    w = (await session.execute(
        select(Workspace).where(Workspace.share_token == token)
    )).scalars().first()
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")
    stats = (await session.execute(
        select(
            func.count(WorkspaceFile.id).label("doc_count"),
            func.coalesce(func.sum(WorkspaceFile.size), 0).label("total_size"),
        ).where(WorkspaceFile.workspace_id == w.id)
    )).one()
    d = w.model_dump()
    d["doc_count"] = stats.doc_count
    d["total_size"] = stats.total_size
    # 不暴露 storage_path
    d.pop("storage_path", None)
    return d


@router.get("/workspaces/share/{token}/tree")
async def get_shared_workspace_tree(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    w = (await session.execute(
        select(Workspace).where(Workspace.share_token == token)
    )).scalars().first()
    if not w:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")
    files = (await session.execute(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == w.id)
        .order_by(WorkspaceFile.path)
    )).scalars().all()
    return _build_tree(list(files))


@router.get("/workspaces/share/{token}/serve/{path:path}")
async def serve_shared_workspace_file(
    token: str,
    path: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    render: str | None = Query(None),
):
    w = (await session.execute(
        select(Workspace).where(Workspace.share_token == token)
    )).scalars().first()
    if not w or not w.storage_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分享链接无效或已失效")
    
    safe_path = _safe_join(w.storage_path, path)
    if not os.path.isfile(safe_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文件不存在")
    
    data = Path(safe_path).read_bytes()
    mime = _get_mime_type(path)
    
    if mime == "text/markdown" and render == "md":
        content = data.decode("utf-8", errors="replace")
        file_dir = os.path.dirname(path).replace("\\", "/")
        serve_prefix = f"/api/workspaces/share/{token}/serve/"
        content = _rewrite_md_images(content, 0, file_dir, serve_prefix)
        return Response(content=content, media_type="text/markdown; charset=utf-8")
    
    return Response(content=data, media_type=f"{mime}; charset=utf-8" if mime.startswith("text/") else mime)
```

**关于 JWT：** `serve` 端点当前依赖 `CurrentUser`（从 Authorization Header 读取 JWT）。但 iframe 内请求无法发送此 Header。需要做以下修改：

**在 `app/core/security.py` 中新增** 一个可选 JWT 依赖，支持从 `Authorization` header 或 `jwt` query param 中读取 token：

```python
async def get_current_user_from_query(
    token: str | None = Query(None, alias="jwt"),
    authorization: str | None = Header(None, alias="Authorization"),
) -> User:
    """兼容 iframe src 中通过 ?jwt=xxx 传递的 token。"""
    if authorization and authorization.startswith("Bearer "):
        token_str = authorization[7:]
    elif token:
        token_str = token
    else:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return await get_user_from_token(token_str)
```

然后在 `workspaces.py` 中，`serve` 端点使用这个新的依赖而非 `CurrentUser`。

**Step 2: 验证语法**

```bash
cd backend && python -c "from app.api.workspaces import router; print('OK')"
```

预期输出：`OK`

---

### Task 5: 注册路由 — main.py 追加

**Files:**
- Modify: `backend/app/main.py`

**Step 1: 追加 import 和 router**

```python
from app.api import auth, collections, documents, doc_share, search, share, workspaces

app.include_router(workspaces.router, prefix=settings.api_prefix)
```

**Step 2: 验证**

```bash
cd backend && python -c "from app.main import app; print(len(app.routes))"
```

预期输出：路由数量增加（具体数字取决于已有路由数）

---

## 前端任务

### Task 6: API 封装 — client.ts 追加 Workspace 类型和方法

**Files:**
- Modify: `frontend/src/api/client.ts`

**Step 1: 追加类型定义**

```typescript
export interface Workspace {
  id: number
  name: string
  description: string | null
  doc_count: number
  total_size: number
  share_token: string | null
  created_at: string
  updated_at: string
}

export interface WorkspaceTreeNode {
  name: string
  type: 'file' | 'directory'
  path?: string
  is_asset?: boolean
  children?: WorkspaceTreeNode[]
}
```

**Step 2: 追加 API 方法**

```typescript
export const api = {
  // ... existing methods ...
  
  // ─── Workspace ───
  listWorkspaces: () =>
    client.get<Workspace[]>('/workspaces').then(r => r.data),
  
  createWorkspace: (name: string, description?: string) =>
    client.post<Workspace>('/workspaces', { name, description }).then(r => r.data),
  
  getWorkspace: (id: number) =>
    client.get<Workspace>(`/workspaces/${id}`).then(r => r.data),
  
  updateWorkspace: (id: number, data: { name?: string; description?: string }) =>
    client.patch<Workspace>(`/workspaces/${id}`, data).then(r => r.data),
  
  deleteWorkspace: (id: number) =>
    client.delete(`/workspaces/${id}`),
  
  uploadWorkspaceZip: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return client.post<{ file_count: number }>(`/workspaces/${id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  
  getWorkspaceTree: (id: number) =>
    client.get<WorkspaceTreeNode[]>(`/workspaces/${id}/tree`).then(r => r.data),
  
  createWorkspaceShare: (id: number) =>
    client.post<{ share_token: string }>(`/workspaces/${id}/share`).then(r => r.data),
  
  revokeWorkspaceShare: (id: number) =>
    client.delete(`/workspaces/${id}/share`),
  
  getSharedWorkspace: (token: string) =>
    client.get<Workspace>(`/workspaces/share/${token}`).then(r => r.data),
  
  getSharedWorkspaceTree: (token: string) =>
    client.get<WorkspaceTreeNode[]>(`/workspaces/share/${token}/tree`).then(r => r.data),
}
```

---

### Task 7: HtmlSandbox — 支持 src 属性

**Files:**
- Modify: `frontend/src/components/HtmlSandbox.tsx`

**Step 1: 扩展 Props 支持 src**

```typescript
interface Props {
  html?: string
  src?: string
  fill?: boolean
}
```

**Step 2: 根据 props 选择 iframe 模式**

```typescript
function HtmlSandboxInner({ html, src, fill }: Props) {
  const [height, setHeight] = useState(600)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (fill) return
    const calc = () => setHeight(Math.max(window.innerHeight - 52 - 44 - 48, 300))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [fill])

  // 监听 srcdoc 模式下的 height postMessage（src 模式由浏览器自动管理）
  useEffect(() => {
    if (!src) return
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'kb-resize' && iframeRef.current) {
        iframeRef.current.style.height = `${e.data.height}px`
      }
      // 转发路径变化
      if (e.data?.type === 'kb-navigate') {
        window.dispatchEvent(new CustomEvent('ws-navigate', { detail: e.data.path }))
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [src])

  return (
    <iframe
      ref={iframeRef}
      title="html-content"
      sandbox="allow-scripts"
      {...(src ? { src } : { srcDoc: html })}
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{
        width: '100%',
        height: fill ? '100%' : `${height}px`,
        border: 'none',
        display: 'block',
      }}
    />
  )
}
```

---

### Task 8: MarkdownViewer — 内部链接拦截

**Files:**
- Modify: `frontend/src/components/MarkdownViewer.tsx`

**Step 1: 扩展 Props**

```typescript
interface Props {
  content: string
  onTocReady?: (items: TocItem[]) => void
  onInternalLink?: (path: string) => void
  workspaceServePrefix?: string  // 如 "/api/workspaces/1/serve/"
}
```

**Step 2: 添加链接拦截逻辑**

在现有的 `useEffect` 中追加链接点击处理器：

```typescript
// 内部链接导航
useEffect(() => {
  const root = containerRef.current
  if (!root || !onInternalLink || !workspaceServePrefix) return
  
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const href = a.getAttribute('href')
    if (!href) return
    
    // 外部 URL 不拦截
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) return
    
    // 匹配工作空间内部路径
    if (href.startsWith(workspaceServePrefix)) {
      e.preventDefault()
      const path = href.slice(workspaceServePrefix.length)
      onInternalLink(path)
    }
  }
  
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}, [content, onInternalLink, workspaceServePrefix])
```

---

### Task 9: WorkspaceTree 组件

**Files:**
- Create: `frontend/src/components/WorkspaceTree.tsx`

```tsx
import { Key } from 'react'
import { Tree } from 'antd'
import { FileTextOutlined, Html5Outlined, FolderOutlined, FolderOpenOutlined, FileOutlined } from '@ant-design/icons'
import type { WorkspaceTreeNode } from '../api/client'

interface Props {
  treeData: WorkspaceTreeNode[]
  selectedFile?: string
  onSelect: (path: string) => void
}

function toAntdTree(nodes: WorkspaceTreeNode[]): any[] {
  return nodes.map(node => {
    if (node.type === 'directory') {
      return {
        key: `dir:${node.name}`,
        title: node.name,
        icon: (props: any) => props.expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: node.children ? toAntdTree(node.children) : [],
        selectable: false,
      }
    }
    const icon = node.is_asset
      ? <FileOutlined style={{ color: '#999' }} />
      : node.name.endsWith('.md')
        ? <FileTextOutlined style={{ color: '#1677ff' }} />
        : <Html5Outlined style={{ color: '#fa8c16' }} />
    
    return {
      key: `file:${node.path}`,
      title: node.name,
      icon,
      isLeaf: true,
    }
  })
}

export default function WorkspaceTree({ treeData, selectedFile, onSelect }: Props) {
  const selectedKeys: Key[] = selectedFile ? [`file:${selectedFile}`] : []
  
  const handleSelect = (keys: Key[]) => {
    if (keys.length === 0) return
    const key = String(keys[0])
    if (key.startsWith('file:')) {
      onSelect(key.slice(5))
    }
  }
  
  return (
    <Tree
      treeData={toAntdTree(treeData)}
      selectedKeys={selectedKeys}
      onSelect={handleSelect}
      defaultExpandAll
      showIcon
      style={{ background: 'transparent' }}
    />
  )
}
```

---

### Task 10: Workspaces 列表页

**Files:**
- Create: `frontend/src/pages/Workspaces.tsx`

参考 `Collections.tsx` 的卡片网格布局，展示工作空间列表。每张卡片展示：
- 名称
- 描述
- 文件数 + 总大小
- 更新时间

空状态引导创建，点击卡片进入详情页。

---

### Task 11: WorkspaceDetail 详情页

**Files:**
- Create: `frontend/src/pages/WorkspaceDetail.tsx`

参考 `CollectionDetail.tsx` 的双栏布局，但左栏改为 WorkspaceTree，右栏用 iframe/MarkdownViewer 展示内容。

核心逻辑：
1. 加载工作空间详情和目录树
2. 点击 .html → iframe src= 指向 Serve URL（附带 JWT）
3. 点击 .md → fetch 内容 + 路径重写 → MarkdownViewer
4. 监听 iframe 内导航事件 → 同步文件树高亮
5. 分享按钮 → 生成/复制分享链接

---

### Task 12: SharedWorkspace 分享页

**Files:**
- Create: `frontend/src/pages/SharedWorkspace.tsx`

类似 WorkspaceDetail 但只读：
- 从 URL 取 share_token
- 所有 API 调用使用分享端点（无需 JWT）
- 不显示上传/编辑/删除按钮
- iframe src 指向分享 Serve 路径

---

### Task 13: 路由注册 — App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: 导入新页面**

```typescript
import Workspaces from './pages/Workspaces'
import WorkspaceDetail from './pages/WorkspaceDetail'
import SharedWorkspace from './pages/SharedWorkspace'
```

**Step 2: 追加路由**

```tsx
<Route
  path="/workspaces"
  element={<RequireAuth><Workspaces /></RequireAuth>}
/>
<Route
  path="/workspaces/:id"
  element={<RequireAuth><WorkspaceDetail /></RequireAuth>}
/>
<Route path="/share/workspace/:token" element={<SharedWorkspace />} />
```

---

## 任务执行顺序

```
后端                   前端
├── Task 1: 配置       ├── Task 6: API 类型+方法
├── Task 2: 模型       ├── Task 7: HtmlSandbox src
├── Task 3: 数据库     ├── Task 8: MarkdownViewer 链接
│   (无需修改)         ├── Task 9: WorkspaceTree
├── Task 4: API 路由   ├── Task 10: Workspaces 列表
├── Task 5: 注册路由   ├── Task 11: WorkspaceDetail
                      ├── Task 12: SharedWorkspace
                      ├── Task 13: 路由
```

后端 Task 1-5 做完后可测试 API，前端 Task 6-13 做完后可预览。

---

## 验证方法

### 后端验证
```bash
cd backend
# 启动服务
uvicorn app.main:app --reload --port 8000

# 测试 CRUD
curl -X POST http://localhost:8000/api/workspaces -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"test"}'

# 测试 zip 上传
curl -X POST http://localhost:8000/api/workspaces/1/upload -H "Authorization: Bearer $TOKEN" -F "file=@test.zip"

# 测试 tree
curl http://localhost:8000/api/workspaces/1/tree -H "Authorization: Bearer $TOKEN"

# 测试 serve
curl http://localhost:8000/api/workspaces/1/serve/index.html -H "Authorization: Bearer $TOKEN"
```

### 前端验证
```bash
cd frontend && npm run dev
# 访问 http://localhost:5173/workspaces
```
