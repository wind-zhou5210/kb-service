# Workspace（工作空间）设计规范

> **背景**：产品团队在设计过程中产生多层目录的产物（BRD/PRD/MD 文档、HTML 原型、图片等），需要整文件夹上传并保持本地浏览器般的预览体验。

---

## 一、数据模型

### 1.1 新增表 `workspace`

```sql
CREATE TABLE workspace (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,              -- 工作空间名称
    description   TEXT,                       -- 描述
    storage_path  TEXT NOT NULL,              -- 磁盘实际路径 /data/workspaces/{id}/
    share_token   TEXT,                       -- 只读分享令牌（UUID）
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 1.2 新增表 `workspace_file`

```sql
CREATE TABLE workspace_file (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id   INTEGER NOT NULL REFERENCES workspace(id),
    path           TEXT NOT NULL,             -- 相对于 storage_path 的路径，如 "prd(1)/assets/x.png"
    sha1           TEXT NOT NULL,             -- 内容 SHA1（可去重节省空间）
    size           INTEGER NOT NULL,
    mime_type      TEXT NOT NULL,             -- 如 text/markdown, text/html, image/png
    is_asset       INTEGER NOT NULL DEFAULT 0, -- 0=可渲染文档(.md/.html)，1=静态资源(图片/css/js)
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, path)
);
```

### 1.3 磁盘存储结构

```
/data/workspaces/
  └── {workspace_id}/
       ├── brd(1)/
       │   ├── 01_MCP-Connector管理_BRD.md
       │   └── index.md
       ├── prd(1)/
       │   ├── assets/
       │   │   └── admin-console.png
       │   └── index.md
       ├── proto-v2/
       │   ├── index.html
       │   ├── blog.html
       │   ├── shared.css
       │   └── shared.js
       └── 产品管理规范.md
```

**存储规则**：
- 上传时直接将解压后的目录树写入此路径
- `sha1` 仅用于去重和文件一致性校验，**不按 sha1 分目录存储**

> **为什么不用按 sha1 存？** Workspace 的核心需求是保持原始目录结构以便通过相对路径 Serve。按 sha1 存储需要再做一次路径映射，抵消了"原始路径 Serve"方案的所有优势。

### 1.4 与现有 Collection / Document 的关系

| 实体 | 设计定位 | 操作粒度 | 文件类型 | 预览方式 |
|---|---|---|---|---|
| Collection | 精选知识集合 | 单文档 CRUD | .md/.html | srcdoc iframe |
| **Workspace** | 项目文件夹快照 | **整体操作** | 混合（含图片/CSS/JS） | `src=` iframe 真 URL |

**两套平行，互不耦合**。用户可以在 Collections 页和 Workspaces 页之间切换。

---

## 二、API 设计

### 2.1 Workspace CRUD

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| `GET` | `/api/workspaces` | 列表（含文件数、总大小） | ✅ |
| `POST` | `/api/workspaces` | 创建空工作空间 | ✅ |
| `GET` | `/api/workspaces/{id}` | 详情（含目录树结构） | ✅ |
| `PATCH` | `/api/workspaces/{id}` | 更新名称/描述 | ✅ |
| `DELETE` | `/api/workspaces/{id}` | 删除（清除磁盘 + DB） | ✅ |
| `POST` | `/api/workspaces/{id}/share` | 生成分享令牌 | ✅ |
| `DELETE` | `/api/workspaces/{id}/share` | 撤销分享令牌 | ✅ |

### 2.2 上传

```
POST /api/workspaces/{id}/upload  Content-Type: multipart/form-data
Body: file=@workspace.zip
```

- 后端接收 zip → 校验 → 解压 → 写磁盘 → 扫描文件 → 写入 `workspace_file` 表
- 解压时**自动排除**：`node_modules/`, `.git/`, `__pycache__/`, `.DS_Store`, 隐藏文件
- 安全校验：逐条检查路径，发现 `../` 或绝对路径立即拒绝
- 文件类型：**放宽限制**，允许常见文档和资源类型：
  - ✅ 文本类：`.md`, `.html`, `.htm`, `.json`, `.xml`, `.svg`
  - ✅ 图片类：`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`
  - ✅ 样式/脚本：`.css`, `.js`, `.mjs`
  - ✅ 字体：`.woff`, `.woff2`, `.ttf`, `.eot`
  - ✅ 文档：`.pdf`
  - ❌ 阻止可执行文件：`.exe`, `.bat`, `.sh`, `.dll`, `.so`, `.dmg`, `.msi`
- 单文件上限 10MB，总 zip 上限 500MB

### 2.3 文件 Serve（核心 - 认证态）

```
GET /api/workspaces/{id}/serve/{path}
```

- 返回原始文件，`Content-Type` 根据 mime_type 设置
- HTML 文件**不做 bleach 净化**（安全由 iframe sandbox 保障）

**认证方式**：由于 iframe 内无法发送 HTTP Header 中的 Authorization，采用两种方式：
1. **优先**：父页面向 iframe src 追加 JWT query param — `?jwt=xxx`
2. **备选**：如存在同名 cookie（适合同域部署），自动携带

后端按优先级检查：`Authorization header` → `jwt query param` → cookie

### 2.4 分享 Serve（核心 - 无需认证）

```
GET /api/workspaces/share/{token}/serve/{path}
```

- 通过分享令牌访问，无需 JWT 认证
- 路径匹配后直接返回文件内容
- 验证 token 有效后才响应
- HTML 同策略：不做 bleach 净化

### 2.5 目录树结构

```
GET /api/workspaces/{id}/tree
（分享路径: GET /api/workspaces/share/{token}/tree）
```

```json
{
  "name": "研发工作台设计",
  "type": "directory",
  "children": [
    { "name": "brd(1)", "type": "directory", "children": [
      { "name": "index.md", "type": "file", "path": "brd(1)/index.md", "is_asset": false }
    ]},
    { "name": "产品管理规范.md", "type": "file", "path": "产品管理规范.md", "is_asset": false },
    { "name": "prd(1)", "type": "directory", "children": [
      { "name": "assets", "type": "directory", "children": [
        { "name": "admin-console.png", "type": "file", "path": "prd(1)/assets/admin-console.png", "is_asset": true }
      ]}
    ]}
  ]
}
```

### 2.6 MD 内容接口（带路径重写）

```
GET /api/workspaces/{id}/serve/{path}?render=md
```

返回 MD 原文，但其中的**图片引用路径被重写为绝对 URL**。

**重写逻辑**：

```
MD 文件路径:  prd(1)/02_工具能力中心_PRD.md
基准目录:     prd(1)/

