# 文档覆盖更新与版本历史 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 实现同名文件覆盖更新和版本历史追踪功能

**Architecture:** 后端新增 DocumentVersion 表 + 修改 upload 端点支持 mode=overwrite + 新增版本 API；前端 UploadModal 加替换选项 + VersionHistoryModal 组件；CLI push 加 --overwrite + version 命令组

**Tech Stack:** Python FastAPI + SQLModel + SQLite FTS5 / React 18 + Ant Design v5 / Node.js + commander + axios

---

### Task 1: 后端 — 新增 DocumentVersion 模型与数据库迁移

**Files:**
- Modify: `backend/app/models.py` — 添加 DocumentVersion 模型、Document 增加 current_version 字段
- Modify: `backend/app/core/database.py` — init_db() 中添加建表迁移

**Step 1: 在 models.py 添加 DocumentVersion 模型**

在 Document 模型下方添加：

```python
class DocumentVersion(SQLModel, table=True):
    """文档版本快照。每次覆盖更新时创建，记录历史内容。"""
    id: int | None = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="document.id", index=True)
    version: int
    content_sha1: str = Field(foreign_key="fileblob.sha1")
    filename: str
    ext: str
    size: int
    change_note: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

**Step 2: Document 模型增加 current_version 字段**

在 Document 模型中，在 `sort_order: int = 0` 后添加：

```python
    current_version: int = 1
```

**Step 3: database.py 添加迁移逻辑**

在 init_db() 中，在 share_token 迁移之后添加：

```python
# 迁移：Document 表加 current_version 列
if "current_version" not in col_names:
    await conn.execute(text("ALTER TABLE document ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1"))

# 迁移：DocumentVersion 表
import sqlalchemy as sa
if not await conn.run_sync(lambda c: sa.inspect(c).has_table("documentversion")):
    await conn.run_sync(SQLModel.metadata.create_all)
```

**Step 4: 验证**

```bash
cd backend && uvicorn app.main:app --reload --port 8000
# 服务启动不报错，SQLite 中自动建表
```

**Step 5: 提交**

```bash
git add backend/app/models.py backend/app/core/database.py
git commit -m "feat: add DocumentVersion model and migration"
```

---

### Task 2: 后端 — 修改上传端点支持 mode=overwrite

**Files:**
- Modify: `backend/app/api/documents.py` — upload_document() 增加 overwrite 逻辑

**Step 1: 修改 UploadResult 模型**

将现有的 `UploadResult` 替换为：

```python
class UploadResult(BaseModel):
    created: list  # list[Document]
    updated: list  # list[Document] — 新增：被覆盖更新的文档
    duplicated: list[str]
```

**Step 2: 修改 upload_document() 函数签名**

添加 `mode` 参数：

```python
@router.post("/collections/{col_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    col_id: int,
    files: Annotated[list[UploadFile], File(...)],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
    mode: Annotated[str, Query()] = "append",
):
```

**Step 3: 添加 overwrite 逻辑（在文件处理循环中）**

在当前 `seen_in_batch.add(sha1)` 行之后、FileBlob 创建之前，插入 overwrite 查找逻辑。

核心逻辑伪代码：

```python
# 在 sha1 计算之后、去重检测之前/之后插入
doc: Document | None = None
if mode == "overwrite":
    doc = (await session.execute(
        select(Document).where(
            Document.collection_id == col_id,
            Document.filename == f.filename,
        )
    )).scalars().first()

