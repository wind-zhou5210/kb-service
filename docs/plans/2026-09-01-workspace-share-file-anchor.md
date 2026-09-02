# 工作空间分享文件级锚点（深链）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作空间分享链接支持文件级精确定位：`?file=` 深链直达目标文件（如 todo.html，而非默认的 agent.html），`#锚点` 直达文件内标题；分享弹窗提供"当前文件直链"一步复制；顺带修复分享页目录树右键"复制链接"失效问题。

**Architecture:** 纯前端实现，后端零改动。`SharedWorkspace.tsx` 加载时消费 `?file=` 参数（`hasFile` 树校验 + 失败回退），切换文件时用 `history.replaceState` 单向同步地址栏（不经 react-router 导航，避免重复加载）；文件内锚点经 iframe src hash（HTML）/ scrollIntoView（MD）实现；`WorkspaceDetail.tsx` 分享弹窗新增基于 `selectedFileRef` 的文件直链。

**Tech Stack:** React 18 + react-router-dom 6 + Ant Design 5（零新依赖）

**Spec:** `specs/008-workspace-share-file-anchor/spec.md`

---

### Task 1: 分享页深链消费 + 地址栏同步 + 锚点透传

**Files:**
- Modify: `frontend/src/pages/SharedWorkspace.tsx`

- [x] **Step 1: 新增 fileAnchor state（进入时捕获 URL hash）**

在 `contentLoading` state 声明后新增：

```tsx
// 文件内锚点：进入时从 URL hash（#锚点）捕获，切换文件时清除
const [fileAnchor, setFileAnchor] = useState(() => {
  const h = window.location.hash
  if (!h) return null
  try { return decodeURIComponent(h.slice(1)) } catch { return h.slice(1) }
})
```

- [x] **Step 2: load() 消费 `?file=` 深链**

将 `load` 内 `// Auto-select first file` 逻辑替换为（`hasFile` 校验优先，失败回退第一个文件；用 `window.location.search` 直接读初始 URL，避免闭包语义混乱）：

```tsx
// 深链：?file= 命中即选中（hasFile 校验，防非法/失效路径）；否则回退第一个文件。
// 仅在首次加载时消费（闭包捕获初始 URL），后续地址栏由下方同步 effect 维护
const fileParam = new URLSearchParams(window.location.search).get('file')
if (fileParam && hasFile(treeData, fileParam)) {
  setSelectedFile(fileParam)
} else if (!selectedFile && treeData.length > 0) {
  const first = findFirstFile(treeData)
  if (first) setSelectedFile(first)
}
```

- [x] **Step 3: 新增地址栏同步 effect**

`useEffect(() => { load() }, [load])` 之后新增（关键决策：用 `history.replaceState` 而非 `setSearchParams`——后者触发 react-router 导航导致 `load` 重跑、重复请求 tree 且全屏 Spin 闪烁）：

```tsx
// 深链同步：切换文件时更新地址栏 ?file=，随时可从地址栏复制传播"当前文件"链接。
// 用 replaceState 直改 URL（保留 hash、replace 不污染历史栈），不经 react-router
// 导航，避免触发组件重加载
useEffect(() => {
  if (!selectedFile) return
  const params = new URLSearchParams(window.location.search)
  if (params.get('file') === selectedFile) return
  params.set('file', selectedFile)
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
}, [selectedFile])
```

- [x] **Step 4: HTML 分支拼锚点 + MD 锚点滚动 effect**

内容加载 effect 的 HTML 分支改为（`fileAnchor` 进依赖数组）：

```tsx
// 文件内锚点：拼到 iframe src 的 hash，加载后浏览器原生滚动定位
setHtmlSrc(`/api/workspaces/share/${token}/serve/${selectedFile}${fileAnchor ? `#${fileAnchor}` : ''}`)
```

依赖数组 `[selectedFile, token]` → `[selectedFile, token, fileAnchor]`。其后新增 MD 锚点滚动 effect：

```tsx
// MD 文件内锚点：内容渲染完成后滚动到目标标题（rehype-slug 已为标题生成 id）
useEffect(() => {
  if (!fileAnchor || !mdContent) return
  if (!selectedFile?.endsWith('.md')) return
  // 渲染/高亮完成后再定位，避免目标元素尚未挂载
  const t = setTimeout(() => {
    document.getElementById(fileAnchor)?.scrollIntoView({ behavior: 'smooth' })
  }, 120)
  return () => clearTimeout(t)
}, [fileAnchor, mdContent, selectedFile])
```

- [x] **Step 5: 切换文件时清除锚点**

新增 `clearFileAnchor`（useCallback，进 ws-navigate effect 依赖数组），`handleSelectFile` 与 iframe `ws-navigate` 事件处理器中切换前调用：

```tsx
// 清除文件内锚点（state + URL hash），切换文件时调用，避免锚点串到别的文件
const clearFileAnchor = useCallback(() => {
  setFileAnchor(null)
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}, [])
```

`handleSelectFile` 开头加 `if (path !== selectedFile) clearFileAnchor()`。

- [x] **Step 6: 新增 hasFile helper**

文件底部（`findFirstFile` 之后）新增，从 `WorkspaceDetail.tsx` 复制：

```tsx
// Helper: 目录树中是否存在指定文件路径（深链校验，防非法/失效路径）
function hasFile(nodes: WorkspaceTreeNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === path) return true
    if (node.children && hasFile(node.children, path)) return true
  }
  return false
}
```

### Task 2: 分享弹窗新增"当前文件直链"

**Files:**
- Modify: `frontend/src/pages/WorkspaceDetail.tsx`

- [x] **Step 1: 新增 fileShareUrl state**

`shareUrl` state 声明后新增：

```tsx
// 当前文件直链：分享弹窗内可选复制，打开后直达正在预览的文件（无选中文件时不展示）
const [fileShareUrl, setFileShareUrl] = useState('')
```

- [x] **Step 2: handleShare 构造文件直链**

`handleShare` 中 `setShareUrl(...)` 之后新增（用 `selectedFileRef.current` 读最新选中路径，避免闭包旧快照）：

```tsx
// 用 ref 读最新选中路径，避免闭包旧快照
setFileShareUrl(selectedFileRef.current
  ? `${window.location.origin}/share/workspace/${share_token}?file=${encodeURIComponent(selectedFileRef.current)}`
  : '')
```

- [x] **Step 3: 新增 copyFileShareUrl + 弹窗 UI**

`copyShareUrl` 之后新增同构的 `copyFileShareUrl`；分享弹窗内整空间 `Input.Search` 之后新增（有直链才渲染）：

```tsx
{fileShareUrl && (
  <>
    <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 16, marginBottom: 12 }}>
      当前文件直链 — 打开后直接定位到正在预览的文件：
    </p>
    <Input.Search value={fileShareUrl} readOnly enterButton="复制" onSearch={copyFileShareUrl} />
  </>
)}
```

### Task 3: 验证

- [x] **Step 1: 类型与构建检查**

```bash
cd frontend && npx tsc --noEmit
```

- [x] **Step 2: 手动验收**

按 `specs/008-workspace-share-file-anchor/spec.md` 第 7 节清单逐项验证（深链直达 / 回退 / 地址栏同步 / 右键复制链接修复 / 弹窗直链 / 锚点定位与清除 / 旧链接兼容）。