MD 原文:      ![架构图](assets/admin-console.png)
重写为:       ![架构图](/api/workspaces/1/serve/prd(1)/assets/admin-console.png)
```

正则匹配 `![alt](path)` 和 `<img src="path">` 中的路径：
- 外部 URL（`http://`/`https://`/`//`/`data:`）→ 不处理
- 绝对路径（`/` 开头）→ 不处理
- 相对路径 → 拼接基准目录 → 改为绝对 URL

**MD 内部链接策略**：

| 链接目标 | 行为 |
|---|---|
| 外部 URL（http/https 开头） | 新窗口打开（_blank） |
| 工作空间内的 .md/.html 文件 | 前端拦截导航，切换视图到目标文档 |
| 其他资源 | 直接下载或打开 |

---

## 三、前端改造

### 3.1 新增页面与组件

```
src/pages/
  Workspaces.tsx           -- 工作空间列表页
  WorkspaceDetail.tsx      -- 工作空间详情（目录树 + 查看器）
  SharedWorkspace.tsx      -- 公开分享只读页面

src/components/
  WorkspaceTree.tsx        -- 目录树组件
```

### 3.2 路由

```tsx
<Route path="/workspaces" element={<RequireAuth><Workspaces /></RequireAuth>} />
<Route path="/workspaces/:id" element={<RequireAuth><WorkspaceDetail /></RequireAuth>} />
<Route path="/share/workspace/:token" element={<SharedWorkspace />} />
```

### 3.3 HTML 渲染（核心）

```tsx
// 认证态
<iframe
  src={`/api/workspaces/${id}/serve/proto-v2/index.html?jwt=${token}`}
  sandbox="allow-scripts"
  style={{ width: '100%', height: '100%', border: 'none' }}
/>

// 分享态
<iframe
  src={`/api/workspaces/share/${shareToken}/serve/proto-v2/index.html`}
  sandbox="allow-scripts"
  style={{ width: '100%', height: '100%', border: 'none' }}
/>
```

**所有相对路径由浏览器原生解析**——图片、CSS、JS、链接跳转全部自动工作。

### 3.4 MD 渲染

使用现有 `MarkdownViewer` 组件，配合后端已重写图片路径的 MD 内容。

内部链接导航增强：
```tsx
// MarkdownViewer 中拦截链接点击
root.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  const href = a.getAttribute('href')
  if (!href || href.startsWith('http')) return
  
  // 检测是否为工作空间内部链接（指向 /api/workspaces/{id}/serve/...）
  const match = href.match(/\/api\/workspaces\/\d+\/serve\/(.+)/)
  if (match) {
    e.preventDefault()
    // 触发工作空间视图切换，加载目标文件
    navigateToFile(match[1])  // 在 WorkspaceDetail 中切换选中文件和内容
  }
})
```

