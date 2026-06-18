# 文档全屏模式与单文档分享 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文档查看增加全屏专注阅读模式，并实现单个文档级别的只读分享功能。

**Architecture:** 全屏用 CSS `position:fixed` 覆盖层（z-index:1000），复用 MarkdownViewer/HtmlSandbox（HtmlSandbox 加 `fill` prop 适配全屏高度）；文档分享扩展 Document 模型加 `share_token`，新增公开路由 `GET /api/share/doc/{token}`，前端 DocListItem 加 hover 分享按钮 + 新建 SharedDocument 分享页。

**Tech Stack:** FastAPI + SQLModel + SQLite（后端）；React + TypeScript + Ant Design + react-router-dom（前端）

**测试说明:** 项目当前无测试框架，采用"实现 + 手动验证（curl/浏览器）"模式，每个任务后验证并 commit。后端服务在 `d:\th\kb-service\backend` 用 `uvicorn app.main:app --reload --port 8000` 运行（--reload 会自动重载）；前端在 `d:\th\kb-service\frontend` 用 `npm run dev` 运行（HMR 自动更新）。

---

## 文件结构

后端:
- `backend/app/models.py`（修改：Document 加 share_token）
- `backend/app/core/database.py`（修改：init_db 加迁移）
- `backend/app/api/documents.py`（修改：加 POST/DELETE share 路由）
- `backend/app/api/doc_share.py`（新建：GET /api/share/doc/{token}）
- `backend/app/main.py`（修改：注册 doc_share 路由）

前端:
- `frontend/src/api/client.ts`（修改：API + DocumentItem.share_token）
- `frontend/src/components/HtmlSandbox.tsx`（修改：加 fill prop）
- `frontend/src/components/DocListItem.tsx`（修改：hover 分享按钮 + onShare prop）
- `frontend/src/pages/CollectionDetail.tsx`（修改：全屏覆盖层 + 分享 Modal + 传 onShare）
- `frontend/src/pages/SharedDocument.tsx`（新建：分享只读页）
- `frontend/src/App.tsx`（修改：/share/doc/:token 路由）
- `frontend/src/index.css`（修改：doc-share-btn hover 样式）

---

## Task 1: Document 模型加 share_token + DB 迁移

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/core/database.py`

- [ ] **Step 1: Document 模型加 share_token 字段**

在 `backend/app/models.py` 的 `Document` 类 `sort_order` 字段后加：

```python
    share_token: str | None = Field(default=None, index=True)  # 单文档只读分享令牌
```

完整 Document 类应为：
```python
class Document(SQLModel, table=True):
    """逻辑文件（用户视角的文档，可重命名、打标签）。"""
    id: int | None = Field(default=None, primary_key=True)
    collection_id: int = Field(foreign_key="collection.id", index=True)
    title: str = Field(index=True)
    filename: str
    ext: str
    content_sha1: str = Field(foreign_key="fileblob.sha1", index=True)
    size: int
    tags: str | None = None
    note: str | None = None
    sort_order: int = 0
    share_token: str | None = Field(default=None, index=True)  # 单文档只读分享令牌
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: init_db 加迁移（已有数据库兼容）**

在 `backend/app/core/database.py` 的 `init_db` 函数内，`create_all` 之后、WAL 之前加迁移逻辑：

```python
async def init_db() -> None:
    """启动时建表。MVP 用 SQLModel.metadata 建表，生产建议用 Alembic 迁移。"""
    import app.models  # noqa: F401
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        # 迁移：Document 加 share_token 列（已有数据库兼容）
        cols = (await conn.execute(text("PRAGMA table_info(document)"))).fetchall()
        col_names = [c[1] for c in cols]
        if "share_token" not in col_names:
            await conn.execute(text("ALTER TABLE document ADD COLUMN share_token TEXT"))
        # 开启 WAL，提升 SQLite 并发读性能
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        # FTS5 全文索引虚表
        await conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
                document_id UNINDEXED,
                title,
                collection_name,
                body_text
            )
        """))
```

