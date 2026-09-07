# 文档包（Markdown + 图片资产）上传与渲染 需求规范

Version: 1.0
Created: 2026-09-07
Status: Draft

## 1. 概述

### 1.1 背景

AI 产出的 PRD 等文档常见形态为「一个 Markdown 文件 + 一个图片目录」，md 内以相对路径（如 `images/arch.png`）引用图片。当前知识库（集合/文档）链路**完全不支持图片**，断点有四：

| # | 断点 | 位置 |
|---|------|------|
| 1 | 上传白名单仅 `.md/.html/.htm`，图片直接 400 | `backend/app/api/documents.py` `ALLOWED` |
| 2 | 前端上传框 `ACCEPT='.md,.html,.htm'`，图片不可选 | `frontend/src/components/UploadModal.tsx` |
| 3 | `LocalStorage.read()` 只尝试 md/html 扩展名，图片 blob 存了也读不回 | `backend/app/storage/__init__.py` |
| 4 | 文档模型无资产概念、无资产 serve 端点，md 相对图片渲染即 404 | `models.py` / `MarkdownViewer.tsx` |

对照：工作空间（Workspace）已有完整可复用模式——zip 解压、`_rewrite_md_images` serve 期重写相对图片为绝对 serve URL。本功能将该模式移植到知识库文档链路。

### 1.2 目标

- 支持将「md + 图片目录」打包为 zip 一次上传到集合，md 内相对图片在预览页、分享页正确渲染
- zip 内多个 md 时每个 md 独立成文档，共享包内资产池（按各自相对路径解析）
- 覆盖更新（overwrite）时整包替换内容与资产；删除/移动文档时资产生命周期正确

### 1.3 范围（已澄清决策）

| 决策点 | 结论 |
|--------|------|
| 上传形态 | **zip 包上传**（新增独立端点；不与现有单/多文件端点混合） |
| 多 md 语义 | **每个 md/html 入口各建一个文档**，共享包内资产池 |
| 资产归属 | 资产行挂在文档下（`DocumentAsset`），每个文档持有整包资产集；物理 blob 按 sha1 跨文档去重 |
| 历史版本图片 | 资产跟随文档当前态；历史版本/恢复版本按当前资产 best-effort 解析（已知限制） |

**不在本次范围**：

| 功能 | 说明 |
|------|------|
| 包下载（md+图片打回 zip） | 现有单文件下载不变；P2 |
| HTML 入口文档内的相对图片渲染 | html 仍走 srcdoc 预览，相对图片不渲染（已知限制，P2） |
| 多文件/目录选择上传 | 仅 zip |
| CLI 推送文档包 | 不涉及 |
| 文档列表资产数徽标 | P2 |

### 1.4 成功指标

- 「prd.md + images/ 目录」zip 一步上传后，预览页图片全部可见
- 分享链接打开者（未登录）图片可见
- 覆盖更新后图片随新包更新，旧 blob 无泄漏（ref_count 归零删除）
- 删除文档后资产 blob 正确释放

---

## 2. 用户分析

### 2.1 用户故事

**作为** 用 AI 撰写 PRD 的知识库维护者
**我想要** 把 md 与图片目录打包 zip 一次上传到集合
**以便于** 团队在知识库中读到图文完整的 PRD，而非图片全裂的 markdown

**作为** 分享链接的访问者
**我想要** 打开分享页看到完整图文
**以便于** 无需登录、无需索要原包即可评审文档

### 2.2 用户旅程

```
本地：prd.md + images/*.png（md 内 ![](images/x.png)）
      │ 打包 prd.zip
      ▼
集合页「上传」→ 选择 prd.zip → 后端解压校验
      │
      ▼
创建 Document(prd.md) + DocumentAsset×N（整包图片）
      │
      ▼
预览：raw 返回时相对图片重写为 /api/documents/{id}/assets/... （?jwt= 由前端 img 追加）
      │
      ▼
分享：/share/doc/{token} 内容重写为 /api/share/doc/{token}/assets/...（免鉴权）
```

---

## 3. 功能需求

### 3.1 核心功能

| 编号 | 功能点 | 优先级 | 验收标准 |
|------|--------|--------|----------|
| F1 | zip 包上传端点 | P0 | 解压建文档+资产；无 md 入口报 400；超限报 413 |
| F2 | 资产 serve（鉴权） | P0 | `GET /documents/{id}/assets/{path}` Bearer/?jwt= 均可 |
| F3 | 资产 serve（分享） | P0 | `GET /share/doc/{token}/assets/{path}` 免鉴权 |
| F4 | md serve 期图片重写 | P0 | raw/分享 raw/版本 raw 相对图片重写为对应资产 URL |
| F5 | 前端上传框支持 zip | P0 | 选 zip 走包端点；结果提示与现有格式一致 |
| F6 | 前端图片鉴权透传 | P0 | 登录态 `<img>` 自动追加 `?jwt=` |
| F7 | overwrite 整包替换 | P0 | 内容+资产替换；旧 blob ref_count 释放 |
| F8 | 删除/移动生命周期 | P0 | 删除释放资产 blob；移动后资产 URL 仍有效（基于 doc_id） |

### 3.2 API 契约

