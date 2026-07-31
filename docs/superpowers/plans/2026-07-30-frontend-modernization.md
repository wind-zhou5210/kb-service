# 前端体验现代化优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 kb-service 前端的体验现代化优化，覆盖视觉设计升级、导航效率提升、工作空间交互增强、移动端适配、状态管理与性能优化、可访问性改进

**Architecture:** 在现有 React 18 + Vite + Ant Design 5 + Zustand 架构上渐进增强，不更换核心框架。通过抽取通用组件（FilePreviewCard、DualLayoutPage、FormModal）减少重复、引入 Zustand store 缓存列表数据消除重复请求、路由级代码分割降低首屏负载

**Tech Stack:** React 18, TypeScript, Vite, Ant Design 5, Zustand, react-router-dom 7, @dnd-kit

**测试说明:** 项目当前无自动化测试框架，采用"实现 + 手动验证（`npm run build` + 浏览器走查）"模式。前端目录为 `frontend/`，开发用 `npm run dev`（HMR 自动更新），构建校验用 `npm run build`（`tsc -b && vite build`）。以下所有路径均相对于 `frontend/src/`（除非另有说明）。任务顺序即推荐实施顺序（P0-4/P0-5 无依赖优先，面包屑依赖 store）。

---

## Task 1: 暗色变量补全 + :focus-visible 焦点环（P0-4，spec 2.2）

**Files:**
- Modify: `src/index.css`

**Dependencies:** 无（最先做，为后续 a11y 与状态样式提供基础变量）

- [ ] **Step 1: `:root` 补充 4 个状态变量**

在 `src/index.css` 的 `:root` 块内、`--ease: cubic-bezier(0.4, 0, 0.2, 1);` 之后（`}` 之前）追加：

```css
  /* ---- 状态变量：焦点环 / 禁用 / 弱分隔线 / 遮罩 ---- */
  --focus-ring: rgba(79, 70, 229, 0.35);   /* 键盘焦点环，基于 --accent */
  --disabled: #A1A1AA;                      /* 禁用态文字/图标 */
  --divider: #F4F4F5;                       /* 弱分隔线（比 --border 更浅） */
  --backdrop: rgba(0, 0, 0, 0.45);          /* Modal/Drawer 遮罩 */
```

- [ ] **Step 2: `[data-theme="dark"]` 补充对应暗色值**

在 `[data-theme="dark"]` 块内、`--shadow-md: 0 2px 8px rgba(0,0,0,0.4);` 之后（`}` 之前）追加：

```css
  --focus-ring: rgba(129, 140, 248, 0.4);   /* 基于暗色 --accent #818CF8 */
  --disabled: #52525B;
  --divider: #1F1F23;
  --backdrop: rgba(0, 0, 0, 0.65);
```

- [ ] **Step 3: 追加全局 `:focus-visible` 焦点样式**

在 `src/index.css` 的 `.page-fade { animation: fade 0.2s var(--ease); }` 之后追加：

```css
/* ---- 键盘焦点环（仅键盘导航可见，鼠标点击不触发） ---- */
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: 2px; }
```

- [ ] **Step 4: 验证构建**

Run: `cd frontend; npm run build`
Expected: `tsc -b && vite build` 零错误。浏览器 Tab 键聚焦顶栏按钮出现焦点环，鼠标点击不出现；切换亮/暗主题无闪烁。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(frontend): 补全暗色状态变量并添加 :focus-visible 焦点环"
```

---

## Task 2: workspaceStore / collectionStore（P0-5，spec 5.1）

**Files:**
- Create: `src/store/workspace.ts`
- Create: `src/store/collection.ts`
- Modify: `src/store/auth.ts`（logout 时清空两个 store）
- Modify: `src/pages/Workspaces.tsx`
- Modify: `src/pages/Collections.tsx`

**Dependencies:** 无（基础设施，面包屑 Task 5 依赖 `current` 字段）

- [ ] **Step 1: 新建 `src/store/workspace.ts`**

仿照现有 `store/auth.ts` / `store/theme.ts` 的 zustand 风格，复用 `api.listWorkspaces` / `api.getWorkspace`：

```ts
import { create } from 'zustand'
import { api, type Workspace } from '../api/client'

interface WorkspaceStore {
  list: Workspace[]
  loaded: boolean                 // 首次列表加载完成标记
  current: Workspace | null       // 详情页当前空间（面包屑数据源）
  fetchList: (force?: boolean) => Promise<void>
  mutate: () => Promise<void>     // 增删改后强制刷新
  setCurrent: (ws: Workspace | null) => void
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  list: [],
  loaded: false,
  current: null,
  fetchList: async (force = false) => {
    if (get().loaded && !force) return           // 缓存命中直接返回
    const list = await api.listWorkspaces()
    set({ list, loaded: true })
  },
  mutate: async () => {
    const list = await api.listWorkspaces()
    set({ list, loaded: true })
  },
  setCurrent: (ws) => set({ current: ws }),
  reset: () => set({ list: [], loaded: false, current: null }),
}))
```

- [ ] **Step 2: 新建 `src/store/collection.ts`**

```ts
import { create } from 'zustand'
import { api, type Collection } from '../api/client'

interface CollectionStore {
  list: Collection[]
  loaded: boolean
  current: Collection | null
  fetchList: (force?: boolean) => Promise<void>
  mutate: () => Promise<void>
  setCurrent: (c: Collection | null) => void
  reset: () => void
}

export const useCollectionStore = create<CollectionStore>((set, get) => ({
  list: [],
  loaded: false,
  current: null,
  fetchList: async (force = false) => {
    if (get().loaded && !force) return
    const list = await api.listCollections()
    set({ list, loaded: true })
  },
  mutate: async () => {
    const list = await api.listCollections()
    set({ list, loaded: true })
  },
  setCurrent: (c) => set({ current: c }),
  reset: () => set({ list: [], loaded: false, current: null }),
}))
```

- [ ] **Step 3: `auth.ts` logout 时清空两个 store**

修改 `src/store/auth.ts` 的 `logout`，避免循环 import（store 模块内动态导入）：

```ts
  logout: () => {
    localStorage.removeItem('kb_token')
    set({ token: null })
    // 清空业务缓存，防止换账号后残留旧数据
    import('./workspace').then((m) => m.useWorkspaceStore.getState().reset())
    import('./collection').then((m) => m.useCollectionStore.getState().reset())
  },
```

- [ ] **Step 4: `Workspaces.tsx` 接入 store**

替换本地 `list`/`load` 逻辑：删除 `const [list, setList] = useState<Workspace[]>([])`，改用 store；写操作后调 `mutate()`。关键片段：

```tsx
import { useWorkspaceStore } from '../store/workspace'

export default function Workspaces() {
  const list = useWorkspaceStore((s) => s.list)
  const loaded = useWorkspaceStore((s) => s.loaded)
  const fetchList = useWorkspaceStore((s) => s.fetchList)
  const mutate = useWorkspaceStore((s) => s.mutate)
  const [loading, setLoading] = useState(!loaded)   // 缓存命中不显示骨架
  // ...
  useEffect(() => {
    fetchList().finally(() => setLoading(false))
  }, [fetchList])
```

`handleCreate` 末尾 `load()` 改为 `await mutate()`；`handleDelete` 的 `onOk` 内 `load()` 改为 `await mutate()`。

- [ ] **Step 5: `Collections.tsx` 接入 store**

同构改造：`list` 来自 `useCollectionStore`，`load()` 全部替换为 `mutate()`（`handleCreate`/`handleEditSave`/`handleDelete`/`handleShare`/`handleRevokeShare`/`handleDragEnd` 后）。`handleDragEnd` 中乐观更新仍需本地临时排序，改为直接 `useCollectionStore.setState({ list: reordered })` 后再批量 `updateCollection`，最后 `mutate()`：

```tsx
import { useCollectionStore } from '../store/collection'

  const list = useCollectionStore((s) => s.list)
  const loaded = useCollectionStore((s) => s.loaded)
  const fetchList = useCollectionStore((s) => s.fetchList)
  const mutate = useCollectionStore((s) => s.mutate)
  const [loading, setLoading] = useState(!loaded)

  useEffect(() => { fetchList().finally(() => setLoading(false)) }, [fetchList])

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = list.findIndex((c) => c.id === active.id)
    const newIndex = list.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = [...list]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    useCollectionStore.setState({ list: reordered })   // 乐观更新
    await Promise.all(reordered.map((c, i) => api.updateCollection(c.id, { sort_order: i })))
    await mutate()
  }