if doc and mode == "overwrite":
    # 内容完全相同则跳过
    if doc.content_sha1 == sha1:
        duplicated.append(f.filename or "")
        continue

    # 创建版本快照：记录当前内容
    # 查询当前最大版本号
    max_ver = (await session.execute(
        select(func.coalesce(func.max(DocumentVersion.version), 0)).where(
            DocumentVersion.document_id == doc.id
        )
    )).scalar()
    old_ver = DocumentVersion(
        document_id=doc.id,
        version=max_ver + 1,
        content_sha1=doc.content_sha1,
        filename=doc.filename,
        ext=doc.ext,
        size=doc.size,
    )
    session.add(old_ver)

    # 旧 blob ref_count++（DocumentVersion 引用）
    old_blob = await session.get(FileBlob, doc.content_sha1)
    if old_blob:
        old_blob.ref_count += 1

    # 新 blob 引用
    blob = await session.get(FileBlob, sha1)
    if blob:
        blob.ref_count += 1
    else:
        blob = FileBlob(sha1=sha1, ext=ext, size=size, ref_count=1)
        session.add(blob)

    # 更新 Document
    doc.content_sha1 = sha1
    doc.size = size
    doc.ext = ext
    doc.current_version += 1
    doc.updated_at = datetime.now(timezone.utc)
    session.add(doc)
    updated.append(doc)
    file_data_list.append((data, ext))
else:
    # 原有 append 逻辑
    ...
```

注意：需要在文件顶部增加 import：
```python
from sqlmodel import func
from app.models import DocumentVersion
```

**Step 4: 修改返回处理**

在提交和 FTS 索引阶段，同时对 `updated` 列表也做 FTS 更新：

```python
# 现有 created 的 FTS 索引
for d, (fdata, fext) in zip(created, file_data_list):
    ...

# 新增 updated 的 FTS 索引（先删后插）
for d, (fdata, fext) in zip(updated, file_data_list[len(created):]):
    body_text = _extract_text(fdata, fext)
    await session.execute(text(
        "DELETE FROM fts_index WHERE document_id = :doc_id"
    ), {"doc_id": d.id})
    await session.execute(text(
        "INSERT INTO fts_index (document_id, title, collection_name, body_text) "
        "VALUES (:doc_id, :title, :col_name, :body)"
    ), {"doc_id": d.id, "title": d.title, "col_name": col.name, "body": body_text})

# 返回值合并
return UploadResult(
    created=created,
    updated=updated,
    duplicated=duplicated,
)
```

注意：`file_data_list` 需要同时记录 created 和 updated 的数据。当前代码中 `file_data_list` 只 append 了 created 的。需要改为对所有非 duplicated 的文件都记录。

**Step 5: 验证**

```bash
# 启动服务
cd backend && uvicorn app.main:app --reload --port 8000

# append 模式（默认）— 行为不变
curl -X POST http://localhost:8000/api/collections/1/documents \
  -H "Authorization: Bearer <token>" \
  -F "files=@test.md"

# overwrite 模式 — 覆盖同名文件
curl -X POST "http://localhost:8000/api/collections/1/documents?mode=overwrite" \
  -H "Authorization: Bearer <token>" \
  -F "files=@test.md"
```

**Step 6: 提交**

```bash
git add backend/app/api/documents.py
git commit -m "feat: support mode=overwrite in upload endpoint"
```

---

### Task 3: 后端 — 新增版本历史 API 端点

**Files:**
- Modify: `backend/app/api/documents.py` — 添加版本 CRUD 端点

**Step 1: 添加 GET /documents/{doc_id}/versions**

```python
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
    versions = (await session.execute(stmt)).scalars().all()
    return versions
```

**Step 2: 添加 GET /documents/{doc_id}/versions/{version}**

```python
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
    return {
        "version": ver,
        "content": data.decode("utf-8", errors="replace"),
    }
```

**Step 3: 添加 POST /documents/{doc_id}/versions/{version}/restore**

```python
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

    # 查找目标版本
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

    # 旧 blob ref_count++（新版本引用它）
    old_blob = await session.get(FileBlob, doc.content_sha1)
    if old_blob:
        old_blob.ref_count += 1

    # 目标版本 blob ref_count++（Document 引用它）
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
    await session.execute(
        text("INSERT INTO fts_index (document_id, title, collection_name, body_text) "
             "VALUES (:doc_id, :title, :col_name, :body)"),
        {"doc_id": doc_id, "title": doc.title, "col_name": "" if not doc.collection_id else
         (await session.get(Collection, doc.collection_id)).name, "body": body_text},
    )

    await session.commit()
    await session.refresh(doc)
    return doc
