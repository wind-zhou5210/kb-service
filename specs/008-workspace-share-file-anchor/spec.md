# 工作空间分享文件级锚点（深链）需求规范

Version: 1.0
Created: 2026-09-01
Status: Draft

## 1. 概述

### 1.1 背景

工作空间分享（`/share/workspace/{token}`）目前是整空间粒度的只读链接：接收者打开后默认展示目录树中第一个文件（深度优先 + 字母序，如 `agent.html`）。当分享者实际想指向某个特定文件（如 `todo.html`）时，接收者需要自己在目录树中二次寻找，体验断裂且容易看错内容。

代码层面的根因：

| 环节 | 现状 | 问题 |
|------|------|------|
| 分享页加载 | `SharedWorkspace.tsx` 只做 `findFirstFile()` 自动选第一个文件 | 完全不消费 URL 中的 `?file=` 参数 |
| 目录树右键"复制链接" | `WorkspaceTree.tsx` 生成 `{origin}{pathname}?file={path}` | 在分享页生成的链接因页面不消费参数而失效 |
| 登录态详情页 | `WorkspaceDetail.tsx` 已实现 `?file=` 深链消费（`hasFile` 校验） | 分享页缺同款逻辑 |
| 分享弹窗 | `WorkspaceDetail.tsx` 只生成整空间链接 | 无"直达当前文件"的链接入口 |

### 1.2 目标

让工作空间分享链接支持**文件级精确定位**：

1. 分享 URL 可携带目标文件参数，接收者打开即直达该文件（目录树同步高亮）
2. 支持**文件内锚点**（`#section`），直达文件内的具体标题/元素
3. 分享者在详情页预览文件时可一步复制"当前文件直链"

### 1.3 范围

**MVP（本次实现）**：

| 功能 | 说明 |
|------|------|
| 分享页深链消费 | `?file=` 命中即选中并渲染目标文件，校验失败回退第一个文件 |
| 地址栏双向同步 | 分享页内切换文件时地址栏 `?file=` 实时更新，随时可复制传播 |
| 分享弹窗文件直链 | 详情页分享弹窗新增"当前文件直链"复制入口 |
| 文件内锚点透传 | HTML 经 iframe src hash 原生滚动；MD 渲染后 scrollIntoView |
| 顺带修复 | 分享页目录树右键"复制链接"因深链消费而自动生效 |

**不在本次范围（后续迭代）**：

| 功能 | 说明 |
|------|------|
| 后端改动 | serve/tree/token 端点均不变，纯前端实现 |
| CLI 改动 | `kb share` 无 workspace 子命令 |
| 登录态详情页 URL 同步 | 保持现状"消费即清"，避免影响既有交互 |
| 分享粒度权限控制 | 深链只是展示定位，不是访问控制（token 仍授权整空间只读） |
| 浏览器前进/后退按文件粒度导航 | replace 模式不产生历史条目 |

### 1.4 成功指标

- 分享 `?file=todo.html` 链接，接收者打开后首屏即 todo.html（无二次点击）
- 分享者从"正在预览文件"到"复制文件直链"1 步完成（分享弹窗内）
- 分享页内任意时刻复制地址栏 URL，他人打开均直达"复制时刻所在文件"
- 后端零改动、零新增依赖

---

## 2. 用户分析

### 2.1 目标用户

| 角色 | 场景 | 诉求 |
|------|------|------|
| 分享者（知识库维护者） | 想把工作空间中的某个页面发给同事评审 | 链接直达目标文件，不让对方在目录树里找 |
| 接收者（访客，无需登录） | 打开分享链接 | 直接看到被分享的内容，而非字母序第一个文件 |

### 2.2 用户故事

**作为** 正在预览工作空间文件的分享者
**我想要** 在分享弹窗里直接复制"当前文件直链"
**以便于** 接收者打开链接后直达我正在看的文件

**作为** 分享链接的接收者
**我想要** 在浏览过程中随时复制地址栏链接发给同事
**以便于** 同事打开后看到的是我当前正在看的文件（而非默认首页）

### 2.3 用户旅程

```
分享者：详情页预览 todo.html → 点「分享」
      │
      ▼
弹窗展示两条链接：整空间链接 + 当前文件直链（?file=todo.html）
      │
      ▼
复制「当前文件直链」发给接收者
      │
      ▼
接收者：打开链接 → 右侧直接渲染 todo.html，目录树高亮
      │
      ▼
接收者浏览到 blog.html 想转给同事 → 复制地址栏
（地址栏已自动同步为 ?file=blog.html）→ 同事打开直达 blog.html
```

---

## 3. 功能需求

### 3.1 核心功能

| 编号 | 功能点 | 描述 | 优先级 | 验收标准 |
|------|--------|------|--------|----------|
| F1 | 深链消费 | 分享页加载时消费 `?file=` 参数选中目标文件 | P0 | 命中则直达；非法/失效回退第一个文件 |
| F2 | 地址栏同步 | 分享页内切换文件时实时更新 `?file=` | P0 | 地址栏始终反映当前文件，replace 不产生历史条目 |
| F3 | 文件直链入口 | 分享弹窗新增"当前文件直链"复制 | P0 | 有选中文件时展示，无则隐藏 |
| F4 | 文件内锚点 | `#锚点` 直达文件内标题/元素 | P1 | HTML iframe 内滚动；MD 滚动到标题 |
| F5 | 右键复制链接修复 | 分享页目录树右键"复制链接"生效 | P0 | F1 的副产品，零额外代码 |