```

- [ ] **Step 6: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。浏览器：进入列表 → 详情 → 返回，Network 面板无重复 `GET /api/workspaces`（或 `/collections`）请求；新建/删除后列表即时更新；退出登录后重新登录列表为新账号数据。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/workspace.ts frontend/src/store/collection.ts frontend/src/store/auth.ts frontend/src/pages/Workspaces.tsx frontend/src/pages/Collections.tsx
git commit -m "feat(frontend): 新增 workspaceStore/collectionStore 缓存列表消除重复请求"
```

---

## Task 3: WorkspaceDetail 移动端 Drawer 化 + 44px 触摸目标（P0-2，spec 3.4）

**Files:**
- Create: `src/hooks/useMediaQuery.ts`
- Modify: `src/pages/WorkspaceDetail.tsx`
- Modify: `src/index.css`

**Dependencies:** 无

- [ ] **Step 1: 新建 `src/hooks/useMediaQuery.ts`**

```ts
import { useEffect, useState } from 'react'

/** 响应式断点检测：返回给定 media query 当前是否匹配，随窗口变化更新 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 常用移动端断点（与 index.css 的 768px 一致） */
export const useIsMobile = () => useMediaQuery('(max-width: 768px)')
```

- [ ] **Step 2: `WorkspaceDetail.tsx` 引入移动端检测与 Drawer**

顶部 import 增加 `Drawer`（antd）与 `MenuOutlined`（icons）、`useIsMobile`：

```tsx
import { Button, Spin, Modal, Input, Skeleton, Space, Tag, message, Upload, Typography, Drawer } from 'antd'
import { UploadOutlined, DownloadOutlined, ArrowLeftOutlined, ShareAltOutlined, FolderOutlined, DeleteOutlined, InboxOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined } from '@ant-design/icons'
import { useIsMobile } from '../hooks/useMediaQuery'
```

组件内加状态：

```tsx
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
```

- [ ] **Step 3: 抽出侧栏内容为局部变量并按端渲染**

将现有 `<aside>` 内 `<div style={{ width: 280, height: '100%', ... }}>...</div>`（含返回按钮、空间信息、按钮组、`<WorkspaceTree>`）整体抽为组件内常量 `sidebarContent`。桌面端保持原 `<aside>`；移动端用 `Drawer` 承载。选中文件后关闭 Drawer——在 `onSelect` 回调包一层：

```tsx
  const handleSelectFile = (path: string) => {
    setSelectedFile(path)
    if (isMobile) setDrawerOpen(false)
  }

  const sidebarContent = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 原侧栏内的返回/信息/按钮组 JSX 原样搬入，WorkspaceTree 的 onSelect 改为 handleSelectFile */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 4px' }}>
        <WorkspaceTree treeData={tree} selectedFile={selectedFile || undefined} onSelect={handleSelectFile} />
      </div>
    </div>
  )
```

- [ ] **Step 4: 最外层容器按端切换布局**

移动端隐藏 `<aside>` 与桌面折叠按钮，内容区顶部加"目录"触发条；桌面端行为完全不变：

```tsx
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', overflow: 'hidden', position: 'relative' }}>
      {!isMobile && (
        <aside style={{ width: collapsed ? 0 : 280, /* ...原样... */ }}>
          {sidebarContent}
        </aside>
      )}
      {!isMobile && (
        <Button /* 原折叠悬浮按钮，原样保留 */ />
      )}

      {isMobile && (
        <Drawer
          title="目录"
          placement="left"
          width="80vw"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          styles={{ body: { padding: 0 } }}
        >
          {sidebarContent}
        </Drawer>
      )}

      <main style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
        {isMobile && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 10, height: 48,
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
            borderBottom: '1px solid var(--border)', background: 'var(--surface)',
          }}>
            <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开目录">目录</Button>
            <span style={{ fontSize: 13, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedFile ?? '未选择文件'}
            </span>
          </div>
        )}
        {/* 原内容区渲染逻辑保持不变 */}
      </main>
      {/* 上传/分享 Modal 保持不变 */}
    </div>
  )
```

- [ ] **Step 5: `index.css` 补充触摸目标媒体查询**

在 `src/index.css` 的响应式区块（`@media (max-width: 768px) { ... }` 之后）追加：

```css
/* ---- 触摸设备：44px 最小触摸目标（WCAG） ---- */
@media (pointer: coarse) {
  .doc-item { min-height: 44px; }
  .ant-tree-treenode { min-height: 44px; align-items: center; }
  .app-header button { min-width: 44px; min-height: 44px; }
}
```

- [ ] **Step 6: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。Chrome DevTools 切 375px 视口：内容区占满全宽，点"目录"打开 Drawer，选中文件后 Drawer 关闭并展示内容；桌面端（≥768px）侧栏、折叠按钮行为与改造前一致。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useMediaQuery.ts frontend/src/pages/WorkspaceDetail.tsx frontend/src/index.css
git commit -m "feat(frontend): WorkspaceDetail 移动端抽屉目录树与 44px 触摸目标"
```

---

## Task 4: 目录树键盘导航 + 右键菜单 + 树内过滤 + key 冲突修复（P0-3，spec 3.5 + 3.3 key）

**Files:**
- Modify: `src/components/WorkspaceTree.tsx`

**Dependencies:** 无（`copyToClipboard` 已存在于 `utils/clipboard.ts`）

- [ ] **Step 1: 修复目录 key 冲突（携带完整路径）**

`toAntdTree` 当前目录 key 为 `dir:${node.name}`，同名深层目录会冲突。改为递归传入父路径。重写 `toAntdTree`：

```tsx
function toAntdTree(nodes: WorkspaceTreeNode[], parentPath = ''): any[] {
  return nodes.map(node => {
    if (node.type === 'directory') {
      const dirPath = parentPath ? `${parentPath}/${node.name}` : node.name
      return {
        key: `dir:${dirPath}`,                 // 携带完整路径，避免同名目录 key 冲突
        title: node.name,
        icon: (props: any) => props.expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: node.children ? toAntdTree(node.children, dirPath) : [],
        selectable: false,
      }
    }
    const isMd = node.name.endsWith('.md')
    const icon = node.is_asset
      ? <FileOutlined style={{ color: '#999' }} />
      : isMd
        ? <FileTextOutlined style={{ color: '#1677ff' }} />
        : <Html5Outlined style={{ color: '#fa8c16' }} />
    return { key: `file:${node.path}`, title: node.name, icon, isLeaf: true }
  })
}
```

- [ ] **Step 2: 树内过滤（保留祖先链 + 自动展开命中路径）**

在 `WorkspaceTree` 组件内加过滤框与递归过滤函数（遵循 spec 3.5 的 `filterTree` 思路），并计算命中节点的展开 keys：

```tsx
import { Key, useMemo, useState } from 'react'
import { Tree, Input } from 'antd'
// ... 其余 import 不变

function filterTree(nodes: WorkspaceTreeNode[], q: string): WorkspaceTreeNode[] {
  return nodes
    .map(n => n.type === 'directory'
      ? { ...n, children: filterTree(n.children ?? [], q) }
      : n)
    .filter(n => n.type === 'directory'
      ? (n.children?.length ?? 0) > 0
      : n.name.toLowerCase().includes(q))
}