```

**Step 4: 添加 DELETE /documents/{doc_id}/versions/{version}**

```python
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

    # 释放 blob 引用
    blob = await session.get(FileBlob, ver.content_sha1)
    if blob:
        blob.ref_count -= 1
        if blob.ref_count <= 0:
            await session.delete(blob)
            await storage.delete(ver.content_sha1)

    await session.delete(ver)
    await session.commit()
```

**Step 5: 验证**

```bash
# 查看版本列表
curl http://localhost:8000/api/documents/1/versions \
  -H "Authorization: Bearer <token>"

# 查看特定版本内容
curl http://localhost:8000/api/documents/1/versions/1

# 恢复版本
curl -X POST http://localhost:8000/api/documents/1/versions/1/restore \
  -H "Authorization: Bearer <token>"
```

**Step 6: 提交**

```bash
git add backend/app/api/documents.py
git commit -m "feat: add version history API endpoints"
```

---

### Task 4: 后端 — 修改 delete_document 级联清理版本

**Files:**
- Modify: `backend/app/api/documents.py`

**Step 1: 修改 delete_document()**

```python
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
            # 计算引用数：Document + 所有 DocumentVersion
            count = 1 if s == sha1 else 0
            count += sum(1 for v in versions if v.content_sha1 == s)
            blob.ref_count -= count
            if blob.ref_count <= 0:
                await session.delete(blob)
                await storage.delete(s)

    # 更新集合时间戳
    col = await session.get(Collection, col_id)
    if col:
        col.updated_at = datetime.now(timezone.utc)
    await session.commit()
```

**Step 2: 验证**

```bash
# 创建文档并 overwrite => 有版本记录
# 删除该文档 => 所有版本和 blob 正确清理
```

**Step 3: 提交**

```bash
git add backend/app/api/documents.py
git commit -m "fix: cascade delete DocumentVersion on document deletion"
```

---

### Task 5: 前端 — API 客户端更新 + UploadModal 覆盖选项

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/components/UploadModal.tsx`

**Step 1: client.ts — 更新 uploadDocuments 签名**

```typescript
uploadDocuments: (colId: number, files: File[], mode?: 'append' | 'overwrite') => {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const params: Record<string, string> = {}
  if (mode === 'overwrite') params.mode = 'overwrite'
  return client.post<{ created: DocumentItem[]; updated: DocumentItem[]; duplicated: string[] }>(
    `/collections/${colId}/documents`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params,
    }).then((r) => r.data)
},
```

**Step 2: client.ts — 新增版本 API 方法**

```typescript
listVersions: (docId: number) =>
  client.get<Array<{ id: number; version: number; content_sha1: string; filename: string; ext: string; size: number; created_at: string }>>(
    `/documents/${docId}/versions`
  ).then((r) => r.data),

getVersionContent: (docId: number, version: number) =>
  client.get<{ version: any; content: string }>(
    `/documents/${docId}/versions/${version}`
  ).then((r) => r.data),

restoreVersion: (docId: number, version: number) =>
  client.post<DocumentItem>(`/documents/${docId}/versions/${version}/restore`).then((r) => r.data),

deleteVersion: (docId: number, version: number) =>
  client.delete(`/documents/${docId}/versions/${version}`),
```

**Step 3: UploadModal.tsx — 添加替换选项**

在 state 部分新增：
```typescript
const [overwriteMode, setOverwriteMode] = useState(false)
```

在 Dragger 上方添加 Checkbox：
```tsx
<div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
  <Checkbox checked={overwriteMode} onChange={(e) => setOverwriteMode(e.target.checked)}>
    替换同名文档
  </Checkbox>
  <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
    （选中后同文件名的文档将被覆盖，旧版本可追溯）
  </span>
</div>
```

修改 handleUpload 中的调用：
```typescript
const result = await api.uploadDocuments(
  collectionId,
  valid.map((f) => f.originFileObj as File),
  overwriteMode ? 'overwrite' : undefined,
)
```

修改结果处理，增加 updated 展示：
```typescript
const updatedCount = (result as any).updated?.length ?? 0
// ...现有 success message 逻辑，增加 updated 信息
```

**Step 4: 提交**