```
POST /api/collections/{col_id}/documents/package?mode=append|overwrite
  multipart: file=<zip>
  201: { created: Document[], updated: Document[], duplicated: string[] }
  400: 包内无 md/html 入口 / 非法 zip
  413: 解压前累计大小超限

GET /api/documents/{doc_id}/assets/{path:path}
  鉴权: CurrentUserFromQuery（Bearer header 或 ?jwt=）
  200: 图片二进制（Content-Type 按 mime_type）
  404: 文档/资产不存在

GET /api/share/doc/{token}/assets/{path:path}
  免鉴权（token 即能力）
  200/404 同上

GET /api/documents/{doc_id}/raw            （md 时重写相对图片 → /api/documents/{id}/assets/…）
GET /api/share/doc/{token}                 （md 时重写 → /api/share/doc/{token}/assets/…）
GET /api/documents/{doc_id}/versions/{v}   （md 时重写 → 鉴权资产前缀）
```

### 3.3 包解析规则

- **入口文档**：扩展名 `.md/.html/.htm` 的 zip 条目，每条目一个 Document（title/filename 取条目文件名）
- **资产**：扩展名 ∈ `{.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.ico}` 的条目；**每个入口文档均挂整包资产集**（path 为包内相对路径），保证任意 md 目录深度的相对引用（含 `../`）可解析
- **其他扩展名**：跳过（计入 skipped，不报错）
- **路径安全**：normpath 拒绝绝对路径与 `..`；跳过隐藏文件/目录与 `node_modules`（复用工作空间规则）
- **zip 炸弹防护**：读取 infolist 累计 `file_size`，超过 `package_max_upload_mb`（新配置，默认 100）即 413，不解压
- **去重/overwrite**：md 内容 sha1 与集合已有文档相同 → duplicated 跳过；overwrite 按 `(collection_id, filename)` 匹配，命中则建版本快照、替换内容与资产行

### 3.4 数据模型

```python
class DocumentAsset(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("document_id", "path", name="uq_doc_asset"),)
    id: int | None = primary_key
    document_id: int = FK document.id (index)
    path: str        # 包内相对路径（/ 分隔，normpath 后）
    sha1: str = FK fileblob.sha1
    size: int
    mime_type: str
    created_at: datetime
```

- 建表：`init_db` 的 `create_all` 自动生效，无手工迁移
- ref_count：每条资产行对其 blob +1；文档内容 blob 规则不变
- 重写解析：`file_dir = dirname(md 条目路径)`，复用工作空间 `_rewrite_md_images`（下沉至 `app/services/render.py`）

### 3.5 前端改动

- `UploadModal`：`ACCEPT` 增加 `.zip`；提交时 zip 文件走 `api.uploadPackage`，其余文件走原端点（同 mode）
- `client.ts`：新增 `uploadPackage(colId, file, mode)`
- `MarkdownViewer`：自定义 img 渲染——src 以 `/api/documents/` 开头且无 `jwt=` 时追加 `?jwt={kb_token}`（`<img>` 无法携带 Authorization header）；分享页前缀 `/api/share/doc/` 免鉴权不追加

---

## 4. 非功能需求

- **安全**：鉴权资产端点用 `CurrentUserFromQuery`；路径 normpath 防穿越；svg 仅经 `<img>` 渲染（不执行脚本）
- **性能**：blob 内容寻址跨文档去重；资产行轻量（sqlite）
- **兼容**：现有单/多文件上传、分享、版本、FTS 行为全部不变

## 5. 边缘情况

| 场景 | 处理 |
|------|------|
| zip 内无 md/html | 400「包内未找到 markdown/html 文档」 |
| zip 内无图片 | 正常建文档（等价现有上传） |
| md 引用不存在的图片 | 重写后 404，裂图（与本地 md 行为一致） |
| 路径穿越条目（`../x.png`） | 跳过该条目 |
| 同名 md 不同包 overwrite | 按 (collection_id, filename) 匹配覆盖 |
| 删除被多文档共享 blob 的文档 | ref_count 递减，归零才删物理文件 |
| 历史版本查看 | 图片按当前资产解析（best-effort，已知限制） |
| 非图片二进制混入 zip | 跳过不入库 |

## 6. 验收标准

- [ ] zip（prd.md + images/）上传后预览页图片全部渲染
- [ ] 多 md 包：每个 md 成文档，各自相对路径图片均渲染
- [ ] 分享页（未登录）图片渲染
- [ ] overwrite 重传：图片更新；`data/files` 无孤儿 blob（ref_count 校验）
- [ ] 删除文档后资产 blob 释放
- [ ] 无 md 包 400 / 超大包 413 / 穿越路径跳过
- [ ] 现有单文件上传、版本、FTS、分享回归通过
- [ ] `npx tsc --noEmit`、后端 docker e2e 通过

## 7. 附录

### 7.1 备选方案记录

| 方案 | 结论 |
|------|------|
| 资产挂包实体表（Package 1-N Asset） | 否决：移动/删除文档需包级 ref_count，模型复杂 |
| 资产仅存 md 显式引用的图片 | 否决：需解析 md 且漏掉动态引用；整包挂载更稳 |
| 资产端点免鉴权（仿 workspace serve） | 否决：doc_id+path 可猜测；采用 CurrentUserFromQuery + 前端 ?jwt= |
| 上传期重写 md 内图片路径 | 否决：serve 期重写对版本/分享/移动更鲁棒（workspace 已验证） |

### 7.2 参考资料

- 工作空间资产模式：`backend/app/api/workspaces.py`（`_rewrite_md_images`、zip 解压校验）
- 文档链路：`backend/app/api/documents.py`、`doc_share.py`
- 存储：`backend/app/storage/__init__.py`
- 前端：`UploadModal.tsx`、`MarkdownViewer.tsx`、`CollectionDetail.tsx`、`SharedDocument.tsx`

### 7.3 修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| 1.0 | 2026-09-07 | wb_zhouzheng | 初稿 |