// 收集所有目录 key（用于过滤时全部展开）
function collectDirKeys(nodes: any[], acc: Key[] = []): Key[] {
  for (const n of nodes) {
    if (String(n.key).startsWith('dir:')) { acc.push(n.key); collectDirKeys(n.children ?? [], acc) }
  }
  return acc
}
```

- [ ] **Step 3: 右键上下文菜单（复制链接 + 占位置灰项）**

用 antd `Dropdown` 受控 `open` + `onRightClick` 提供文件节点菜单。复制链接用 `copyToClipboard` 复制应用内路径。重命名/移动/删除本期无后端单文件 API，置灰（`disabled`）：

```tsx
import { Dropdown, message } from 'antd'
import { copyToClipboard } from '../utils/clipboard'
```

- [ ] **Step 4: 重写 `WorkspaceTree` 主体（受控 expandedKeys + 键盘 Enter + 右键）**

```tsx
export default function WorkspaceTree({ treeData, selectedFile, onSelect }: Props) {
  const [filter, setFilter] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  const q = filter.trim().toLowerCase()
  const filtered = useMemo(() => (q ? filterTree(treeData, q) : treeData), [treeData, q])
  const antdData = useMemo(() => toAntdTree(filtered), [filtered])

  // 过滤时自动展开全部命中目录；清空过滤恢复受控展开
  const effectiveExpanded = q ? collectDirKeys(antdData) : expandedKeys
  const selectedKeys: Key[] = selectedFile ? [`file:${selectedFile}`] : []

  const handleSelect = (keys: Key[]) => {
    if (keys.length === 0) return
    const key = String(keys[0])
    if (key.startsWith('file:')) onSelect(key.slice(5))
  }

  const copyLink = async (path: string) => {
    const ok = await copyToClipboard(`${window.location.origin}${window.location.pathname}?file=${encodeURIComponent(path)}`)
    message[ok ? 'success' : 'warning'](ok ? '链接已复制' : '复制失败')
  }

  const menuItems = [
    { key: 'copy', label: '复制链接' },
    { key: 'rename', label: '重命名', disabled: true },
    { key: 'move', label: '移动', disabled: true },
    { key: 'delete', label: '删除', danger: true, disabled: true },
  ]

  return (
    <div tabIndex={0} style={{ outline: 'none' }}>
      <Input.Search
        placeholder="过滤文件…"
        allowClear
        size="small"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Dropdown
        open={!!ctxMenu}
        onOpenChange={(o) => { if (!o) setCtxMenu(null) }}
        trigger={['contextMenu']}
        menu={{
          items: menuItems,
          onClick: ({ key }) => {
            if (ctxMenu && key === 'copy') copyLink(ctxMenu.path)
            setCtxMenu(null)
          },
        }}
      >
        <div>
          <Tree
            treeData={antdData}
            selectedKeys={selectedKeys}
            expandedKeys={effectiveExpanded}
            onExpand={(keys) => setExpandedKeys(keys)}
            onSelect={handleSelect}
            showIcon
            style={{ background: 'transparent' }}
            onRightClick={({ event, node }) => {
              const key = String(node.key)
              if (key.startsWith('file:')) setCtxMenu({ x: event.clientX, y: event.clientY, path: key.slice(5) })
            }}
          />
        </div>
      </Dropdown>
    </div>
  )
}
```

> 说明：antd Tree 原生支持 ↑/↓ 焦点移动与 ←/→ 折叠展开；容器 `tabIndex=0` 保证可聚焦。Enter 选中由 Tree 内建键盘行为触发 `onSelect`。

- [ ] **Step 5: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。浏览器：树聚焦后 ↑/↓/←/→/Enter 可全键盘操作；右键文件弹出菜单，"复制链接"成功、其余置灰；过滤框输入 "auth" 仅显示含 auth 的文件及祖先目录并自动展开，清空恢复；存在同名子目录时展开互不干扰。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/WorkspaceTree.tsx
git commit -m "feat(frontend): 目录树键盘导航、右键菜单、树内过滤与目录 key 冲突修复"
```

---

## Task 5: 面包屑导航（P0-1，spec 3.1）

**Files:**
- Create: `src/components/Breadcrumbs.tsx`
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/pages/WorkspaceDetail.tsx`（`setCurrent` 上报空间名）
- Modify: `src/pages/CollectionDetail.tsx`（`setCurrent` 上报集合名）

**Dependencies:** Task 2（`workspaceStore.current` / `collectionStore.current` 提供实体名）

- [ ] **Step 1: 新建 `src/components/Breadcrumbs.tsx`**

基于 antd `Breadcrumb`，从 `useLocation` 解析路径段，实体名来自 store 的 `current`；`useSearchParams` 读取当前选中文件（WorkspaceDetail 会把 `selectedFile` 写入 store.current 之外，这里通过读取路由参数 + store 组合）：

```tsx
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumb } from 'antd'
import { useWorkspaceStore } from '../store/workspace'
import { useCollectionStore } from '../store/collection'
import { useIsMobile } from '../hooks/useMediaQuery'

export default function Breadcrumbs() {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const ws = useWorkspaceStore((s) => s.current)
  const col = useCollectionStore((s) => s.current)
  const path = location.pathname

  type Crumb = { title: string; onClick?: () => void }
  let crumbs: Crumb[] = []

  if (path === '/' || path.startsWith('/collections')) {
    crumbs.push({ title: '知识集合', onClick: () => navigate('/') })
    if (path.startsWith('/collections/') && col) crumbs.push({ title: col.name })
  } else if (path.startsWith('/workspaces')) {
    crumbs.push({ title: '工作空间', onClick: () => navigate('/workspaces') })
    if (path.startsWith('/workspaces/') && ws) crumbs.push({ title: ws.name })
  }

  if (crumbs.length === 0) return null

  // 移动端仅显示最后两段
  if (isMobile && crumbs.length > 2) {
    crumbs = [{ title: '…' }, ...crumbs.slice(-2)]
  }

  return (
    <Breadcrumb
      style={{ fontSize: 13 }}
      items={crumbs.map((c) => ({
        title: c.onClick
          ? <span style={{ cursor: 'pointer' }} onClick={c.onClick}>{c.title}</span>
          : c.title,
      }))}
    />
  )
}
```

- [ ] **Step 2: `AppLayout.tsx` 渲染面包屑**

在 header 的导航按钮 `<div>`（`工作空间` 按钮所在容器）之后、搜索框 `<Input>` 之前插入分隔与面包屑：

```tsx
import Breadcrumbs from './Breadcrumbs'
```

```tsx
        </div>
        {/* 面包屑：位于导航按钮之后 */}
        <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center' }}>
          <Breadcrumbs />
        </div>
        <Input
          /* ...原搜索框... */
        />
```

- [ ] **Step 3: `WorkspaceDetail.tsx` 上报当前空间名**

在 `loadWorkspace` 内 `setWorkspace(ws)` 之后调用 store `setCurrent`，并在组件卸载时清空：

```tsx
import { useWorkspaceStore } from '../store/workspace'

  const setCurrent = useWorkspaceStore((s) => s.setCurrent)
  // loadWorkspace 内 setWorkspace(ws) 后：
  setCurrent(ws)
  // 顶层加清理：
  useEffect(() => () => setCurrent(null), [setCurrent])
```

- [ ] **Step 4: `CollectionDetail.tsx` 上报当前集合名**

在 `CollectionDetail.tsx` 加载集合信息（`api.getCollection` 或列表命中）后同样 `useCollectionStore.getState().setCurrent(collection)`，卸载清空：

```tsx
import { useCollectionStore } from '../store/collection'

  const setCurrent = useCollectionStore((s) => s.setCurrent)
  // 集合数据就绪后：setCurrent(col)
  useEffect(() => () => setCurrent(null), [setCurrent])
```

- [ ] **Step 5: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。浏览器：`/workspaces/:id` 顶栏面包屑显示"工作空间 > {空间名}"，点"工作空间"跳回 `/workspaces`；集合详情显示"知识集合 > {集合名}"；重命名实体后名称即时更新；移动端仅显示末两段。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Breadcrumbs.tsx frontend/src/components/AppLayout.tsx frontend/src/pages/WorkspaceDetail.tsx frontend/src/pages/CollectionDetail.tsx
git commit -m "feat(frontend): 顶栏面包屑导航（订阅 store 实体名）"
```

---