### 3.2 URL 深链格式（核心契约）

```
https://host/share/workspace/{token}                            ← 整空间（现状，保持）
https://host/share/workspace/{token}?file=todo.html             ← 直达文件
https://host/share/workspace/{token}?file=docs/guide.md#setup   ← 直达文件内锚点
```

**设计决策**：

- **`?file=` 用查询参数而非 hash**：与登录态 `WorkspaceDetail` 现有深链约定一致；`WorkspaceTree.copyLink` 已生成此格式（分享页补消费逻辑后自动修复）；hash 位留给"文件内锚点"，两层定位语义互不冲突
- **文件路径需 `encodeURIComponent`**：支持中文/空格/特殊字符路径
- **锚点为 rehype-slug 生成的标题 id**（MD）或 HTML 内元素 id

### 3.3 功能详细说明

#### F1：深链消费（`SharedWorkspace.tsx`）

- 树加载完成后读取 `?file=` 参数，经 `hasFile(treeData, path)` 校验（目录树中真实存在）后 `setSelectedFile`
- 校验失败（文件已删除/路径非法/参数缺失）→ 回退现有 `findFirstFile` 逻辑
- 路径穿越（`?file=../xxx`）在树校验层即失败；即使穿透到请求层，后端 `_safe_join` 拒绝（双保险）

#### F2：地址栏同步（`SharedWorkspace.tsx`）

- `selectedFile` 变化时以 `history.replaceState` 直改地址栏 `?file={path}`（保留 hash）
- **选 replaceState 而非 `setSearchParams` 的原因**：后者触发 react-router 导航 → `searchParams` 引用变化 → `load` 依赖变化重新拉取 tree 且全屏 Spin 闪烁；replaceState 零重渲染、显式保留 hash、无循环
- 已同步（参数值相同）时跳过，避免无意义写 URL
- 深链参数仅在首次加载消费（闭包捕获初始 URL），后续地址栏由本 effect 单向维护

#### F3：文件直链入口（`WorkspaceDetail.tsx`）

- `handleShare` 成功后，若 `selectedFileRef.current` 非空则构造 `{origin}/share/workspace/{token}?file={encodeURIComponent(path)}`
- 弹窗内整空间链接下方新增第二个 `Input.Search`（readOnly + 复制按钮），无选中文件时不渲染
- 用 `selectedFileRef` 读最新选中路径，避免闭包旧快照

#### F4：文件内锚点

- **进入时捕获**：组件挂载从 `window.location.hash` 读锚点存入 state（`decodeURIComponent` 容错）
- **HTML**：iframe src 追加 `#{anchor}`，浏览器原生滚动（`sandbox="allow-scripts"` 不影响原生锚点定位）
- **MD**：`mdContent` 渲染完成后 `setTimeout` 120ms，`document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' })`（rehype-slug 已为标题生成 id；滚动容器为 main，scrollIntoView 会滚动最近可滚动祖先）
- **切换文件清除**：`handleSelectFile` / iframe 内 `ws-navigate` 事件触发切换时，清空锚点 state 并 `replaceState` 清掉 URL hash，避免锚点串到别的文件
- **锚点不存在**：`getElementById` 返回 null 静默忽略；HTML 原生行为同理

---

## 4. 数据需求

### 4.1 API 设计

无任何后端改动。涉及的前端请求均为现有端点：

| 端点 | 用途 | 变化 |
|------|------|------|
| `GET /api/workspaces/share/{token}` | 分享页工作空间元信息 | 无 |
| `GET /api/workspaces/share/{token}/tree` | 目录树（深链校验数据源） | 无 |
| `GET /api/workspaces/share/{token}/serve/{path}` | 文件内容（HTML iframe src 可带 hash） | 无 |

### 4.2 数据操作

| 数据 | 操作 | 说明 |
|------|------|------|
| URL query（`?file=`） | 读（首次）/ 写（replaceState） | 前端浏览器行为 |
| URL hash（`#锚点`） | 读（挂载）/ 清（切换文件） | 前端浏览器行为 |
| 目录树 | 只读 | `hasFile` 深链校验 |

无表结构变更、无数据迁移。

### 4.3 业务规则校验

| 规则 | 校验方式 |
|------|----------|
| `?file=` 必须是目录树中真实文件 | `hasFile` 递归校验，失败回退第一个文件 |
| 路径穿越防护 | 树校验层 + 后端 `_safe_join` 双保险 |
| 分享 token 有效性 | 现有逻辑不变（无效显示错误页） |
| 深链非访问控制 | token 仍授权整空间只读，`?file=` 仅决定初始展示 |

---

## 5. 非功能需求

### 5.1 性能要求