### 3.5 iframe 交互增强

在现有 RESIZE_SCRIPT 中新增（HTML 注入脚本）：

```javascript
// 页面加载后通知父窗口当前路径
parent.postMessage({
  type: 'kb-navigate',
  path: window.location.pathname
}, '*');

// 监听 hash 变化
window.addEventListener('hashchange', function() {
  parent.postMessage({
    type: 'kb-navigate',
    path: window.location.pathname + window.location.hash
  }, '*');
});
```

父窗口监听消息，高亮文件树中当前文件。

### 3.6 页面布局

```
┌──────────────────────────────────────────────────┐
│  ← 返回   研发工作台设计    [分享] [删除]         │
├──────────────┬───────────────────────────────────┤
│  目录树       │  文件预览区域                      │
│              │                                   │
│  📁 brd(1)/  │  ┌─ iframe (html) ──────────┐    │
│   📄 index.md │  │  浏览器原生渲染，全部      │    │
│  📁 prd(1)/  │  │  相对路径自动加载          │    │
│   📄 PRD.md  │  │  链接点哪跳哪              │    │
│   📁 assets/ │  └──────────────────────────┘    │
│    🖼 x.png  │                                   │
│   📄 index.md│  或：                            │
│  📁 proto-v2/│  ┌─ MarkdownViewer ──────────┐    │
│   📄 index.html│  │  # 标题                   │    │
│   📄 blog.html│  │  ![图](已重写的绝对路径)    │    │
│   🎨 shared.css│  │  [链接] → 触发内部导航    │    │
│              │  └──────────────────────────┘    │
├──────────────┴───────────────────────────────────┤
│  底部：23 个文件 · 2.3 MB                        │
└──────────────────────────────────────────────────┘
```

### 3.7 分享页面

`SharedWorkspace.tsx` 与 `WorkspaceDetail.tsx` 共享大部分 UI 组件：
- 取消上传/删除/编辑按钮
- 目录树 + 查看器主体结构复用
- iframe src 路径指向分享 Serve API

---

## 四、安全设计

### 4.1 路径遍历防护

```python
import os

def safe_join(storage_path: str, user_path: str) -> str:
    full = os.path.normpath(os.path.join(storage_path, user_path.lstrip("/")))
    if not full.startswith(os.path.normpath(storage_path)):
        raise HTTPException(403, "路径越权")
    return full
```

### 4.2 上传安全

- zip 解压逐条检查，拒绝 `../` 和绝对路径
- 自动跳过 `.` 开头隐藏文件和排除目录（`node_modules/`, `.git/` 等）
- 总和上限 500MB

### 4.3 渲染安全

- HTML **不做 bleach 净化**（保证 JS/CSS 完整运行）
- 安全完全依赖 iframe sandbox：`sandbox="allow-scripts"`
- 绝不加 `allow-same-origin`
- 分享 Serve 路径与认证 Serve 路径隔离，不混淆

### 4.4 JWT 在 URL 中的安全性

- iframe src 中的 `?jwt=xxx` 仅用于程序化构造的 URL，不会被用户收藏或分享
- 分享态使用 token 代替，不存在 JWT 泄露问题
- HTTPS 传输加密

---

## 五、实现优先级

### P0 - MVP 核心流程

1. 数据模型 + 迁移（workspace + workspace_file 表）
2. zip 上传解压（`POST /api/workspaces/{id}/upload`）
3. 文件 Serve 认证态（`GET /api/workspaces/{id}/serve/{path}`）
4. 目录树 API（`GET /api/workspaces/{id}/tree`）
5. 前端 Workspaces 列表页 + WorkspaceDetail（目录树 + HTML iframe 渲染）
6. 路径遍历防护

### P1 - 常用功能

7. 分享机制（share_token 生成 / 分享 Serve / SharedWorkspace 页面）
8. MD 渲染 + 图片路径重写
9. HTML iframe 内路径同步（文件树高亮）
10. MD 内部链接导航

### P2 - 增强体验

11. 删除工作空间（磁盘 + DB 清理）
12. CLI `kb workspace` 命令（push / list / delete）
13. 增量更新（替换单个文件）
14. 上传进度反馈

---

## 六、需要你确认的问题 ✅（已确认）

| 问题 | 你的决定 |
|---|---|
| A. 分享机制 | **✅ 需要**，视为核心价值 |
| B. MD 渲染方式 | **✅ 方式①** react-markdown + 路径重写 |
| C. 文件类型限制 | **✅ 放宽**，白名单排除可执行文件即可 |