## Task 6: Ctrl+K 命令面板（P1-1，spec 3.2）

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Create: `src/utils/highlight.tsx`
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/pages/Search.tsx`（抽出 `highlightSnippet` 复用）

**Dependencies:** 无（复用 `api.search` 与 `SearchResult` 类型）

- [ ] **Step 1: 新建 `src/utils/highlight.tsx` 抽出 `highlightSnippet`**

将 `Search.tsx` 顶部的 `highlightSnippet` 移到公共工具，两处共用：

```tsx
// src/utils/highlight.tsx
export function highlightSnippet(snippet: string) {
  const parts = snippet.split(/<<|>>/)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} style={{ background: 'var(--accent-tint)', color: 'var(--accent-press)', borderRadius: 2, padding: '0 2px' }}>{part}</mark>
      : <span key={i}>{part}</span>
  )
}
```

`Search.tsx` 删除本地定义，改为 `import { highlightSnippet } from '../utils/highlight'`。

- [ ] **Step 2: 新建 `src/components/CommandPalette.tsx`**

基于 antd `Modal`（无 footer、顶部对齐），300ms 防抖调 `api.search`，↑/↓/Enter/Esc 全键盘；跳转规则与 `Search.tsx` 一致（`/collections/:collection_id?doc=:document_id`）：

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Input } from 'antd'
import { SearchOutlined, FileTextOutlined, Html5Outlined } from '@ant-design/icons'
import { api, type SearchResult } from '../api/client'
import { highlightSnippet } from '../utils/highlight'

interface Props {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<any>(null)

  // 打开时聚焦、重置状态
  useEffect(() => {
    if (open) { setQ(''); setResults([]); setActive(0); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  // 300ms 防抖搜索
  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      try { setResults(await api.search(q.trim())); setActive(0) } catch { setResults([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const go = (r: SearchResult) => {
    navigate(`/collections/${r.collection_id}?doc=${r.document_id}`)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]) }
  }

  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} style={{ top: 80 }} styles={{ body: { padding: 0 } }} width={600}>
      <div onKeyDown={onKeyDown}>
        <Input
          ref={inputRef}
          size="large"
          variant="borderless"
          prefix={<SearchOutlined style={{ color: 'var(--ink-300)' }} />}
          placeholder="搜索文档… Enter 打开，Esc 关闭"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ borderTop: '1px solid var(--divider)', maxHeight: 360, overflow: 'auto' }} aria-live="polite">
          {results.map((r, i) => (
            <div
              key={r.document_id}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              style={{ padding: '10px 16px', cursor: 'pointer', background: i === active ? 'var(--subtle-bg)' : 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.ext === '.md' ? <FileTextOutlined style={{ color: 'var(--md-color)' }} /> : <Html5Outlined style={{ color: 'var(--html-color)' }} />}
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{r.title}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>· {r.collection_name}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>{highlightSnippet(r.snippet)}</div>
            </div>
          ))}
          {q.trim() && results.length > 0 && (
            <div
              onClick={() => { navigate(`/search?q=${encodeURIComponent(q.trim())}`); onClose() }}
              style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 12, color: 'var(--accent)', borderTop: '1px solid var(--divider)' }}
            >
              查看全部结果 →
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: `AppLayout.tsx` 全局监听 Ctrl+K 并挂载面板**

```tsx
import { useState, useEffect } from 'react'
import CommandPalette from './CommandPalette'
```

组件内：

```tsx
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

顶栏搜索框 `placeholder` 改为 `"搜索文档… Ctrl+K"`，`onPressEnter` 改为 `() => setPaletteOpen(true)`；在 `</header>` 之后（`page-fade` div 之前）挂载 `<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />`。

- [ ] **Step 4: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。任意登录页按 Ctrl+K 打开浮层并自动聚焦；输入关键词 300ms 后出结果（含高亮）；↑/↓ 切换、Enter 跳转并关闭、Esc 关闭；"查看全部结果"跳 `/search?q=`；浮层打开期间背景不滚动。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CommandPalette.tsx frontend/src/utils/highlight.tsx frontend/src/components/AppLayout.tsx frontend/src/pages/Search.tsx
git commit -m "feat(frontend): Ctrl+K 全局命令面板搜索浮层"
```

---

## Task 7: 侧栏拖拽调宽 + 选中项自动滚动 + DualLayoutPage（P1-2，spec 3.3 + 4.2）

**Files:**
- Create: `src/components/DualLayoutPage.tsx`
- Modify: `src/pages/WorkspaceDetail.tsx`
- Modify: `src/pages/SharedWorkspace.tsx`
- Modify: `src/components/WorkspaceTree.tsx`（选中项 scrollIntoView + 祖先展开）

**Dependencies:** Task 3（`useMediaQuery` 已存在）、Task 4（受控 `expandedKeys` 已就绪）

- [ ] **Step 1: 新建 `src/components/DualLayoutPage.tsx`**

封装拖拽调宽 + localStorage 持久化 + 折叠悬浮按钮 + 移动端 Drawer。`storageKeyPrefix` 沿用 `kb_ws_sidebar` 保持老用户折叠值（`kb_ws_sidebar_collapsed`）兼容：

```tsx
import { useEffect, useRef, useState } from 'react'
import { Button, Drawer } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined } from '@ant-design/icons'
import { useIsMobile } from '../hooks/useMediaQuery'