- 地址栏同步用 `replaceState`，零组件重渲染、零 API 重复请求
- 深链消费复用首次树加载（`Promise.all` 既有请求），无额外请求
- MD 锚点滚动 120ms 延迟一次性开销，可忽略

### 5.2 安全要求

- `?file=` 不直接拼接到任何后端请求 URL 之外的敏感位置；HTML src 拼接的路径经 `hasFile` 树校验（与后端 `_safe_join` 双保险）
- `decodeURIComponent` 异常容错，不抛错
- 深链不改变分享权限模型：拿到链接的任何人仍只能读整空间（与现状一致）

### 5.3 兼容性要求

- 无 `?file=` 的旧分享链接行为完全不变（回退第一个文件）
- 登录态详情页 `?file=` 深链行为不变（消费即清）
- 地址栏 hash 中的非 ASCII 锚点由浏览器自动 percent-encode/decode

---

## 6. 边缘情况与异常处理

| 场景 | 处理方式 |
|------|----------|
| `?file=` 指向不存在/已删除文件 | `hasFile` 校验失败 → 回退第一个文件，地址栏被同步 effect 自动"修正" |
| `?file=../etc/passwd` 路径穿越 | 树中无此路径 → 回退；后端 `_safe_join` 兜底 |
| 中文/空格/特殊字符文件路径 | 生成侧 `encodeURIComponent`，消费侧 `URLSearchParams.get` 自动解码 |
| hash 指向文件内不存在的锚点 | `getElementById` 为 null 静默忽略；HTML 原生同理，不报错 |
| 切换文件后残留旧 hash | `clearFileAnchor` 同步清 state 与 URL hash |
| 刷新页面 | URL 已含当前 `?file=`（同步过），重新直达同一文件；hash 重新捕获重新定位 |
| MD 内容加载失败 | 现有 `message.error` 逻辑不变，锚点 effect 因 `mdContent` 为空不触发 |
| token 失效/撤销 | 现有错误页逻辑不变 |
| 移动端 Drawer 内切换文件 | `handleSelectFile` 统一走清锚点逻辑 |

---

## 7. 验收标准

### 7.1 功能验收

- [ ] 打开 `/share/workspace/{token}?file=todo.html` → 右侧直接渲染 todo.html，目录树高亮该文件
- [ ] `?file=不存在.md` → 回退第一个文件，无白屏无报错，地址栏被修正为实际文件
- [ ] 分享页内切换文件 → 地址栏 `?file=` 实时更新；浏览器后退按钮不产生文件级历史跳转
- [ ] 分享页任意时刻复制地址栏 URL → 他人打开直达该文件
- [ ] 分享页目录树右键 todo.html「复制链接」→ 他人打开直达 todo.html（原失效功能修复）
- [ ] 详情页预览 todo.html 时点「分享」→ 弹窗含"当前文件直链"，复制打开直达
- [ ] 详情页无选中文件时点「分享」→ 弹窗只展示整空间链接
- [ ] 带 `#锚点` 打开 HTML → iframe 内滚动到锚点元素
- [ ] 带 `#锚点` 打开 MD → 滚动到对应标题（rehype-slug id）
- [ ] 带 `#不存在锚点` 打开 → 正常展示文件，不滚动不报错
- [ ] 深链进入后切换到其他文件 → URL hash 被清除，不串锚点
- [ ] 无 `?file=` 的旧链接打开 → 行为与改动前完全一致

### 7.2 质量验收

- [ ] `npx tsc --noEmit` 通过
- [ ] 切换文件无全屏 Spin 闪烁（无重复 tree 请求）
- [ ] 后端代码零 diff

---

## 8. 附录

### 8.1 技术方案备选记录

| 方案 | 结论 |
|------|------|
| `?file=` 查询参数承载文件路径 | **采用**：与详情页既有深链约定一致，右键复制链接自动修复 |
| `#file=` hash 承载文件路径 | 否决：与文件内锚点语义冲突，需自定义解析 |
| `setSearchParams` 同步地址栏 | 否决：触发 react-router 导航 → `load` 重跑 → 重复请求 + Spin 闪烁 |
| `history.replaceState` 直改地址栏 | **采用**：零重渲染、hash 显式保留、无循环 |
| 后端支持路径型分享路由（`/share/workspace/{token}/file/{path}`） | 否决：需要后端/前端路由双改动，收益与 query 参数相同 |
| MD 锚点用 scrollIntoView | **采用**：rehype-slug 已有 id，零新依赖 |

### 8.2 参考资料

- 分享页：`frontend/src/pages/SharedWorkspace.tsx`
- 详情页（深链参照 + 分享弹窗）：`frontend/src/pages/WorkspaceDetail.tsx`
- 目录树（右键复制链接）：`frontend/src/components/WorkspaceTree.tsx`
- HTML 沙箱（iframe src 模式）：`frontend/src/components/HtmlSandbox.tsx`
- MD 渲染（rehype-slug）：`frontend/src/components/MarkdownViewer.tsx`
- 工作空间设计文档：`docs/plans/2026-07-27-workspace-design.md`
- 前序 spec：`specs/005-workspace-download/spec.md`

### 8.3 修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| 1.0 | 2026-09-01 | wb_zhouzheng | 初稿 |