- [ ] **Step 3: 验证后端启动 + 迁移生效**

Run: 重启后端（--reload 会自动重载，若未重载手动重启），然后：
```
curl.exe -s http://localhost:8000/api/health
```
Expected: `{"status":"ok"}`（启动无报错即迁移成功）

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/core/database.py
git commit -m "feat: Document模型加share_token字段及DB迁移"
```

---

## Task 2: documents.py 加 POST/DELETE 分享路由

**Files:**
- Modify: `backend/app/api/documents.py`

- [ ] **Step 1: 加 secrets 导入**

在 `backend/app/api/documents.py` 顶部 import 区加：
```python
import secrets
```
（与已有的 `import os`、`import re` 同级）

- [ ] **Step 2: 加 POST/DELETE 分享路由**

在 `documents.py` 末尾（`delete_document` 函数之后）追加：

```python
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
```

- [ ] **Step 3: 验证 POST/DELETE（需先登录拿 token）**

Run（PowerShell，先登录）：
```
$tok = (curl.exe -s -X POST http://localhost:8000/api/auth/login -d "username=admin&password=admin123" -H "Content-Type: application/x-www-form-urlencoded" | ConvertFrom-Json).access_token; curl.exe -s -X POST http://localhost:8000/api/documents/1/share -H "Authorization: Bearer $tok"
```
Expected: `{"share_token":"<16字节urlsafe字符串>"}`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/documents.py
git commit -m "feat: 文档分享POST/DELETE路由(生成/撤销令牌)"
```

---

## Task 3: doc_share.py 公开路由 + main.py 注册

**Files:**
- Create: `backend/app/api/doc_share.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 新建 doc_share.py**

创建 `backend/app/api/doc_share.py`：

```python
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
    return {"document": doc, "ext": doc.ext, "content": content}
```

- [ ] **Step 2: main.py 注册路由**

在 `backend/app/main.py` 的 import 行修改：
```python
from app.api import auth, collections, documents, doc_share, share
```

在路由注册区（`app.include_router(share.router, ...)` 附近，注意 share.router 是集合分享）加：
```python
app.include_router(doc_share.router, prefix=prefix)
```

- [ ] **Step 3: 验证公开访问**

Run（用 Task 2 生成的 share_token，替换 <token>）：
```
curl.exe -s "http://localhost:8000/api/share/doc/<token>"
```
Expected: 返回 JSON，含 `document`（文档元信息）、`ext`、`content`（Markdown 原文 或 HTML 包装）

验证无效 token 404：
```
curl.exe -s -o NUL -w "%{http_code}" "http://localhost:8000/api/share/doc/invalid"
```
Expected: `404`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/doc_share.py backend/app/main.py
git commit -m "feat: 公开文档分享路由GET /api/share/doc/{token}"
```

---

## Task 4: client.ts 加 API + DocumentItem.share_token

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: DocumentItem 加 share_token 字段**

在 `frontend/src/api/client.ts` 的 `DocumentItem` 接口 `sort_order` 后加：
```typescript
  share_token: string | null
```

完整 DocumentItem：
```typescript
export interface DocumentItem {
  id: number
  collection_id: number
  title: string
  filename: string
  ext: string
  content_sha1: string
  size: number
  tags: string | null
  note: string | null
  sort_order: number
  share_token: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: 加文档分享 API**

在 `client.ts` 的 `api` 对象内，`getSharedCollection` 之后加：

```typescript
  createDocShareLink: (docId: number) =>
    client.post<{ share_token: string }>(`/documents/${docId}/share`).then((r) => r.data),

  revokeDocShare: (docId: number) =>
    client.delete(`/documents/${docId}/share`),

  getSharedDocument: (token: string) =>
    client.get<{ document: DocumentItem; ext: string; content: string }>(`/share/doc/${token}`).then((r) => r.data),
```

- [ ] **Step 3: 验证前端无编译错误**

Run: 查看前端 Vite 终端，应出现 `hmr update /src/api/client.ts` 且无报错。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: 前端文档分享API及DocumentItem.share_token类型"
```

---

## Task 5: HtmlSandbox 加 fill prop（适配全屏高度）

**Files:**
- Modify: `frontend/src/components/HtmlSandbox.tsx`

- [ ] **Step 1: 加 fill prop**

修改 `frontend/src/components/HtmlSandbox.tsx`，Props 加 `fill?: boolean`，fill 模式下 iframe 高度用 `100%`（填充父容器），不监听视口：

```tsx
import { useEffect, useState, memo } from 'react'

interface Props {
  /** 后端包装好的 HTML 字符串（已净化 + 注入脚本），作为 iframe srcdoc */
  html: string
  /** fill 模式：iframe 高度 100% 填充父容器（用于全屏），否则用视口高度 */
  fill?: boolean
}

function HtmlSandboxInner({ html, fill }: Props) {
  const [height, setHeight] = useState(600)

  useEffect(() => {
    if (fill) return  // fill 模式用 100%，不监听视口
    // 52=app-header，44=文档顶栏，48=iframe 容器上下 padding
    const calc = () => setHeight(Math.max(window.innerHeight - 52 - 44 - 48, 300))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [fill])

  return (
    <iframe
      title="html-content"
      sandbox="allow-scripts"
      srcDoc={html}
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

const HtmlSandbox = memo(HtmlSandboxInner)
export default HtmlSandbox
```

- [ ] **Step 2: 验证非全屏 HTML 仍正常**

Run: 浏览器打开一个 HTML 文档，确认渲染正常（fill 未传，用视口高度）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/HtmlSandbox.tsx
git commit -m "feat: HtmlSandbox加fill prop支持全屏高度填充"
```

---

## Task 6: CollectionDetail 全屏模式

**Files:**
- Modify: `frontend/src/pages/CollectionDetail.tsx`

- [ ] **Step 1: import 全屏图标**

在 `CollectionDetail.tsx` 顶部 antd icons import 中加 `FullscreenOutlined, FullscreenExitOutlined`：

```typescript
import {
  ArrowLeftOutlined, UploadOutlined, DeleteOutlined, DownloadOutlined,
  MoreOutlined, SearchOutlined, FileTextOutlined, Html5Outlined, FolderOutlined, EditOutlined,
  FullscreenOutlined, FullscreenExitOutlined,
} from '@ant-design/icons'
```

- [ ] **Step 2: 加 fullscreen state + ESC 监听**

在组件内 state 区加：
```typescript
  const [fullscreen, setFullscreen] = useState(false)
```

在 `useEffect` 区加 ESC 监听（可放在已有 useEffect 之后）：
```typescript
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])
```

- [ ] **Step 3: 顶栏操作区加全屏按钮**

在文档顶栏的 `<Space>` 操作区（下载按钮 Tooltip 之前）加全屏按钮：

```tsx
                <Space>
                  <Tooltip title="全屏阅读">
                    <Button type="text" size="small" icon={<FullscreenOutlined />} onClick={() => setFullscreen(true)} />
                  </Tooltip>
                  <Tooltip title="下载">
                    <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => window.open(`/api/documents/${selected.id}/download`)} />
                  </Tooltip>
                  <Dropdown menu={dropdownItems(selected)} trigger={['click']}>
                    <Button type="text" size="small" icon={<MoreOutlined />} />
                  </Dropdown>
                </Space>
