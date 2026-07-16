# 文档覆盖更新与版本历史 — 设计文档

## Context

当前系统中文档上传是 append-only 模式：同一集合内上传同名文件会创建新 Document 记录，内容去重仅基于 SHA1 而非文件名。这导致：
- 分享链接永远指向旧文档，文档更新后需手动删除重建
- 文档列表中出现多个同名条目，用户无法区分
- 无法追踪文档内容的变化历史

## 设计决策

| 决策 | 结果 |
|---|---|
| 覆盖触发方式 | 显式指定（opt-in），通过 `?mode=overwrite` 参数 |
| 匹配字段 | `(collection_id, filename)` |
| 版本历史范围 | 覆盖更新 + 版本追踪，一次实施 |
| 版本号方案 | 单调递增整数，每个 Document 独立，从 1 开始 |
| 批处理 | 每个文件独立判断，混合模式（部分覆盖、部分新增） |

## 架构

### 数据模型

**新增表 DocumentVersion：**
```python
class DocumentVersion(SQLModel, table=True):
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

**Document 表增加字段：** `current_version: int = 1`

### 数据流

**Overwrite 流程：**
```
File → storage.save() → sha1_new
  → 按 (collection_id, filename) 查找现有 Document
  → 没找到 → append 逻辑
  → 找到了 + sha1_new == doc.content_sha1 → skip（内容无变化）
  → 找到了 + sha1_new != doc.content_sha1 →
    → DocumentVersion.create(当前内容) + FileBlob.ref_count++（旧版本保留）
    → Document.content_sha1 = sha1_new, size = new_size, updated_at = now
    → FileBlob(sha1_new).ref_count++
    → FTS: DELETE + INSERT（重新索引）
```

**版本创建时机：**
- 初次上传：无版本快照，current_version = 1（隐式 v1）
- 首次 overwrite：DocumentVersion v1（旧内容），doc.current_version = 2
- 每次 overwrite 递增一个版本
- Restore：先保存当前内容到新版本，再回滚

### FileBlob 引用计数

DocumentVersion 也参与 FileBlob.ref_count 计数：
- 创建 DocumentVersion → ref_count++
- 删除 DocumentVersion → ref_count--
- 删除 Document → 级联删除所有 DocumentVersion → 逐个释放 ref_count

### API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/collections/{id}/documents?mode=overwrite` | 覆盖模式上传 |
| GET | `/api/documents/{id}/versions` | 版本列表 |
| GET | `/api/documents/{id}/versions/{version}` | 获取版本内容 |
| POST | `/api/documents/{id}/versions/{version}/restore` | 恢复版本 |
| DELETE | `/api/documents/{id}/versions/{version}` | 删除版本 |

UploadResult 新增 `updated: list[Document]` 字段。

### 前端

- **UploadModal**：新增「替换同名文档」复选框，控制 mode 参数
- **VersionHistoryModal**（新组件）：Timeline 展示版本列表，支持查看/恢复/删除
- **文档列表**：版本数 > 1 时显示 v2/v3 角标，下拉菜单加「版本历史」

### CLI

- `kb push --overwrite / -o`：覆盖模式上传
- `kb version list <doc-id>`：列出版本
- `kb version view <doc-id> <version>`：查看版本内容
- `kb version restore <doc-id> <version>`：恢复版本

## 边界情况

- **内容完全相同**：overwrite 时 SHA1 匹配 → skip，不创建版本
- **文件在集合中不存在**：append 模式创建新文档
- **删除有版本的文档**：级联删除所有 DocumentVersion，FileBlob.ref_count 递减
- **批处理混合**：一批文件中部分覆盖、部分新增，API 通过 created/updated 区分
- **分享链接**：指向 Document.id → overwrite 后自动展示新版
- **FTS 索引**：overwrite 后 DELETE + INSERT 重新索引

## 验证

1. Web UI 上传文件 → 同名覆盖 → 验证内容更新 + 版本记录
2. 版本历史 → 查看/恢复旧版本
3. 分享链接 → 验证展示最新版内容
4. CLI: `kb push -c 1 --overwrite doc.md` → 验证覆盖
5. 删除有版本的文档 → FileBlob 正确清理
6. 全文搜索 → overwrite 后搜索到新内容
