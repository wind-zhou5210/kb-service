# 工作空间 ZIP 下载功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录用户在工作空间详情页一键下载整个工作空间为 ZIP，保证「下载 → 再上传」往返一致（平铺打包不含根目录），并顺带修复前端 `doc_count`/`file_count` 字段错位 bug。

**Architecture:** 后端新增 `GET /api/workspaces/{ws_id}/download` 端点：以 `workspace_file` DB 记录为打包清单，临时文件 + `zipfile` 打包，`FileResponse` 流式返回，`BackgroundTask` 清理临时文件；鉴权复用 `CurrentUserFromQuery`（支持 `?jwt=`）。前端在 WorkspaceDetail 按钮组新增「下载」按钮，`<a href>` 触发浏览器原生下载。

**Tech Stack:** FastAPI + SQLModel（zipfile/tempfile 标准库，零新依赖）+ React 18 + Ant Design 5

**Spec:** `specs/005-workspace-download/spec.md`

---

### Task 1: 后端 — 新增工作空间 ZIP 下载端点

**Files:**
- Modify: `backend/app/api/workspaces.py`

- [ ] **Step 1: 新增 import**

文件顶部 import 区（第 2-11 行标准库 import 处）追加 `tempfile` 和 `quote`；`fastapi.responses` 导入行追加 `FileResponse`；新增 `BackgroundTask` 导入。修改后相关 import 为：

```python
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
```

```python
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask
```

其余 import 保持不变。

- [ ] **Step 2: 新增文件名清理辅助函数**

在现有 `_is_blocked_ext` 函数（约第 77-79 行）之后插入：

```python
def _sanitize_filename(name: str) -> str:
    """清理文件名中 Windows/Unix 非法字符（\\ / : * ? " < > | 及控制字符）。"""
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip()
```

- [ ] **Step 3: 新增下载端点**

在 `get_workspace_tree` 端点（`@router.get("/{ws_id}/tree")`）和 `serve_workspace_file` 端点（`@router.get("/{ws_id}/serve/{path:path}")`）之间插入：

```python
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
```

说明：`CurrentUserFromQuery` 已在文件顶部导入（无需新增）；`_safe_join` 对越权路径抛 400，由 `except BaseException` 兜底清理临时文件。

- [ ] **Step 4: 语法验证**

```bash
cd backend && python -m py_compile app/api/workspaces.py
# 预期: 无输出（编译通过）
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/workspaces.py
git commit -m "feat: add GET /api/workspaces/{id}/download zip endpoint"
```

---

### Task 2: 前端 — 修复 doc_count/file_count 字段错位

**Files:**
- Modify: `frontend/src/api/client.ts`（Workspace 接口）
- Modify: `frontend/src/pages/WorkspaceDetail.tsx`
- Modify: `frontend/src/pages/Workspaces.tsx`
- Modify: `frontend/src/pages/SharedWorkspace.tsx`

背景：后端 `list_workspaces` / `get_workspace` / `get_shared_workspace` 实际返回 `file_count`，但前端接口声明为 `doc_count`，导致「{n} 个文件」显示 `undefined`。注意 `Collection.doc_count` 是集合的合法字段，**不要改动**。

- [ ] **Step 0: 环境准备（worktree 内首次执行前端命令时）**

```bash
cd frontend && npm install
# 预期: 安装完成无报错
```

- [ ] **Step 1: 修改 Workspace 接口字段**

`frontend/src/api/client.ts` 中 `Workspace` 接口（约第 77-86 行），将 `doc_count: number` 改为 `file_count: number`：

```typescript
export interface Workspace {
  id: number
  name: string
  description: string | null
  file_count: number
  total_size: number
  share_token: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: 修正三处引用**

`frontend/src/pages/WorkspaceDetail.tsx`（约第 198 行）：

```tsx
{workspace.file_count} 个文件 · {formatSize(workspace.total_size)}
```

`frontend/src/pages/Workspaces.tsx`（约第 154 行）：

```tsx
<span>{ws.file_count} 个文件</span>
```

`frontend/src/pages/SharedWorkspace.tsx`（约第 112 行）：

```tsx
{workspace.file_count} 个文件 · {formatSize(workspace.total_size)}
```

- [ ] **Step 3: 类型检查验证**

```bash
cd frontend && npx tsc --noEmit
# 预期: 无类型错误（若报 doc_count 相关错误说明有引用漏改）
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/pages/WorkspaceDetail.tsx frontend/src/pages/Workspaces.tsx frontend/src/pages/SharedWorkspace.tsx
git commit -m "fix: rename Workspace.doc_count to file_count to match backend response"
```

---

### Task 3: 前端 — WorkspaceDetail 新增下载入口

**Files:**
- Modify: `frontend/src/api/client.ts`（api 对象）
- Modify: `frontend/src/pages/WorkspaceDetail.tsx`

- [ ] **Step 1: client.ts 新增下载 URL 构造函数**

在 `api` 对象的 `uploadWorkspaceZip` 方法之后插入（非 axios 请求，仅构造 URL，供 `<a href>` 原生下载使用；点击时即时构造，规避 JWT 过期）：

```typescript
  workspaceDownloadUrl: (id: number) =>
    `/api/workspaces/${id}/download?jwt=${encodeURIComponent(localStorage.getItem('kb_token') || '')}`,