interface DualLayoutPageProps {
  sidebar: React.ReactNode
  children: React.ReactNode
  storageKeyPrefix: string          // 派生 `${prefix}_collapsed` / `${prefix}_width`
  minWidth?: number                 // 默认 200
  maxWidth?: number                 // 默认 400
  mobileDrawerTitle?: string        // <768px 抽屉标题
  mobileHeader?: React.ReactNode    // 移动端内容区顶部条（如当前文件名）
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export default function DualLayoutPage({
  sidebar, children, storageKeyPrefix,
  minWidth = 200, maxWidth = 400, mobileDrawerTitle = '目录', mobileHeader,
}: DualLayoutPageProps) {
  const isMobile = useIsMobile()
  const COLLAPSED_KEY = `${storageKeyPrefix}_collapsed`
  const WIDTH_KEY = `${storageKeyPrefix}_width`

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')
  const [width, setWidth] = useState(() => clamp(Number(localStorage.getItem(WIDTH_KEY)) || 280, minWidth, maxWidth))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const dragging = useRef(false)

  const toggle = () => setCollapsed((c) => { localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1'); return !c })

  // 指针拖拽调宽，pointerup 写入 localStorage
  useEffect(() => {
    const onMove = (e: PointerEvent) => { if (dragging.current) setWidth(clamp(e.clientX, minWidth, maxWidth)) }
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false
        document.body.style.userSelect = ''
        localStorage.setItem(WIDTH_KEY, String(width))
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [width, minWidth, maxWidth])

  const startDrag = () => { dragging.current = true; document.body.style.userSelect = 'none' }

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px)', overflow: 'hidden' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, height: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开目录">{mobileDrawerTitle}</Button>
          {mobileHeader}
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>{children}</div>
        <Drawer title={mobileDrawerTitle} placement="left" width="80vw" open={drawerOpen} onClose={() => setDrawerOpen(false)} styles={{ body: { padding: 0 } }}>
          {sidebar}
        </Drawer>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', overflow: 'hidden', position: 'relative' }}>
      <aside style={{ width: collapsed ? 0 : width, borderRight: collapsed ? 'none' : '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, overflow: 'hidden', transition: dragging.current ? 'none' : 'width 0.2s var(--ease)' }}>
        <div style={{ width, height: '100%' }}>{sidebar}</div>
      </aside>
      {!collapsed && (
        <div onPointerDown={startDrag} style={{ width: 6, cursor: 'col-resize', flexShrink: 0 }} role="separator" aria-label="调整侧栏宽度" />
      )}
      <Button
        type="text" size="small"
        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={toggle}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        style={{ position: 'absolute', top: 8, left: collapsed ? 8 : width + 8, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--border)', transition: 'left 0.2s var(--ease)' }}
      />
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: `WorkspaceTree.tsx` 选中项自动滚动 + 祖先目录自动展开**

在 `WorkspaceTree` 组件内加两个 `useEffect`（`Key` 已从 react 导入）：

```tsx
import { Key, useEffect, useMemo, useState } from 'react'

  // selectedFile 变化后展开其所有祖先目录
  useEffect(() => {
    if (!selectedFile) return
    const segs = selectedFile.split('/').slice(0, -1)   // 去掉文件名
    const ancestors: Key[] = []
    let acc = ''
    for (const s of segs) { acc = acc ? `${acc}/${s}` : s; ancestors.push(`dir:${acc}`) }
    setExpandedKeys((prev) => Array.from(new Set([...prev, ...ancestors])))
  }, [selectedFile])

  // 滚动选中节点进可视区
  useEffect(() => {
    if (!selectedFile) return
    const t = setTimeout(() => {
      document.querySelector('.ant-tree-node-selected')?.scrollIntoView({ block: 'nearest' })
    }, 50)
    return () => clearTimeout(t)
  }, [selectedFile])
```

- [ ] **Step 3: `WorkspaceDetail.tsx` 迁移到 DualLayoutPage**

用 `DualLayoutPage` 替换手写的 `<aside>` + 折叠按钮 + `<main>` 布局，`storageKeyPrefix="kb_ws_sidebar"`。删除本地 `collapsed`/`toggleSidebar` 与 `SIDEBAR_COLLAPSED_KEY`。`sidebarContent`（Task 3 抽出）传 sidebar，内容区渲染逻辑传 children：

```tsx
import DualLayoutPage from '../components/DualLayoutPage'

  return (
    <DualLayoutPage
      storageKeyPrefix="kb_ws_sidebar"
      mobileHeader={<span style={{ fontSize: 13, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile ?? '未选择文件'}</span>}
      sidebar={sidebarContent}
    >
      {/* 原 <main> 内容区渲染逻辑（selectedFile/contentLoading/isMd 分支）原样搬入；上传/分享 Modal 置于 children 末尾 */}
    </DualLayoutPage>
  )
```

- [ ] **Step 4: `SharedWorkspace.tsx` 迁移到 DualLayoutPage**

将 `<aside>...</aside>` 与 `<main>...</main>` 替换为 `DualLayoutPage`（`storageKeyPrefix="kb_shared_ws_sidebar"`，只读页无上传/删除）。sidebar 传空间信息 + 只读标记 + `WorkspaceTree`（`onSelect={setSelectedFile}`）。

- [ ] **Step 5: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。浏览器：拖动手柄在 200–400px 调宽，刷新后保持；折叠/展开与旧 localStorage 值兼容；通过文档内链跳深层文件，目录树自动展开祖先并滚动选中项到可视区；SharedWorkspace 使用同一布局组件无回归。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DualLayoutPage.tsx frontend/src/pages/WorkspaceDetail.tsx frontend/src/pages/SharedWorkspace.tsx frontend/src/components/WorkspaceTree.tsx
git commit -m "feat(frontend): 抽取 DualLayoutPage 支持侧栏拖拽调宽与选中项自动滚动"
```

---

## Task 8: 卡片统一升级 + FilePreviewCard（P1-3，spec 2.1 + 4.1）

**Files:**
- Create: `src/components/FilePreviewCard.tsx`
- Modify: `src/index.css`
- Modify: `src/pages/Workspaces.tsx`

**Dependencies:** Task 2（Workspaces 已接 store）、Task 1（复用状态变量）

- [ ] **Step 1: `index.css` 升级 `.col-card` 悬停微交互并新增图标底座**

将 `src/index.css` 现有 `.col-card` 的 `transition` 一行与 `:hover` 规则替换、并在 `.col-card .meta { ... }` 之后追加图标底座与文件卡样式：

```css
.col-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  cursor: pointer;
  transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease), transform 0.15s var(--ease);
  display: flex;
  flex-direction: column;
}
.col-card:hover { border-color: var(--ink-400); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.col-card:active { transform: translateY(0); }

/* ---- 卡片图标底座（集合/文件预览共用） ---- */
.card-icon {
  width: 32px; height: 32px; border-radius: 6px;
  background: var(--subtle-bg); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--ink-500); font-size: 15px; flex-shrink: 0;
}
```

- [ ] **Step 2: 新建 `src/components/FilePreviewCard.tsx`**

抽取一个与 `.col-card` 同视觉语言的通用文件/资源预览卡，供工作空间列表复用。图标复用 `.card-icon`：

```tsx
import { FolderOutlined, ShareAltOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

interface FilePreviewCardProps {
  icon?: ReactNode              // 左上角图标，默认文件夹
  title: string                 // 主标题
  description?: string          // 两行截断描述
  meta?: ReactNode              // 底部元信息（左）
  extra?: ReactNode             // 底部操作区（右，如 Dropdown）
  shared?: boolean              // 是否显示分享角标
  onClick?: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

export default function FilePreviewCard({
  icon, title, description, meta, extra, shared, onClick, dragHandleProps,
}: FilePreviewCardProps) {
  return (
    <div className="col-card" onClick={onClick}>
      <div className="body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }} {...dragHandleProps}>
          <div className="card-icon">{icon ?? <FolderOutlined />}</div>
          <div className="title" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
          </div>
          {shared && <ShareAltOutlined style={{ fontSize: 12, color: 'var(--ink-300)', flexShrink: 0 }} />}
        </div>
        <div className="desc">{description || '暂无描述'}</div>
        <div className="meta">
          <span>{meta}</span>
          {extra}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `Workspaces.tsx` 列表卡片改用 `FilePreviewCard`**

将工作空间列表项内联的卡片 JSX 替换为 `FilePreviewCard`，`meta` 传 `{ws.file_count} 个文件 · {formatSize(ws.total_size)}`，`shared` 传 `!!ws.share_token`，`extra` 传原有操作 Dropdown/按钮，`onClick` 跳转 `/workspaces/${ws.id}`：

```tsx
import FilePreviewCard from '../components/FilePreviewCard'
import { formatSize } from '../utils/format'

// 列表渲染：
{list.map((ws) => (
  <FilePreviewCard
    key={ws.id}
    title={ws.name}
    description={ws.description}
    shared={!!ws.share_token}
    meta={`${ws.file_count} 个文件 · ${formatSize(ws.total_size)}`}
    onClick={() => navigate(`/workspaces/${ws.id}`)}
    extra={/* 原操作区 Dropdown 原样传入 */ null}
  />
))}
```

- [ ] **Step 4: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。集合卡与工作空间卡悬停出现上浮 + 阴影微交互，视觉一致；亮/暗主题下阴影使用 `--shadow-md`；卡片图标底座样式统一。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FilePreviewCard.tsx frontend/src/index.css frontend/src/pages/Workspaces.tsx
git commit -m "feat(frontend): 统一卡片悬停微交互并抽取 FilePreviewCard"
```

---

## Task 9: 操作反馈统一 confirmDanger + FormModal + 上传进度（P1-4，spec 3.7 + 4.3）

**Files:**
- Create: `src/utils/confirm.ts`
- Create: `src/components/FormModal.tsx`
- Modify: `src/api/client.ts`
- Modify: `src/pages/WorkspaceDetail.tsx`
- Modify: `src/components/CollectionCard.tsx`

**Dependencies:** 无

- [ ] **Step 1: 新建 `src/utils/confirm.ts`（统一危险操作确认）**

封装 antd `Modal.confirm`，统一 danger 文案与按钮，返回 Promise 便于 `await`：

```ts
import { Modal } from 'antd'
import { ExclamationCircleFilled } from '@ant-design/icons'
import { createElement } from 'react'

interface ConfirmDangerOptions {
  title: string
  content?: string
  okText?: string
  cancelText?: string
}

/** 统一的危险操作二次确认；用户确认 resolve(true)，取消 resolve(false) */
export function confirmDanger(opts: ConfirmDangerOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: opts.title,
      icon: createElement(ExclamationCircleFilled, { style: { color: 'var(--danger, #dc2626)' } }),
      content: opts.content,
      okType: 'danger',
      okText: opts.okText ?? '删除',
      cancelText: opts.cancelText ?? '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}
```

- [ ] **Step 2: 新建 `src/components/FormModal.tsx`（统一表单弹窗骨架）**

统一新建/编辑类弹窗的标题、footer、loading、受控 open，表单内容由 children 提供：

```tsx
import { Modal } from 'antd'
import type { ReactNode } from 'react'

interface FormModalProps {
  open: boolean
  title: string
  confirmLoading?: boolean
  okText?: string
  onOk: () => void
  onCancel: () => void
  width?: number
  children: ReactNode
}

export default function FormModal({
  open, title, confirmLoading, okText = '保存', onOk, onCancel, width = 480, children,
}: FormModalProps) {
  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText={okText}
      cancelText="取消"
      width={width}
      destroyOnClose
    >
      {children}
    </Modal>
  )
}
```

- [ ] **Step 3: `client.ts` 的 `uploadWorkspaceZip` 支持上传进度回调**

为现有 `uploadWorkspaceZip(id, file)` 增加可选 `onProgress`（利用 axios `onUploadProgress`）：

```ts
uploadWorkspaceZip: (id: number, file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    return client.post<{ file_count: number }>(`/workspaces/${id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    }).then(r => r.data)
  },
```

- [ ] **Step 4: `WorkspaceDetail.tsx` 展示上传进度并接入 confirmDanger**

新增 `uploadPercent` 状态，`handleUpload` 传入进度回调，UI 用 antd `Progress` 展示；删除操作改用 `confirmDanger`：

```tsx
import { Progress } from 'antd'
import { confirmDanger } from '../utils/confirm'

  const [uploadPercent, setUploadPercent] = useState(0)

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadPercent(0)
    try {
      await api.uploadWorkspaceZip(Number(id), file, setUploadPercent)
      message.success('上传成功')
      await load()
    } catch { message.error('上传失败') }
    finally { setUploading(false); setUploadPercent(0) }
  }

  const handleDelete = async () => {
    const ok = await confirmDanger({ title: '删除工作空间', content: `确认删除「${workspace?.name}」？此操作不可恢复。` })
    if (!ok) return
    await api.deleteWorkspace(Number(id))
    message.success('已删除')
    navigate('/workspaces')
  }

  {uploading && <Progress percent={uploadPercent} size="small" status="active" style={{ margin: '8px 12px' }} />}
```

- [ ] **Step 5: `CollectionCard.tsx` 复用 confirmDanger**

将 `handleDelete` / `handleRevokeShare` 内的 `Modal.confirm(...)` 替换为 `confirmDanger`，去掉重复文案：

```tsx
import { confirmDanger } from '../utils/confirm'

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (await confirmDanger({ title: '删除集合', content: `确认删除「${collection.name}」及其下所有文件？此操作不可恢复。`, okText: '删除' })) onDelete()
  }

  const handleRevokeShare = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (await confirmDanger({ title: '取消分享', content: '取消后，已分享的链接将立即失效。确认取消？', okText: '取消分享', cancelText: '保留' })) onRevokeShare()
  }
```

- [ ] **Step 6: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。工作空间上传显示进度条并在完成后归零；删除工作空间/集合弹出统一 danger 确认框；取消分享确认按钮文案为「取消分享」。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/confirm.ts frontend/src/components/FormModal.tsx frontend/src/api/client.ts frontend/src/pages/WorkspaceDetail.tsx frontend/src/components/CollectionCard.tsx
git commit -m "feat(frontend): 统一危险操作确认与表单弹窗并展示上传进度"
```

---

## Task 10: shimmer 骨架屏统一 + 路由代码分割（P1-5，spec 2.3 + 5.2）

**Files:**
- Create: `src/components/PageSkeleton.tsx`
- Modify: `src/index.css`
- Modify: `src/App.tsx`
- Modify: `vite.config.ts`

**Dependencies:** 无

- [ ] **Step 1: `index.css` 新增 shimmer 骨架屏动画**

在 `src/index.css` 的 `.page-fade { animation: fade 0.2s var(--ease); }` 之后追加（暗色变量复用 `--subtle-bg` / `--divider`）：

```css
/* ---- shimmer 骨架屏（列表/详情加载占位） ---- */
@keyframes shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
.skeleton-block {
  border-radius: var(--r-md, 8px);
  background: linear-gradient(90deg, var(--subtle-bg) 25%, var(--divider) 37%, var(--subtle-bg) 63%);
  background-size: 800px 100%;
  animation: shimmer 1.4s var(--ease) infinite;
}
```

- [ ] **Step 2: 新建 `src/components/PageSkeleton.tsx`**

提供两种布局：列表页网格卡骨架与详情页双栏骨架，供 Suspense fallback 与列表 loading 复用：

```tsx
interface PageSkeletonProps {
  variant?: 'grid' | 'detail'
  count?: number
}

export default function PageSkeleton({ variant = 'grid', count = 6 }: PageSkeletonProps) {
  if (variant === 'detail') {
    return (
      <div style={{ display: 'flex', height: '100%', gap: 0 }}>
        <div style={{ width: 280, padding: 16, borderRight: '1px solid var(--border)' }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton-block" style={{ height: 20, marginBottom: 12, width: `${60 + (i % 3) * 12}%` }} />
          ))}
        </div>
        <div style={{ flex: 1, padding: 32, maxWidth: 760 }}>
          <div className="skeleton-block" style={{ height: 32, width: '50%', marginBottom: 24 }} />
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="skeleton-block" style={{ height: 16, marginBottom: 12, width: i % 4 === 3 ? '70%' : '100%' }} />
          ))}
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, padding: 24 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-block" style={{ height: 132 }} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: `App.tsx` 路由级 `React.lazy` + `Suspense`**

将页面组件改为懒加载（`Login` 保留同步以免白屏），用 `PageSkeleton` 作为 fallback：

```tsx
import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './store/auth'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import PageSkeleton from './components/PageSkeleton'

const Collections = lazy(() => import('./pages/Collections'))
const CollectionDetail = lazy(() => import('./pages/CollectionDetail'))
const Search = lazy(() => import('./pages/Search'))
const Workspaces = lazy(() => import('./pages/Workspaces'))
const WorkspaceDetail = lazy(() => import('./pages/WorkspaceDetail'))
const SharedCollection = lazy(() => import('./pages/SharedCollection'))
const SharedDocument = lazy(() => import('./pages/SharedDocument'))
const SharedWorkspace = lazy(() => import('./pages/SharedWorkspace'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token)
  const location = useLocation()
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return <AppLayout>{children}</AppLayout>
}

export default function App() {
  return (
    <Suspense fallback={<PageSkeleton variant="grid" />}>
      <Routes>
        {/* 路由定义与原来完全一致，仅组件来源改为 lazy */}
      </Routes>
    </Suspense>
  )
}
```

注：`WorkspaceDetail` / `SharedWorkspace` 的 Suspense fallback 建议在其路由处局部包 `<Suspense fallback={<PageSkeleton variant="detail" />}>`，列表页用外层 grid fallback 即可。

- [ ] **Step 4: `vite.config.ts` 配置 `manualChunks` 拆包**

将重型依赖（markdown 渲染、图表）单独成块，降低首屏主包体积：

```ts
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'antd-vendor': ['antd', '@ant-design/icons'],
          'markdown-vendor': ['react-markdown', 'rehype-highlight', 'remark-gfm', 'katex'],
          'mermaid-vendor': ['mermaid'],
        },
      },
    },
  },
```

- [ ] **Step 5: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。构建产物出现 `mermaid-vendor`/`markdown-vendor` 等独立 chunk，主入口包体积明显下降；首次进入列表/详情页先显 shimmer 骨架屏再渲染真实内容。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PageSkeleton.tsx frontend/src/index.css frontend/src/App.tsx frontend/vite.config.ts
git commit -m "feat(frontend): 统一 shimmer 骨架屏并引入路由代码分割"
```

---

## Task 11: 筛选状态进 URL + 滚动位置恢复（P1-6，spec 3.6）

**Files:**
- Create: `src/hooks/useScrollRestore.ts`
- Modify: `src/pages/Collections.tsx`

**Dependencies:** Task 2（Collections 已接 store）

- [ ] **Step 1: 新建 `src/hooks/useScrollRestore.ts`**

基于 `sessionStorage` 按 key 保存/恢复滚动容器位置，返回需绑定到滚动容器的 ref：

```ts
import { useEffect, useRef } from 'react'

/** 按 key 在 sessionStorage 中保存/恢复滚动容器的 scrollTop */
export function useScrollRestore<T extends HTMLElement>(key: string) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const saved = sessionStorage.getItem(`scroll:${key}`)
    if (saved) el.scrollTop = Number(saved)
    const onScroll = () => sessionStorage.setItem(`scroll:${key}`, String(el.scrollTop))
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [key])
  return ref
}
```

- [ ] **Step 2: `Collections.tsx` 筛选关键字接入 `useSearchParams`**

将现有本地 `search` 状态改为从 URL query `q` 读写，刷新/后退保持筛选（与 Search.tsx 同模式）：

```tsx
import { useSearchParams } from 'react-router-dom'

  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const setSearch = (v: string) => {
    const next = new URLSearchParams(searchParams)
    if (v) next.set('q', v); else next.delete('q')
    setSearchParams(next, { replace: true })
  }

  // 过滤列表（基于 store 的 list）
  const filtered = search
    ? list.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : list
```

搜索框 `value={search}` / `onChange={(e) => setSearch(e.target.value)}`，列表渲染改用 `filtered`。

- [ ] **Step 3: `Collections.tsx` 接入滚动位置恢复**

给列表滚动容器绑定 `useScrollRestore`（key 用固定页面标识）：

```tsx
import { useScrollRestore } from '../hooks/useScrollRestore'

  const scrollRef = useScrollRestore<HTMLDivElement>('collections')
  // 渲染：<div ref={scrollRef} style={{ overflow: 'auto', height: '...' }}> 列表网格 </div>
```

- [ ] **Step 4: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。在集合列表输入筛选后地址栏出现 `?q=xxx`，刷新页面筛选保持；滚动列表后进入详情再返回，滚动位置恢复到离开时位置。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useScrollRestore.ts frontend/src/pages/Collections.tsx
git commit -m "feat(frontend): 筛选状态写入 URL 并支持列表滚动位置恢复"
```

---

## Task 12: highlight.js / Mermaid 主题动态切换（P2-1，spec 2.4）

**Files:**
- Create: `src/hooks/useHljsTheme.ts`
- Modify: `src/main.tsx`
- Modify: `src/components/MarkdownViewer.tsx`

**Dependencies:** Task 1（主题变量）；theme store 已存在（`useTheme` / `applyTheme`）

- [ ] **Step 1: `main.tsx` 移除固定的 `github-dark.css` 导入**

当前 `src/main.tsx` 固定 `import 'highlight.js/styles/github-dark.css'`，导致亮色主题下代码块也是暗底。删除该行，改为运行时根据主题动态注入（Step 2）。

- [ ] **Step 2: 新建 `src/hooks/useHljsTheme.ts`**

根据当前主题动态切换 highlight.js 样式表（使用 Vite `?url` 资源导入，避免两套样式同时生效）：

```ts
import { useEffect } from 'react'
import { useTheme } from '../store/theme'
import githubLight from 'highlight.js/styles/github.css?url'
import githubDark from 'highlight.js/styles/github-dark.css?url'

const LINK_ID = 'hljs-theme'

/** 根据当前主题切换 highlight.js 代码高亮样式表 */
export function useHljsTheme() {
  const theme = useTheme((s) => s.theme)
  useEffect(() => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    link.href = theme === 'dark' ? githubDark : githubLight
  }, [theme])
}
```

- [ ] **Step 3: `MarkdownViewer.tsx` 接入 hljs 主题 + Mermaid 主题渲染**

在 `MarkdownViewerInner` 顶部调用 `useHljsTheme()`；并新增 Mermaid 代码块渲染（`package.json` 已含 mermaid ^11），主题随应用主题变化：

```tsx
import { useHljsTheme } from '../hooks/useHljsTheme'
import { useTheme } from '../store/theme'
import mermaid from 'mermaid'

function MarkdownViewerInner({ content, onTocReady, onInternalLink, workspaceServePrefix }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useHljsTheme()
  const theme = useTheme((s) => s.theme)

  // Mermaid 图表渲染：扫描 <code class="language-mermaid"> 代码块并渲染，主题跟随切换
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' })
    const blocks = root.querySelectorAll('code.language-mermaid')
    blocks.forEach(async (el, i) => {
      const code = el.textContent || ''
      const host = el.closest('pre') ?? el
      try {
        const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, code)
        const wrap = document.createElement('div')
        wrap.className = 'mermaid-rendered'
        wrap.innerHTML = svg
        host.replaceWith(wrap)
      } catch { /* 渲染失败保留原始代码块 */ }
    })
  }, [content, theme])
```

- [ ] **Step 4: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。亮色主题下代码块为浅底 github 主题，切换暗色后为 github-dark；Mermaid 图表能渲染并随主题改变配色。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useHljsTheme.ts frontend/src/main.tsx frontend/src/components/MarkdownViewer.tsx
git commit -m "feat(frontend): 代码高亮与 Mermaid 图表随主题动态切换"
```

---

## Task 13: 空状态插画 + 拖拽上传引导（P2-2，spec 3.8）

**Files:**
- Modify: `src/components/EmptyState.tsx`
- Modify: `src/index.css`
- Modify: `src/pages/Workspaces.tsx`

**Dependencies:** Task 8（卡片统一）

- [ ] **Step 1: `EmptyState.tsx` 新增插画位与尺寸（保留现有 Props）**

现有 Props `{ icon, title, description?, actionText?, onAction? }` 保持不变，新增可选 `illustration` 与 `size`，优先渲染插画：

```tsx
import type { ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  description?: string
  actionText?: string
  onAction?: () => void
  illustration?: ReactNode   // 可选 SVG 插画，优先于 icon
  size?: 'default' | 'large'
}

export default function EmptyState({ icon, title, description, actionText, onAction, illustration, size = 'default' }: Props) {
  return (
    <div className={`empty-wrap${size === 'large' ? ' empty-large' : ''}`}>
      <div className="empty-icon">{illustration ?? icon}</div>
      <div className="empty-title">{title}</div>
      {description && <div className="empty-desc">{description}</div>}
      {actionText && onAction && (
        <button className="empty-action" onClick={onAction}>{actionText}</button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `index.css` 补充空状态标题/描述/按钮与 large 尺寸**

在现有 `.empty-wrap` / `.empty-icon` 规则之后追加：

```css
.empty-title { font-size: 15px; font-weight: 600; color: var(--ink-800); margin-top: 12px; }
.empty-desc { font-size: 13px; color: var(--ink-400); margin-top: 6px; max-width: 320px; text-align: center; }
.empty-action {
  margin-top: 16px; padding: 6px 16px; border-radius: var(--r-md, 8px);
  border: 1px solid var(--accent); background: var(--accent-tint); color: var(--accent);
  font-size: 13px; cursor: pointer; transition: background 0.15s var(--ease);
}
.empty-action:hover { background: var(--accent); color: #fff; }
.empty-large .empty-icon { font-size: 56px; }
.empty-large { padding: 64px 24px; }

/* ---- 拖拽上传引导高亮 ---- */
.drop-zone-active {
  outline: 2px dashed var(--accent);
  outline-offset: -8px;
  background: var(--accent-tint);
  transition: background 0.15s var(--ease);
}
```

- [ ] **Step 3: `Workspaces.tsx` 空列表插画 + 页面级拖拽上传引导**

空列表时用 `EmptyState`（`size="large"`，`actionText="新建工作空间"`）；页面容器监听拖拽事件，拖入 zip 时高亮：

```tsx
import EmptyState from '../components/EmptyState'
import { FolderOpenOutlined } from '@ant-design/icons'

  const [dragOver, setDragOver] = useState(false)

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.name.endsWith('.zip')) { /* 调用新建+上传流程 */ }
  }

  // 容器：<div className={dragOver ? 'drop-zone-active' : ''}
  //   onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
  //   onDragLeave={() => setDragOver(false)} onDrop={onDrop}>

  {list.length === 0 && !loading && (
    <EmptyState
      size="large"
      icon={<FolderOpenOutlined />}
      title="还没有工作空间"
      description="上传一个 zip 压缩包快速创建，或直接拖拽文件到此处"
      actionText="新建工作空间"
      onAction={() => setCreateOpen(true)}
    />
  )}
```

- [ ] **Step 4: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。空工作空间列表显示大号插画 + 行动按钮；拖拽 zip 到页面时出现虚线高亮区，松手触发创建流程；现有 EmptyState 调用处（如 SharedWorkspace）无回归。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EmptyState.tsx frontend/src/index.css frontend/src/pages/Workspaces.tsx
git commit -m "feat(frontend): 空状态插画与页面拖拽上传引导"
```

---

## Task 14: 页面/内容切换过渡动画完善（P2-3，spec 3.6-3）

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/AppLayout.tsx`

**Dependencies:** Task 1（`--ease` 变量）

- [ ] **Step 1: `index.css` 补充内容切换过渡动画**

在现有 `.page-fade` 之后追加上滑淑入与尊重减动偏好：

```css
@keyframes slideUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
.content-enter { animation: slideUp 0.24s var(--ease); }

/* 尊重系统“减少动效”偏好：关闭所有非必要动画 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: `AppLayout.tsx` 路由切换时为内容区加入场动画**

依据 `useLocation().pathname` 作为 key 触发重新挂载动画（与现有布局兼容）：

```tsx
import { useLocation } from 'react-router-dom'

  const location = useLocation()
  // 内容区包装：<div key={location.pathname} className="content-enter">{children}</div>
```

- [ ] **Step 3: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。路由切换时内容区有轻微上滑淑入；开启系统“减少动效”后动画基本禁用。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css frontend/src/components/AppLayout.tsx
git commit -m "feat(frontend): 完善页面内容切换过渡动画与减动偏好"
```

---

## Task 15: 大列表虚拟化（P2-4，spec 5.3）

**Files:**
- Create: `src/components/VirtualDocList.tsx`
- Modify: `src/pages/CollectionDetail.tsx`
- Modify: `frontend/package.json`（新增依赖）

**Dependencies:** 无（但与 Task 9 的逐步改造互不影响）

- [ ] **Step 1: 安装 `react-window`**

Run: `cd frontend; npm install react-window; npm install -D @types/react-window`
Expected: `package.json` 新增 `react-window` 与 `@types/react-window`（当前未安装）。

- [ ] **Step 2: 新建 `src/components/VirtualDocList.tsx`**

用 `FixedSizeList` 渲染大量文档行（项高 44px，与触摸目标一致）；仅用于无拖拽需求的大列表场景：

```tsx
import { FixedSizeList } from 'react-window'
import type { DocumentItem } from '../api/client'
import { FileTextOutlined, Html5Outlined } from '@ant-design/icons'

interface VirtualDocListProps {
  docs: DocumentItem[]
  selectedId?: number
  height: number
  onSelect: (doc: DocumentItem) => void
}

export default function VirtualDocList({ docs, selectedId, height, onSelect }: VirtualDocListProps) {
  return (
    <FixedSizeList height={height} itemCount={docs.length} itemSize={44} width="100%">
      {({ index, style }) => {
        const doc = docs[index]
        const isMd = doc.ext === '.md'
        return (
          <div
            style={style}
            className={`doc-item${selectedId === doc.id ? ' active' : ''}`}
            onClick={() => onSelect(doc)}
            role="option"
            aria-selected={selectedId === doc.id}
          >
            <span style={{ color: isMd ? 'var(--md-color)' : 'var(--html-color)', marginRight: 8 }}>
              {isMd ? <FileTextOutlined /> : <Html5Outlined />}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</span>
          </div>
        )
      }}
    </FixedSizeList>
  )
}
```

- [ ] **Step 3: `CollectionDetail.tsx` 大列表时切换到虚拟列表**

阈值策略：`filteredDocs.length > 100` 时用 `VirtualDocList`（放弃拖拽排序，小列表仍用现有 `DndContext` + `SortableDoc`）：

```tsx
import VirtualDocList from '../components/VirtualDocList'

  // 在现有 filteredDocs.map(...) 分支处替换为：
  {filteredDocs.length > 100 ? (
    <VirtualDocList
      docs={filteredDocs}
      selectedId={selected?.id}
      height={window.innerHeight - 200}
      onSelect={viewDoc}
    />
  ) : (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={filteredDocs.map(d => d.id)} strategy={verticalListSortingStrategy}>
        {filteredDocs.map((doc) => (
          <SortableDoc key={doc.id} doc={doc} active={selected?.id === doc.id} onClick={() => viewDoc(doc)} onShare={handleDocShare} />
        ))}
      </SortableContext>
    </DndContext>
  )}
```

- [ ] **Step 4: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。对含数百文档的集合，列表滚动流畅且 DOM 节点数稳定（仅渲染可视区行）；文档数 ≤ 100 的集合保留拖拽排序能力。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/VirtualDocList.tsx frontend/src/pages/CollectionDetail.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): 大文档列表虚拟化渲染提升滚动性能"
```

---

## Task 16: a11y 全面审计与修复（P2-5，spec 6）

**Files:**
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/index.css`
- Modify: `src/components/WorkspaceTree.tsx`
- Modify: 各图标按钮调用处（补 `aria-label`）

**Dependencies:** Task 1（`:focus-visible` 已就绪）、Task 5（面包屑）

- [ ] **Step 1: `AppLayout.tsx` 新增“跳过到主内容”链接与地标角色**

在布局顶部插入 skip-link，主内容区加 `id="main-content"` 与 `role="main"`：

```tsx
  // 布局最外层首子元素：
  <a href="#main-content" className="skip-link">跳过导航，进入主内容</a>
  // 内容区：<main id="main-content" role="main">...</main>
  // 顶栏：<header role="banner">...</header>；侧栏：<nav aria-label="主导航">...</nav>
```

- [ ] **Step 2: `index.css` 新增 skip-link 与对比度/焦点样式**

```css
.skip-link {
  position: absolute; left: -9999px; top: 0; z-index: 1000;
  padding: 8px 16px; background: var(--accent); color: #fff; border-radius: 0 0 8px 0;
}
.skip-link:focus { left: 0; }
```

- [ ] **Step 3: 补全图标按钮 `aria-label`**

为无文字的图标按钮补可访问名（例：主题切换、侧栏折叠、删除、分享、上传）：

```tsx
  // AppLayout 主题按钮：<Button aria-label={theme === 'dark' ? '切换亮色主题' : '切换暗色主题'} ... />
  // WorkspaceDetail 折叠按钮：<Button aria-label={collapsed ? '展开目录' : '折叠目录'} ... />
  // 删除/分享/上传：<Button aria-label="删除工作空间" ... /> 等
```

- [ ] **Step 4: `WorkspaceTree.tsx` 补树的 ARIA 与键盘可达性**

过滤输入框加 `aria-label="过滤文件"`；antd `Tree` 已内置 `role="tree"`/键盘导航，确保 `Tree` 未禁用 `focusable`，右键菜单项可通过键盘触发（`Dropdown trigger={['click','contextMenu']}`）。

- [ ] **Step 5: 自动化审计**

Run: 在开发服务器（`npm run dev`）下，使用 a11y-debugging 技能依据 web.dev 指南对主要页面做审计（语义 HTML、ARIA、焦点、键盘导航、触摸目标、对比度）
Expected: skip-link 按 Tab 可见并能跳转主内容；所有图标按钮有可访问名；lighthouse a11y 得分 ≥ 90；键盘可完成导航→选文件→操作全流程。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AppLayout.tsx frontend/src/index.css frontend/src/components/WorkspaceTree.tsx frontend/src/pages/WorkspaceDetail.tsx
git commit -m "feat(frontend): a11y 审计修复（skip-link、aria-label、键盘可达）"
```

---

## Task 17: 树节点重命名/移动/拖拽悬停展开（P2-6，spec 3.5-2/3）

**Files:**
- Modify: `src/components/WorkspaceTree.tsx`
- Modify: `src/api/client.ts`（如需新增单文件重命名/移动 API）

**Dependencies:** Task 4（树 key 修复、右键菜单已就绪）

> 说明：重命名/移动需后端单文件 API 支持。若后端尚未提供，本 Task 先完成前端交互与拖拽悬停展开（纯前端），重命名/移动仍置灰直到 API 就绪。

- [ ] **Step 1: 拖拽悬停自动展开目录**

利用 antd `Tree` 的 `onDragEnter`：悬停在目录节点上时将其 key 并入 `expandedKeys`（基于 Task 4 的受控 `expandedKeys`）：

```tsx
  const handleDragEnter = ({ expandedKeys: keys }: { expandedKeys: Key[] }) => {
    setExpandedKeys(keys)   // antd 已计算悬停路径上需展开的 keys
  }
  // <Tree ... draggable onDragEnter={handleDragEnter} />
```

- [ ] **Step 2: 重命名内联编辑（前端交互）**

右键菜单“重命名”启用后，将节点 title 替换为受控 `Input`，回车提交：

```tsx
  const [renaming, setRenaming] = useState<string | null>(null)   // 正在重命名的文件 path
  const [renameValue, setRenameValue] = useState('')

  const submitRename = async (path: string) => {
    const next = renameValue.trim()
    if (next && next !== path.split('/').pop()) {
      await api.renameWorkspaceFile?.(path, next)   // 待后端 API；未就绪时菜单项 disabled
    }
    setRenaming(null)
  }
```

- [ ] **Step 3: 右键菜单启用重命名/移动（条件性）**

将 Task 4 中 `disabled: true` 的“重命名”/“移动”改为依后端能力位启用（例：`disabled: !api.renameWorkspaceFile`）；重命名触发 `setRenaming(path)`。

- [ ] **Step 4: 验证**

Run: `cd frontend; npm run build`
Expected: 零错误。拖拽文件悬停在折叠目录上约 0.5s 后自动展开；后端 API 就绪时重命名可内联编辑并提交，API 未就绪时菜单项保持置灰。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WorkspaceTree.tsx frontend/src/api/client.ts
git commit -m "feat(frontend): 树节点拖拽悬停展开与重命名/移动交互"
```

---

## Self-Review 自检清单

实施完成后，逐项确认：

- [ ] **构建零错误**：`cd frontend; npm run build`（`tsc -b && vite build`）全部通过，无 TypeScript 报错。
- [ ] **无重复请求**：列表↔详情来回导航，Network 面板无重复 `GET /api/workspaces`、`GET /api/collections`（Task 2 store 缓存生效）。
- [ ] **移动端可用**：375px 视口下 WorkspaceDetail 使用 Drawer 目录，触摸目标 ≥ 44px（Task 3）。
- [ ] **键盘可达**：Tab 遍历时 `:focus-visible` 焦点环可见（Task 1），目录树可键盘导航与回车选中（Task 4），Ctrl+K 呼出命令面板（Task 6）。
- [ ] **主题一致**：亮/暗主题切换无闪烁，代码高亮与 Mermaid 图表随主题切换（Task 12）。
- [ ] **组件复用**：FilePreviewCard（Task 8）、DualLayoutPage（Task 7）、FormModal/confirmDanger（Task 9）已在目标页面落地，无回归。
- [ ] **代码分割生效**：构建产物出现 `markdown-vendor`/`mermaid-vendor`/`react-vendor`/`antd-vendor` 独立 chunk（Task 10）。
- [ ] **URL 状态与滚动恢复**：集合筛选写入 `?q=`，刷新保持；列表滚动位置回退后恢复（Task 11）。
- [ ] **无占位符**：全文无 TODO/TBD；每个 Task 均含验证与 Commit 步骤。
- [ ] **获取代码评审**：使用 requesting-code-review 技能对已完成阶段（P0/P1/P2）的变更发起审阅。

---