```bash
git add frontend/src/api/client.ts frontend/src/components/UploadModal.tsx
git commit -m "feat: add overwrite option to upload modal"
```

---

### Task 6: 前端 — 创建 VersionHistoryModal 组件

**Files:**
- Create: `frontend/src/components/VersionHistoryModal.tsx`

**Step 1: 创建组件文件**

```tsx
import { useState, useEffect } from 'react'
import { Modal, Timeline, Button, Space, message, Tag } from 'antd'
import { HistoryOutlined, EyeOutlined, RollbackOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import { formatSize, relativeTime } from '../utils/format'

interface VersionInfo {
  id: number
  version: number
  document_id: number
  content_sha1: string
  filename: string
  ext: string
  size: number
  change_note: string | null
  created_at: string
}

interface Props {
  docId: number
  currentVersion: number
  open: boolean
  onClose: () => void
  onRestore: () => void
}

export default function VersionHistoryModal({ docId, currentVersion, open, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [loading, setLoading] = useState(false)

  const loadVersions = async () => {
    setLoading(true)
    try {
      const data = await api.listVersions(docId)
      setVersions(data)
    } catch {
      message.error('加载版本历史失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadVersions()
  }, [docId, open])

  const handleView = async (v: VersionInfo) => {
    try {
      const data = await api.getVersionContent(docId, v.version)
      // 在新标签页展示原始内容
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(`<pre>${data.content}</pre>`)
        win.document.close()
      }
    } catch {
      message.error('查看版本内容失败')
    }
  }

  const handleRestore = (v: VersionInfo) => {
    Modal.confirm({
      title: `恢复至版本 v${v.version}`,
      content: '当前内容将保存为新版本，确定要恢复吗？',
      okText: '确定恢复',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.restoreVersion(docId, v.version)
          message.success(`已恢复至 v${v.version}`)
          onRestore()
          onClose()
        } catch {
          message.error('恢复失败')
        }
      },
    })
  }

  const handleDelete = (v: VersionInfo) => {
    Modal.confirm({
      title: `删除版本 v${v.version}`,
      content: '此操作不可撤销，确定删除？',
      okText: '确定删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteVersion(docId, v.version)
          message.success(`已删除 v${v.version}`)
          loadVersions()
        } catch {
          message.error('删除失败')
        }
      },
    })
  }

  return (
    <Modal
      title={<><HistoryOutlined style={{ marginRight: 8 }} />版本历史</>}
      open={open}
      onCancel={onClose}
      width={600}
      footer={null}
    >
      <Timeline
        items={versions.map((v) => ({
          color: v.version === currentVersion ? 'blue' : 'gray',
          children: (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              background: v.version === currentVersion ? 'var(--color-fill-secondary, #f5f5f5)' : undefined,
              padding: '8px 12px', borderRadius: 6, marginBottom: 4,
            }}>
              <div>
                <div>
                  <strong>v{v.version}</strong>
                  {v.version === currentVersion && (
                    <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>当前版本</Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {formatSize(v.size)} · {relativeTime(v.created_at)}
                </div>
              </div>
              <Space>
                <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(v)}>
                  查看
                </Button>
                {v.version !== currentVersion && (
                  <>
                    <Button size="small" icon={<RollbackOutlined />} onClick={() => handleRestore(v)}>
                      恢复
                    </Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(v)}>
                      删除
                    </Button>
                  </>
                )}
              </Space>
            </div>
          ),
        }))}
      />
      {versions.length === 0 && !loading && (
        <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 24 }}>
          暂无历史版本
        </div>
      )}
    </Modal>
  )
}
```

注意：需要确认 `relativeTime` 函数是否从 `utils/format.ts` 中 export。如果没有，需要添加或内联实现。

**Step 2: 提交**

```bash
git add frontend/src/components/VersionHistoryModal.tsx
git commit -m "feat: add VersionHistoryModal component"
```

---

### Task 7: 前端 — 集成版本历史到 CollectionDetail

**Files:**
- Read: `frontend/src/pages/CollectionDetail.tsx` — 了解当前结构
- Read: `frontend/src/components/DocListItem.tsx` — 了解文档列表项
- Modify: 相关文件以添加版本历史入口