```

- [ ] **Step 2: WorkspaceDetail 导入下载图标**

图标导入行（第 4 行）在 `UploadOutlined` 后追加 `DownloadOutlined`：

```typescript
import { UploadOutlined, DownloadOutlined, ArrowLeftOutlined, ShareAltOutlined, FolderOutlined, DeleteOutlined, InboxOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
```

- [ ] **Step 3: 新增下载处理函数**

在 `handleUpload` 函数之后插入：

```typescript
  // Download：<a> 触发浏览器原生下载（进度/取消由浏览器接管，不占页面内存）
  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = api.workspaceDownloadUrl(wsId)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
```

- [ ] **Step 4: 按钮组插入「下载」按钮**

侧栏 `<Space>` 按钮组（约第 200-206 行）改为，「下载」位于「上传」之后，空工作空间禁用：

```tsx
          <Space>
            <Button type="primary" size="small" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传</Button>
            <Button size="small" icon={<DownloadOutlined />} disabled={!workspace.file_count} onClick={handleDownload}>下载</Button>
            <Button size="small" icon={<ShareAltOutlined />} onClick={handleShare}>
              {shareToken ? '分享' : '分享'}
            </Button>
            <Button size="small" icon={<DeleteOutlined />} onClick={handleDelete} danger />
          </Space>
```

- [ ] **Step 5: 类型检查验证**

```bash
cd frontend && npx tsc --noEmit
# 预期: 无类型错误
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/pages/WorkspaceDetail.tsx
git commit -m "feat: add workspace zip download button with native browser download"
```

---

## Verification（对照 spec 第 7 节验收标准）

### API 验证

```bash
# 启动后端（需本地 Python 环境装好 backend/requirements.txt）
cd backend && uvicorn app.main:app --reload --port 8000

# 1. 登录取 token
curl -s -X POST http://localhost:8000/api/auth/login -d "username=admin&password=admin123"
# 预期: {"access_token":"<TOKEN>", ...}

# 2. 无 JWT → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/workspaces/1/download
# 预期: 401

# 3. 不存在的工作空间 → 404
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8000/api/workspaces/99999/download?jwt=<TOKEN>"
# 预期: 404

# 4. 空工作空间 → 400（先创建一个空工作空间，用其 id）
curl -s "http://localhost:8000/api/workspaces/<EMPTY_WS_ID>/download?jwt=<TOKEN>"
# 预期: {"detail":"工作空间为空"}

# 5. 正常下载 → 200 + zip
curl -s -D - -o /tmp/ws.zip "http://localhost:8000/api/workspaces/<WS_ID>/download?jwt=<TOKEN>"
# 预期: 200，Content-Type: application/zip，Content-Disposition: attachment; filename*=UTF-8''xxx.zip

# 6. 分享通道无下载端点
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/workspaces/share/<TOKEN_ANY>/download
# 预期: 404
```

### 往返一致性验证（核心）

1. 准备含中文文件名 + 多级目录的文件夹，压缩为 ZIP 上传到工作空间
2. 点击「下载」→ 解压下载的 ZIP → 与原文件夹逐一比对：目录结构、文件名（含中文）、文件内容一致
3. 将下载的 ZIP **原样再上传** → 目录树与之前完全一致（不多一层根目录）

### 前端验证

1. 工作空间详情页按钮组顺序为 `[上传] [下载] [分享] [删除]`
2. 点击「下载」→ 浏览器原生下载 `{工作空间名}.zip`，有进度显示，页面不阻塞
3. 空工作空间 →「下载」按钮置灰
4. 侧栏「{n} 个文件」显示正确数字（不再是 undefined）；工作空间列表页文件数同样正常
5. 分享页（/share/workspace/{token}）无下载按钮
6. 下载完成后检查系统 temp 目录无 `*.zip` 残留

---

## 关联文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/api/workspaces.py` | 修改 | 新增 `_sanitize_filename` + `GET /{ws_id}/download` 端点 |
| `frontend/src/api/client.ts` | 修改 | `Workspace.file_count` 字段修复 + `workspaceDownloadUrl` |
| `frontend/src/pages/WorkspaceDetail.tsx` | 修改 | 下载按钮 + `handleDownload` + 字段修复 |
| `frontend/src/pages/Workspaces.tsx` | 修改 | 字段修复 |
| `frontend/src/pages/SharedWorkspace.tsx` | 修改 | 字段修复 |
| `specs/005-workspace-download/spec.md` | 已存在 | 需求规范 |