```

- [ ] **Step 4: 加全屏覆盖层 JSX**

在最外层 `<div>` 闭合标签之前（Modal 之前）加全屏覆盖层：

```tsx
      {fullscreen && selected && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            flexShrink: 0, height: 48, borderBottom: '1px solid var(--border)',
            padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{selected.title}</span>
            <Button type="text" icon={<FullscreenExitOutlined />} onClick={() => setFullscreen(false)}>退出全屏</Button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {isMd ? (
              <MarkdownViewer content={mdContent} />
            ) : (
              <div style={{ height: '100%', padding: 24 }}><HtmlSandbox html={htmlContent} fill /></div>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 5: 验证全屏功能**

Run: 浏览器打开 Markdown 文档，点击全屏按钮 → 覆盖层展示，ESC 退出；打开 HTML 文档全屏 → iframe 填充。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CollectionDetail.tsx
git commit -m "feat: 文档全屏阅读模式(CSS覆盖层+ESC退出)"
```

---

## Task 7: DocListItem hover 分享按钮

**Files:**
- Modify: `frontend/src/components/DocListItem.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: DocListItem 加 onShare prop + 分享按钮**

修改 `frontend/src/components/DocListItem.tsx`：

```tsx
import { FileTextOutlined, Html5Outlined, ShareAltOutlined } from '@ant-design/icons'
import { formatSize, relativeTime } from '../utils/format'
import type { DocumentItem } from '../api/client'

const TAG_COLORS = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899']

interface Props {
  doc: DocumentItem
  active: boolean
  onClick: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  onShare?: (doc: DocumentItem) => void
}

export default function DocListItem({ doc, active, onClick, dragHandleProps, onShare }: Props) {
  const isMd = doc.ext === '.md'
  const tags = doc.tags?.split(',').map(t => t.trim()).filter(Boolean) ?? []
  return (
    <div className={`doc-item ${active ? 'active' : ''}`} onClick={onClick} {...dragHandleProps}>
      <span className="doc-icon" style={{ color: isMd ? 'var(--color-md)' : 'var(--color-html)' }}>
        {isMd ? <FileTextOutlined /> : <Html5Outlined />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="doc-name">{doc.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {formatSize(doc.size)} · {relativeTime(doc.created_at)}
          </span>
          {tags.length > 0 && (
            <span style={{ display: 'inline-flex', gap: 2, marginLeft: 2 }}>
              {tags.slice(0, 3).map((t, i) => (
                <span
                  key={t}
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: TAG_COLORS[i % TAG_COLORS.length],
                    display: 'inline-block',
                  }}
                />
              ))}
            </span>
          )}
        </div>
      </div>
      {onShare && (
        <ShareAltOutlined
          className="doc-share-btn"
          onClick={(e) => { e.stopPropagation(); onShare(doc) }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: index.css 加 hover 显示样式**

在 `frontend/src/index.css` 的 `.doc-item` 样式区之后加：

```css
.doc-item .doc-share-btn {
  opacity: 0;
  color: var(--ink-400);
  transition: opacity 0.15s var(--ease), color 0.15s var(--ease);
  padding: 4px;
  flex-shrink: 0;
}
.doc-item:hover .doc-share-btn { opacity: 1; }
.doc-item .doc-share-btn:hover { color: var(--accent); }
```

- [ ] **Step 3: 验证 hover 按钮（暂未传 onShare，先确认不报错）**

Run: 浏览器打开集合详情，文档列表 hover（此时 CollectionDetail 未传 onShare，按钮不显示，确认无报错）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DocListItem.tsx frontend/src/index.css
git commit -m "feat: DocListItem加hover分享按钮及onShare prop"
```

---

## Task 8: CollectionDetail 分享 Modal + 传 onShare

**Files:**
- Modify: `frontend/src/pages/CollectionDetail.tsx`

- [ ] **Step 1: import copyToClipboard + message**

确认 `CollectionDetail.tsx` 顶部已 import `message`（antd）。加 copyToClipboard：
```typescript
import { copyToClipboard } from '../utils/clipboard'
```

- [ ] **Step 2: 加分享 Modal state + handler**

在 state 区加：
```typescript
  const [shareDocModal, setShareDocModal] = useState<DocumentItem | null>(null)
  const [shareDocUrl, setShareDocUrl] = useState('')
```

在 handler 区（handleDragEnd 附近）加：
```typescript
  const handleDocShare = async (doc: DocumentItem) => {
    const { share_token } = await api.createDocShareLink(doc.id)
    setShareDocUrl(`${window.location.origin}/share/doc/${share_token}`)
    setShareDocModal(doc)
    loadDocs()
  }

  const copyDocShareUrl = async () => {
    const ok = await copyToClipboard(shareDocUrl)
    if (ok) message.success('链接已复制')
    else message.warning('复制失败，请手动选中链接复制')
  }
```

- [ ] **Step 3: 给 SortableDoc / DocListItem 传 onShare**

SortableDoc 组件加 onShare 透传：
```tsx
function SortableDoc({ doc, active, onClick, onShare }: {
  doc: DocumentItem
  active: boolean
  onClick: () => void
  onShare: (doc: DocumentItem) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: doc.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <DocListItem doc={doc} active={active} onClick={onClick} onShare={onShare} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  )
}
```

在渲染 SortableDoc 处传 onShare：
```tsx
                  <SortableDoc key={doc.id} doc={doc} active={selected?.id === doc.id} onClick={() => viewDoc(doc)} onShare={handleDocShare} />
```

- [ ] **Step 4: 加分享 Modal JSX**

在编辑详情 Modal 之后加：

```tsx
      <Modal
        title="分享文档"
        open={!!shareDocModal}
        onCancel={() => setShareDocModal(null)}
        footer={[
          <Button key="close" onClick={() => setShareDocModal(null)}>关闭</Button>,
          <Button key="copy" type="primary" onClick={copyDocShareUrl}>复制链接</Button>,
        ]}
      >
        <div style={{ paddingTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 12 }}>
            任何人都可以通过此链接只读查看「{shareDocModal?.title}」（无需登录）。
          </p>
          <Input.Group compact>
            <Input value={shareDocUrl} readOnly style={{ width: 'calc(100% - 80px)' }} />
            <Button type="primary" onClick={copyDocShareUrl} style={{ width: 80 }}>复制</Button>
          </Input.Group>
        </div>
      </Modal>
```

- [ ] **Step 5: 验证分享生成 + 复制**

Run: 浏览器 hover 文档项 → 点击分享按钮 → 弹窗显示链接 → 点复制 → 提示"链接已复制"。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CollectionDetail.tsx
git commit -m "feat: CollectionDetail文档分享Modal及onShare透传"
```

---

## Task 9: SharedDocument 分享页 + App 路由

**Files:**
- Create: `frontend/src/pages/SharedDocument.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 新建 SharedDocument.tsx**

创建 `frontend/src/pages/SharedDocument.tsx`（参考 SharedCollection.tsx 模式）：

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Spin, Tag, Space, Empty } from 'antd'
import { FileTextOutlined, Html5Outlined } from '@ant-design/icons'
import { api, type DocumentItem } from '../api/client'
import MarkdownViewer from '../components/MarkdownViewer'
import HtmlSandbox from '../components/HtmlSandbox'
import { formatSize, relativeTime } from '../utils/format'

export default function SharedDocument() {
  const { token } = useParams<{ token: string }>()
  const [doc, setDoc] = useState<DocumentItem | null>(null)
  const [content, setContent] = useState('')
  const [ext, setExt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await api.getSharedDocument(token)
      setDoc(data.document)
      setContent(data.content)
      setExt(data.ext)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin /></div>
  }

  if (error || !doc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 12 }}>
        <Empty description="分享链接无效或已失效" />
        <Link to="/login">返回登录</Link>
      </div>
    )
  }

  const isMd = ext === '.md'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)',
        borderBottom: '1px solid var(--ink-50)', padding: '12px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Space>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-900)' }}>{doc.title}</span>
          <Tag color={isMd ? 'blue' : 'orange'} style={{ borderRadius: 4, fontSize: 11 }}>{doc.ext}</Tag>
          <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>
            {formatSize(doc.size)} · {relativeTime(doc.created_at)} · 只读分享
          </span>
        </Space>
      </div>

      {isMd ? (
        <MarkdownViewer content={content} />
      ) : (
        <div style={{ padding: 24, height: 'calc(100vh - 53px)' }}><HtmlSandbox html={content} fill /></div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: App.tsx 加路由**

在 `frontend/src/App.tsx` import 加：
```typescript
import SharedDocument from './pages/SharedDocument'
```

在 Routes 内（`/share/:token` 路由之后）加：
```tsx
      <Route path="/share/doc/:token" element={<SharedDocument />} />
```

- [ ] **Step 3: 验证分享页**

Run: 用 Task 2/8 生成的分享链接，浏览器打开 `http://localhost:5173/share/doc/<token>` → 只读展示文档内容（Markdown 渲染 / HTML iframe）。

验证无效 token：
打开 `http://localhost:5173/share/doc/invalid` → 显示"分享链接无效或已失效"。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SharedDocument.tsx frontend/src/App.tsx
git commit -m "feat: 单文档分享只读页SharedDocument及路由"
```

---

## Task 10: 撤销分享 + 删除联动验证

**Files:**
- 无新改动（验证已有实现）

- [ ] **Step 1: 验证撤销分享**

在 CollectionDetail，对已分享文档（可在 dropdownItems 菜单加撤销入口，或用 API 直接测试）。MVP 用 API 验证：

Run（PowerShell，用 admin token）：
```
$tok = (curl.exe -s -X POST http://localhost:8000/api/auth/login -d "username=admin&password=admin123" -H "Content-Type: application/x-www-form-urlencoded" | ConvertFrom-Json).access_token; curl.exe -s -o NUL -w "%{http_code}" -X DELETE http://localhost:8000/api/documents/1/share -H "Authorization: Bearer $tok"
```
Expected: `204`（撤销成功）

再访问该分享链接：
```
curl.exe -s -o NUL -w "%{http_code}" "http://localhost:8000/api/share/doc/<原token>"
```
Expected: `404`（已失效）

- [ ] **Step 2: 验证删除联动**

删除一个已分享文档后，其分享链接应 404（文档删除时整行删除，share_token 随之消失）。

Run: 在浏览器删除一个已分享文档，然后访问其分享链接 → 404。

- [ ] **Step 3: 最终端到端验证**

在浏览器完整走查：
1. 全屏：Markdown/HTML 文档全屏，ESC/按钮退出
2. 分享：hover 文档 → 分享按钮 → 生成链接 → 复制 → 打开链接只读查看
3. 撤销：撤销后链接 404

- [ ] **Step 4: Commit（如有微调）**

```bash
git add -A
git commit -m "test: 验证文档分享撤销与删除联动"
```

---

## Self-Review

**Spec coverage:**
- 文档全屏模式（Markdown/HTML）→ Task 5(fill) + Task 6 ✓
- 全屏退出（ESC/按钮）→ Task 6 ✓
- 生成分享链接 → Task 2(后端) + Task 8(前端) ✓
- 复制链接 → Task 8(copyToClipboard) ✓
- 撤销分享 → Task 2(DELETE) + Task 10(验证) ✓
- 分享页只读访问 → Task 3(后端) + Task 9(前端) ✓
- 删除联动失效 → Task 10(验证，文档删除整行删除 token 消失) ✓
- 安全（鉴权/只读/净化）→ Task 2(CurrentUser) + Task 3(wrap_html_for_srcdoc) ✓

**Placeholder scan:** 无 TBD/TODO，所有步骤含完整代码 ✓

**Type consistency:** `createDocShareLink`/`revokeDocShare`/`getSharedDocument` 在 client.ts 定义，CollectionDetail/SharedDocument 调用一致；`DocumentItem.share_token` 前后端一致；`HtmlSandbox` fill prop 在 Task 5 定义、Task 6/9 使用一致 ✓