**Step 1: 在文档详情下拉菜单添加「版本历史」项**

在 CollectionDetail.tsx 的 Dropdown menu 中，在适当位置添加：

```tsx
{
  key: 'versions',
  icon: <HistoryOutlined />,
  label: '版本历史',
  onClick: () => setVersionHistoryDoc(doc),
}
```

**Step 2: 添加 VersionHistoryModal 状态和渲染**

```tsx
// 在 CollectionDetail 中
import VersionHistoryModal from '../components/VersionHistoryModal'

// 状态
const [versionHistoryDoc, setVersionHistoryDoc] = useState<DocumentItem | null>(null)

// 渲染
{versionHistoryDoc && (
  <VersionHistoryModal
    docId={versionHistoryDoc.id}
    currentVersion={versionHistoryDoc.current_version || 1}
    open={!!versionHistoryDoc}
    onClose={() => setVersionHistoryDoc(null)}
    onRestore={() => { loadDocs(); loadContent() }}
  />
)}
```

注意：`DocumentItem` 类型需要增加 `current_version` 字段。

**Step 3: 更新 client.ts 的 DocumentItem 类型**

```typescript
export interface DocumentItem {
  // ... 现有字段
  current_version?: number  // 新增
}
```

**Step 4: 在文档列表显示版本角标**

在 DocListItem.tsx 中，文档标题旁边添加版本标签：

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
  <div className="doc-name">{doc.title}</div>
  {(doc.current_version ?? 1) > 1 && (
    <span style={{
      fontSize: 10, color: 'var(--color-text-tertiary)',
      background: 'var(--color-border-light)', padding: '0 4px',
      borderRadius: 3, lineHeight: '16px', flexShrink: 0,
    }}>
      v{doc.current_version}
    </span>
  )}
</div>
```

**Step 5: 提交**

```bash
git add frontend/src/api/client.ts frontend/src/pages/CollectionDetail.tsx
git commit -m "feat: integrate version history into collection detail"
```

---

### Task 8: CLI — push 命令增加 --overwrite 标志

**Files:**
- Modify: `cli/src/commands/document.ts`
- Modify: `cli/src/types.ts`

**Step 1: types.ts — 新增 version 相关类型**

```typescript
export interface DocumentVersion {
  id: number
  document_id: number
  version: number
  content_sha1: string
  filename: string
  ext: string
  size: number
  change_note: string | null
  created_at: string
}
```

**Step 2: document.ts — push 命令增加 --overwrite**

在 `push` 命令定义中：

```typescript
program
  .command('push')
  .description('上传 .md / .html 文件到指定集合')
  .argument('<files...>', '文件路径，支持通配符')
  .requiredOption('-c, --collection <id>', '目标集合 ID')
  .option('-o, --overwrite', '替换同名文件（保留文档 ID 和元数据，旧版本可追溯）')
  .action(async (files, options) => {
    // ...
    // 构建 URL 参数
    const params: Record<string, any> = {}
    if (options.overwrite) params.mode = 'overwrite'

    const { data } = await client.post(
      `/api/collections/${colId}/documents`,
      form,
      { headers: form.getHeaders(), params }
    )

    const { created, updated, duplicated } = data
    spinner.succeed(`上传完成: ${created?.length || 0} 个文档, ${updated?.length || 0} 个文件已覆盖`)
    if (duplicated?.length > 0) {
      printWarning(`以下文件因内容重复已跳过: ${duplicated.join(', ')}`)
    }
    // 展示 created 表格（现有）
    // 增加展示 updated 表格
    if (updated?.length > 0) {
      const upRows = updated.map((d: any) => [
        String(d.id), truncate(d.title, 30), d.filename, formatSize(d.size), `v${d.current_version || ''}`
      ])
      printTable(['ID', '标题', '文件名', '大小', '版本'], upRows)
    }
  })
```

**Step 3: 提交**

```bash
git add cli/src/commands/document.ts cli/src/types.ts
git commit -m "feat: add --overwrite flag to push command"
```

---

### Task 9: CLI — 新增 version 命令组

**Files:**
- Modify: `cli/src/commands/document.ts` — 添加 version 命令

**Step 1: 注册 version 子命令**

```typescript
// version list
program
  .command('version:list')
  .description('查看文档版本历史')
  .argument('<docId>', '文档 ID')
  .option('--json', 'JSON 格式输出')
  .action(async (docId, options) => {
    const spinner = ora('加载版本列表...').start()
    try {
      const client = getClient()
      const { data } = await client.get<DocumentVersion[]>(`/api/documents/${docId}/versions`)
      spinner.stop()
      if (!data.length) {
        console.log('暂无历史版本')
        return
      }
      const rows = data.map((v) => [
        String(v.version),
        formatSize(v.size),
        formatTime(v.created_at),
      ])
      printTable(['版本', '大小', '创建时间'], rows, { json: options.json })
    } catch (err: any) {
      spinner.fail(err.message)
      process.exit(1)
    }
  })

// version view
program
  .command('version:view')
  .description('查看指定版本的内容')
  .argument('<docId>', '文档 ID')
  .argument('<version>', '版本号')
  .option('-o, --output <path>', '保存到文件')
  .action(async (docId, version, options) => {
    const spinner = ora('加载版本内容...').start()
    try {
      const client = getClient()
      const { data } = await client.get<{ version: any; content: string }>(
        `/api/documents/${docId}/versions/${version}`
      )
      spinner.stop()
      if (options.output) {
        fs.writeFileSync(options.output, data.content)
        console.log(`已保存到: ${options.output}`)
      } else {
        console.log(data.content)
      }
    } catch (err: any) {
      spinner.fail(err.message)
      process.exit(1)
    }
  })

// version restore
program
  .command('version:restore')
  .description('恢复文档到指定版本')
  .argument('<docId>', '文档 ID')
  .argument('<version>', '版本号')
  .option('-y, --yes', '跳过确认')
  .action(async (docId, version, options) => {
    if (!options.yes) {
      const ok = await askConfirm(`确认恢复文档 ${docId} 到版本 ${version}？当前内容将保存为新版本`)
      if (!ok) {
        console.log('已取消')
        return
      }
    }
    const spinner = ora('恢复中...').start()
    try {
      const client = getClient()
      await client.post(`/api/documents/${docId}/versions/${version}/restore`)
      spinner.succeed(`已恢复到版本 ${version}`)
    } catch (err: any) {
      spinner.fail(err.message)
      process.exit(1)
    }
  })
```

**Step 2: 提交**

```bash
git add cli/src/commands/document.ts
git commit -m "feat: add version list/view/restore commands"
```

---

### 验证步骤

```bash
# 1. 启动完整服务
docker compose up -d --build

# 2. 前端测试：上传文件 → 勾选「替换同名文档」→ 上传同名文件 → 验证覆盖
# 3. 版本历史：点击文档下拉菜单 → 版本历史 → 查看/恢复
# 4. 分享链接：分享文档 → overwrite → 验证分享链接显示新内容

# 5. CLI 测试
kb push -c 1 --overwrite doc.md
kb version list 1
kb version view 1 1
kb version restore 1 1 -y

# 6. 删除测试
kb delete 1
```

---

### 文件变更汇总

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/models.py` | 修改 | 添加 DocumentVersion 模型，Document 加 current_version |
| `backend/app/core/database.py` | 修改 | init_db() 加表和列迁移 |
| `backend/app/api/documents.py` | 修改 | upload 加 overwrite 逻辑 + 版本 API + delete 级联 |
| `frontend/src/api/client.ts` | 修改 | upload 加 mode 参数 + 版本 API 方法 + 类型更新 |
| `frontend/src/components/UploadModal.tsx` | 修改 | 加替换复选框 |
| `frontend/src/components/VersionHistoryModal.tsx` | 新建 | 版本历史弹窗组件 |
| `frontend/src/pages/CollectionDetail.tsx` | 修改 | 集成版本历史入口 |
| `cli/src/types.ts` | 修改 | 加 DocumentVersion 类型 |
| `cli/src/commands/document.ts` | 修改 | push 加 --overwrite + version 命令组 |
