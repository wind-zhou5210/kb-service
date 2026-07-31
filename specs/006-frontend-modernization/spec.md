# 前端体验现代化优化 需求规范

Version: 1.0
Created: 2026-07-30
Status: Draft

## 1. 背景与目标

### 1.1 现状总结

kb-service 前端基于 React 18 + TypeScript + Vite + Ant Design 5 + Zustand 构建，已具备一套克制的"墨色系"设计系统（`frontend/src/index.css` 中的 `--ink-900` ~ `--ink-50` 灰阶 + 单一强调色 `--accent`），并支持亮/暗双主题（`store/theme.ts` 通过 `data-theme` 属性 + `localStorage('kb-theme')` + `prefers-color-scheme` 实现）。经过前期调研，各维度评分如下：

| 维度 | 评分 | 现状说明 |
|------|------|----------|
| 设计系统 | 8.5/10 | CSS 变量体系完整（灰阶/强调色/语义色/圆角/阴影/缓动），但缺少焦点环、禁用态、遮罩层等状态变量 |
| 交互体验 | 7/10 | 基础交互完备，但缺少面包屑、全局命令面板、目录树键盘操作/右键菜单等效率型交互 |
| 响应式 | 6.5/10 | `index.css` 仅有 1024px（隐藏 TOC）与 768px（header/md-body 内边距）两个断点，`WorkspaceDetail` 双栏布局在移动端会被挤压至不可用 |
| 暗色模式 | 8/10 | `[data-theme="dark"]` 变量覆盖完整、antd `darkAlgorithm` 已接入（`main.tsx`），但 highlight.js 样式固定引入 `github-dark.css` 不随主题切换 |
| 性能 | 7/10 | `App.tsx` 所有页面静态 import 无代码分割；各页面独立 `load()` 拉取数据，路由切换即重复请求 |

### 1.2 目标

1. **视觉一致性**：统一 Workspace / Collection 两套卡片风格（当前分别使用 antd `Card` 与自制 `.col-card`），升级卡片质感与加载动画。
2. **导航效率**：引入面包屑与 Ctrl+K 全局搜索浮层，降低页面间跳转成本。
3. **工作空间体验**：`WorkspaceDetail` 双栏布局支持拖拽调宽、目录树支持键盘导航/右键菜单/树内过滤，移动端可用。
4. **性能与工程质量**：路由级代码分割、列表数据 store 化去重复请求、补齐可访问性（a11y）基线。

### 1.3 非目标

| 不做的事 | 说明 |
|----------|------|
| 后端改动 | 所有优化仅涉及 `frontend/`，不新增/修改任何 API |
| 大规模架构重写 | 不更换 UI 库、不引入 SSR/微前端，保持 Vite + antd 5 + Zustand 现有架构 |
| 分享页（`/share/*`）重构 | `SharedCollection` / `SharedDocument` / `SharedWorkspace` 仅同步复用新组件，不单独设计 |
| 编辑器能力 | 不新增在线编辑 Markdown 功能 |

### 1.4 技术上下文

- 路由：`react-router-dom` ^7.1.1，路由表见 `frontend/src/App.tsx`（`/`、`/collections/:id`、`/search`、`/workspaces`、`/workspaces/:id`、`/share/*`）
- 状态：Zustand ^5.0.2，现有 store 仅 `store/auth.ts`（token）与 `store/theme.ts`（主题）
- 拖拽：`@dnd-kit/core` + `@dnd-kit/sortable` 已用于 Collections 卡片排序
- 渲染：`react-markdown` + `rehype-highlight` + `katex` + `mermaid`（`MarkdownViewer.tsx`）
- 主题接入点：`main.tsx` 的 `ConfigProvider`（`darkAlgorithm` / token 映射 CSS 变量色值）

---

## 2. 视觉设计升级

### 2.1 卡片设计统一与升级

**现状问题**：

- `Workspaces.tsx` 使用 antd `<Card hoverable>` + 内联样式图标容器（40×40、`var(--subtle-bg)` 背景），删除操作放在 `actions` 底栏。
- `Collections.tsx` 使用自制 `CollectionCard.tsx`（`.col-card` 类，`index.css` 定义），32×32 图标容器，操作收在 `MoreOutlined` 下拉菜单。
- 两套卡片的图标尺寸、hover 行为（`.col-card:hover` 仅 `border-color: var(--ink-400)`，antd Card 为默认阴影）、操作入口位置均不一致。

**设计方案**：

1. 统一为增强版 `.col-card` 风格（自制卡片可控性更强，antd Card 退役），hover 时：

```css
.col-card {
  transition: border-color 0.15s var(--ease), transform 0.15s var(--ease), box-shadow 0.15s var(--ease);
}
.col-card:hover {
  border-color: var(--ink-400);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
```

2. 图标容器统一为 36×36，加入类型化渐变底色（沿用 `--md-color` / `--html-color` 文件色系的思路）：

```css
.card-icon {
  width: 36px; height: 36px; border-radius: var(--r-lg);
  background: linear-gradient(135deg, var(--accent-tint), var(--surface));
  border: 1px solid var(--border);
}
```

3. Workspace 卡片操作入口改为与 `CollectionCard` 一致的 `Dropdown` + `MoreOutlined`，移除 antd `actions` 底栏。

**涉及文件**：`index.css`、`components/CollectionCard.tsx`、`pages/Workspaces.tsx`、新增 `components/FilePreviewCard.tsx`（见 4.1）

**验收标准**：

- [ ] Workspace 与 Collection 卡片图标容器尺寸、hover 效果（上移 2px + 阴影）、操作菜单位置完全一致
- [ ] hover 过渡使用 `var(--ease)`，无跳变；暗色模式下阴影使用暗色 `--shadow-md` 值
- [ ] 卡片可点击区域不含操作菜单（`stopPropagation` 行为与现有 `CollectionCard` 一致）

### 2.2 暗色模式变量完善

**现状问题**：`index.css` 的 `:root` / `[data-theme="dark"]` 已覆盖灰阶、强调色、语义色、表面色，但缺少以下状态变量，导致各组件在需要时只能硬编码或借用 `--border`：焦点环、禁用态、分隔线、弹层遮罩。

**设计方案**：在 `:root` 与 `[data-theme="dark"]` 各补充 4 个变量：

```css
:root {
  --focus-ring: rgba(79, 70, 229, 0.35);   /* 键盘焦点环，基于 --accent */
  --disabled: #A1A1AA;                      /* 禁用态文字/图标 */
  --divider: #F4F4F5;                       /* 弱分隔线（比 --border 更浅） */
  --backdrop: rgba(0, 0, 0, 0.45);          /* Modal/Drawer 遮罩 */
}
[data-theme="dark"] {
  --focus-ring: rgba(129, 140, 248, 0.4);   /* 基于暗色 --accent #818CF8 */
  --disabled: #52525B;
  --divider: #1F1F23;
  --backdrop: rgba(0, 0, 0, 0.65);
}
```

全局焦点样式（配合第 6 章 a11y）：

```css
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
```

**涉及文件**：`index.css`

**验收标准**：

- [ ] 亮/暗两套主题下新增变量均有定义，切换主题无闪烁
- [ ] Tab 键聚焦任意可交互元素可见焦点环，鼠标点击不出现焦点环（`:focus-visible` 语义）

### 2.3 加载动画优化（shimmer 骨架屏）

**现状问题**：加载态样式不统一——`Workspaces.tsx` 用 3 个 `<Skeleton active>` 占位卡片；`Collections.tsx` 用居中 `<Spin />`；`WorkspaceDetail.tsx` 用 `<Skeleton active paragraph={{ rows: 12 }}>`。`Spin` 转圈无法暗示内容结构，视觉跳动大。

**设计方案**：

1. 统一使用骨架屏，移除 `Collections.tsx` 的 `Spin`，改为与 `Workspaces.tsx` 一致的骨架卡片网格。
2. 新增自定义 shimmer 类用于非 antd 场景（如目录树加载）：

```css
.skeleton-shimmer {
  background: linear-gradient(90deg, var(--subtle-bg) 25%, var(--border) 50%, var(--subtle-bg) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease infinite;
  border-radius: var(--r-sm);
}
@keyframes shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
```

3. 骨架卡片数量与栅格列数匹配（复用现有 `Col xs={24} sm={12} md={8}` 断点）。

**涉及文件**：`index.css`、`pages/Collections.tsx`、`pages/Workspaces.tsx`、`pages/WorkspaceDetail.tsx`

**验收标准**：

- [ ] 所有列表/详情页加载态均为骨架屏，无 `Spin` 转圈
- [ ] 暗色模式下 shimmer 渐变色取自 CSS 变量，不出现刺眼亮块

### 2.4 第三方库暗色适配

**现状问题**：

- `main.tsx` 固定 `import 'highlight.js/styles/github-dark.css'`，代码高亮配色不随主题切换。当前因 `.md-body pre` 背景恒为深色（亮色主题下 `--ink-900`，暗色下覆写为 `#0A0A0B`）而勉强协调，但属于隐式耦合——若未来调整 pre 背景即失配。
- `mermaid` ^11.4.1 已在依赖中，其图表主题初始化后不随 `data-theme` 切换，暗色下白底图表突兀。

**设计方案**：

1. highlight.js：改为在 `index.html` 或 `main.tsx` 动态挂载两份主题样式（`github.css` / `github-dark.css`），通过 `disabled` 属性随主题切换；或维持"代码块恒深底"策略并在 spec 注释中显式声明该耦合。推荐前者：

```ts
// theme.ts applyTheme() 内追加
document.querySelectorAll<HTMLLinkElement>('link[data-hljs]').forEach(l => {
  l.disabled = l.dataset.hljs !== theme
})
```

2. mermaid：渲染前根据主题传入 `mermaid.initialize({ theme: isDark ? 'dark' : 'default' })`，主题切换时对已渲染图表重渲染（监听 `useTheme` 变化）。

**涉及文件**：`main.tsx`、`store/theme.ts`、`components/MarkdownViewer.tsx`、`index.html`

**验收标准**：

- [ ] 亮色模式代码块使用亮色高亮主题（或明确保留深底策略且文档化）
- [ ] 暗色模式下 Mermaid 图表为暗色主题，切换主题后已打开文档中的图表同步更新

---

## 3. 页面交互与布局优化（重点）

### 3.1 面包屑导航

**现状问题**：`AppLayout.tsx` 顶栏仅有 logo + 两个导航按钮（"知识集合"/"工作空间"，通过 `location.pathname` 判断高亮）。进入 `WorkspaceDetail` 后用户无法感知当前位置层级，返回依赖侧栏内的"返回"小按钮（`ArrowLeftOutlined`）；`CollectionDetail` 同样缺少路径感知。

**设计方案**：

1. 新增 `components/Breadcrumbs.tsx`，渲染于 `AppLayout` header 导航按钮之后（或详情页内容区顶部），基于 antd `Breadcrumb` 组件。
2. 路径构成规则：

```
/                    → 知识集合
/collections/:id     → 知识集合 > {集合名}
/workspaces          → 工作空间
/workspaces/:id      → 工作空间 > {空间名}
/workspaces/:id + 选中文件 → 工作空间 > {空间名} > {文件相对路径逐段}
```

3. 空间名/集合名来源：详情页通过 context 或 Zustand store（见 5.1 `workspaceStore`）上报当前实体名，`Breadcrumbs` 订阅渲染，避免重复请求。
4. 文件路径段可点击：点击中间目录段 = 在目录树中展开并定位该目录（联动 3.5）。
5. 移动端（<768px）仅显示最后两段，前缀折叠为"…"。

**涉及文件**：新增 `components/Breadcrumbs.tsx`；`components/AppLayout.tsx`、`pages/WorkspaceDetail.tsx`、`pages/CollectionDetail.tsx`、`store/`（新增 store）

**验收标准**：

- [ ] Given 用户在 `/workspaces/3` 且选中 `docs/api/auth.md`，Then 面包屑显示"工作空间 > {空间名} > docs > api > auth.md"
- [ ] 点击"工作空间"段跳转 `/workspaces`；点击空间名段回到该空间默认态
- [ ] 面包屑名称与实体真实名称一致，重命名后即时更新

### 3.2 全局搜索浮层（Ctrl+K 命令面板）

**现状问题**：`AppLayout.tsx` 的搜索框 `onPressEnter` 执行 `navigate('/search?q=...')` 整页跳转到 `Search.tsx`，用户被迫离开当前上下文；无键盘快捷入口。

**设计方案**：

1. 新增 `components/CommandPalette.tsx`，基于 antd `Modal`（无 footer、顶部对齐）实现浮层：
   - 全局监听 `Ctrl+K` / `Cmd+K`（`AppLayout` 挂载 `keydown` 监听，`e.preventDefault()` 避免浏览器默认行为）
   - 输入防抖 300ms 调用现有 `api.search(q)`（复用 `Search.tsx` 的 `SearchResult` 类型与 `<<>>` 高亮片段协议）
   - 结果列表支持 ↑/↓ 选择、Enter 跳转、Esc 关闭
2. 跳转规则与 `Search.tsx` 现有结果点击行为一致（文档 → 所属集合/空间对应路由）。
3. 顶栏原搜索框保留，placeholder 追加快捷键提示"搜索文档… Ctrl+K"；按 Enter 行为改为打开浮层（`/search` 页保留作为完整结果页，浮层底部提供"查看全部结果"入口跳转）。

**涉及文件**：新增 `components/CommandPalette.tsx`；`components/AppLayout.tsx`、`pages/Search.tsx`（高亮函数 `highlightSnippet` 抽出复用）

**验收标准**：

- [ ] 任意登录页面按 Ctrl+K 打开浮层，焦点自动进入输入框
- [ ] 输入关键词 300ms 后展示结果（含高亮片段），↑/↓/Enter/Esc 全键盘可操作
- [ ] Enter 跳转目标文档后浮层关闭；"查看全部结果"跳转 `/search?q={q}`
- [ ] 浮层打开期间背景页面不滚动

### 3.3 WorkspaceDetail 双栏布局改进

**现状问题**：

- `WorkspaceDetail.tsx` 的 `<aside>` 宽度硬编码 280px（`width: collapsed ? 0 : 280`），不可调整；长文件名在树中截断严重。
- 折叠状态已通过 `SIDEBAR_COLLAPSED_KEY = 'kb_ws_sidebar_collapsed'` 持久化到 localStorage（保留该实现），但宽度无记忆。
- 通过 Markdown 内链（`handleInternalLink`）或 iframe `ws-navigate` 事件切换文件后，`WorkspaceTree` 的 `selectedKeys` 虽会高亮，但深层节点不会自动滚动进侧栏可视区域。

**设计方案**：

1. **可拖拽宽度**：侧栏与内容区之间增加 6px 拖拽手柄（`cursor: col-resize`），拖拽范围钳制在 200–400px，宽度存入 `localStorage('kb_ws_sidebar_width')`：

```tsx
const [width, setWidth] = useState(() => clamp(Number(localStorage.getItem(WIDTH_KEY)) || 280, 200, 400))
const onDrag = (e: PointerEvent) => setWidth(clamp(e.clientX, 200, 400))
// pointerup 时写入 localStorage；拖拽期间给 body 加 user-select: none
```

   折叠逻辑不变：`collapsed` 时 `width` 视为 0，展开恢复记忆宽度；折叠按钮（`MenuFoldOutlined` / `MenuUnfoldOutlined` 悬浮按钮）的 `left` 定位由 `collapsed ? 8 : width + 8` 计算。

2. **选中文件自动高亮 + 滚动**：`WorkspaceTree.tsx` 中监听 `selectedFile` 变化：
   - 计算该文件所有祖先目录 key 并合并进受控 `expandedKeys`（当前依赖 `defaultExpandAll`，改为受控以支持按需展开）
   - `useEffect` 中 `document.querySelector('.ant-tree-node-selected')?.scrollIntoView({ block: 'nearest' })`

3. **目录 key 修复（顺带）**：`toAntdTree` 中目录 key 为 `dir:${node.name}`，深层同名目录（如多处 `assets/`）key 冲突会导致展开状态错乱。改为携带完整路径：`dir:${parentPath}/${node.name}`。

**涉及文件**：`pages/WorkspaceDetail.tsx`、`components/WorkspaceTree.tsx`

**验收标准**：

- [ ] 拖动手柄可在 200–400px 间调整侧栏宽度，刷新后宽度保持
- [ ] 折叠/展开行为与现状一致且与宽度记忆兼容
- [ ] Given 通过文档内链跳转到深层文件，Then 目录树自动展开祖先目录、选中项高亮且滚动到可视区域
- [ ] 存在同名子目录的工作空间中，展开/折叠互不干扰

### 3.4 移动端适配

**现状问题**：`index.css` 响应式仅覆盖 TOC 隐藏与内边距缩减；`WorkspaceDetail` 的 flex 双栏（`aside` 280px + `main`）在 375px 宽屏幕上内容区仅剩约 95px，实际不可用。顶栏搜索框 `maxWidth: 280` 挤占导航按钮；多处小尺寸按钮（`size="small"`）触摸目标不足 44px。

**设计方案**：

1. **WorkspaceDetail 移动端（<768px）改为抽屉式目录树**：
   - 侧栏 `<aside>` 隐藏，改用 antd `Drawer`（`placement="left"`，宽度 80vw）承载 `WorkspaceTree` 与空间信息/按钮组
   - 内容区顶部固定一个"目录"触发按钮（含当前文件名），点击打开 Drawer；选中文件后 Drawer 自动关闭
   - 断点检测封装 `hooks/useMediaQuery.ts`（`window.matchMedia('(max-width: 768px)')`）
2. **触摸目标**：全局补充：

```css
@media (pointer: coarse) {
  .doc-item { min-height: 44px; }
  .ant-tree-treenode { min-height: 44px; align-items: center; }
  .app-header button { min-width: 44px; min-height: 44px; }
}
```

3. **顶栏**：<768px 时隐藏搜索输入框，保留一个搜索图标按钮（点击打开 3.2 命令面板）；导航按钮仅显示图标。
4. 卡片网格已有 `xs={24}` 单列适配，保持不变。

**涉及文件**：`pages/WorkspaceDetail.tsx`、`components/AppLayout.tsx`、`index.css`、新增 `hooks/useMediaQuery.ts`

**验收标准**：

- [ ] 375px 宽度下 WorkspaceDetail 内容区占满全宽，目录树通过 Drawer 访问，选中文件后 Drawer 关闭并展示内容
- [ ] 触摸设备上文件行、树节点、顶栏按钮触摸区域 ≥ 44×44px
- [ ] 桌面端（≥768px）行为与现状完全一致，无回归

### 3.5 目录树交互增强

**现状问题**：`WorkspaceTree.tsx` 仅是 antd `Tree` 的薄封装（`defaultExpandAll` + `showIcon`），无键盘导航定制、无右键菜单、无树内过滤；文件多时只能滚动肉眼查找。

**设计方案**：

1. **键盘导航**：利用 antd Tree 原生 `↑/↓`（焦点移动）与 `←/→`（折叠/展开）能力，补充 `Enter` 选中当前焦点文件（`onKeyDown` 中读取 `activeKey`）；树容器可聚焦（`tabIndex=0`）。
2. **右键上下文菜单**：`Tree` 的 `onRightClick` 事件 + antd `Dropdown`（受控 `open` + 动态 `position`）：
   - 文件节点：复制链接（`copyToClipboard` 复用 `utils/clipboard.ts`）、重命名、移动、删除
   - 目录节点：重命名、删除
   - 说明：重命名/移动/删除依赖后端已有单文件 API 能力；若后端暂缺对应端点，菜单先只提供"复制链接"，其余置灰并标注（遵循 1.3 非目标——本期不改后端）
3. **拖拽悬停自动展开**：若启用 Tree `draggable`，配置 antd 内建的拖拽悬停展开（`onDragEnter` 中 `setExpandedKeys` 追加目标目录，延迟 600ms）。本期文件移动若无后端支持，则该项与"移动"一并降级为 P2。
4. **树内过滤**：树顶部加过滤输入框，按文件名大小写不敏感匹配；命中节点保留其祖先链，自动展开全部命中路径，匹配片段高亮：

```tsx
function filterTree(nodes: WorkspaceTreeNode[], q: string): WorkspaceTreeNode[] {
  return nodes.map(n => n.type === 'directory'
      ? { ...n, children: filterTree(n.children ?? [], q) }
      : n)
    .filter(n => n.type === 'directory' ? (n.children?.length ?? 0) > 0 : n.name.toLowerCase().includes(q))
}
```

**涉及文件**：`components/WorkspaceTree.tsx`、`pages/WorkspaceDetail.tsx`、`utils/clipboard.ts`

**验收标准**：

- [ ] 树获得焦点后，↑/↓ 移动、←/→ 折叠展开、Enter 打开文件，全程无需鼠标
- [ ] 右键文件节点弹出上下文菜单，"复制链接"复制该文件的应用内路径；无后端支持的项置灰
- [ ] 过滤框输入"auth"，仅显示名称含 auth 的文件及其祖先目录，清空后恢复原树与展开状态

### 3.6 上下文保持

**现状问题**：

- `Collections.tsx` 的搜索过滤词存于组件 `useState('search')`，`Workspaces.tsx` 无过滤；进入详情再返回后过滤条件与滚动位置全部丢失（组件重新挂载、`load()` 重新请求）。
- `Search.tsx` 已正确使用 `useSearchParams` 存 `q`（保持该模式并推广）。
- 页面切换仅有全局 `.page-fade`（0.2s opacity 动画，`AppLayout` 包裹层）。

**设计方案**：

1. **滚动恢复**：列表页离开前将 `window.scrollY` 记入 `sessionStorage('kb_scroll:' + pathname)`，返回且数据就绪后恢复；配合 5.1 store 缓存，返回时无加载闪烁。
2. **筛选/排序进 URL**：`Collections.tsx` 的 `search` 改为 `useSearchParams` 的 `?q=` 参数（对齐 `Search.tsx` 模式）；后续新增排序项同样入 query。
3. **过渡动画**：保留 `.page-fade`，为详情页内容区文件切换补充同款 fade（`key={selectedFile}` 触发重挂载动画），不引入额外动画库。

**涉及文件**：`pages/Collections.tsx`、`pages/Workspaces.tsx`、`pages/WorkspaceDetail.tsx`、`index.css`

**验收标准**：

- [ ] Given 在集合列表滚动到底部并输入过滤词，When 进入某集合再点浏览器返回，Then 过滤词（URL 中可见）与滚动位置均恢复
- [ ] 刷新带 `?q=` 的列表页，过滤态直接生效
- [ ] 文件切换时内容区有 0.2s 淡入，无布局跳动

### 3.7 操作反馈统一

**现状问题**：

- 破坏性确认已基本统一用 `Modal.confirm`（`Workspaces.tsx`、`WorkspaceDetail.tsx`、`CollectionCard.tsx` 均显示目标名称「{name}」），但 `Collections.tsx` 的 `handleDelete` 直接调 `api.deleteCollection` ——确认弹窗在 `CollectionCard` 内部，职责分散；文案格式（"不可恢复"/"不可撤销"）不一致。
- 创建/编辑一律用 `Modal` + 受控 `Input`/`TextArea`（无 `Form` 校验，空名仅静默 return，无错误提示）。
- 上传无进度反馈：`WorkspaceDetail.handleUpload` 中 `uploading` state 已存在但 UI 未消费，大 zip 上传期间弹窗无任何进度指示。

**设计方案**：

1. **破坏性操作**：封装 `confirmDanger({ title, targetName, onOk })` 工具函数，统一红色 `okType: 'danger'`、统一文案模板"确认删除「{targetName}」？此操作不可恢复。"，全站替换零散的 `Modal.confirm`。
2. **创建类操作改 Drawer**：新建工作空间/集合改用 antd `Drawer`（右侧滑出，480px）+ `Form` 校验（名称必填、长度上限），提交按钮 loading 态；实现载体为 4.3 的 `FormModal`（支持 modal/drawer 双形态）。
3. **上传进度**：`api.uploadWorkspaceZip` 透传 axios `onUploadProgress`，上传弹窗内显示 `Progress` 条；同时顶栏下方挂全局细进度条（上传期间跨页面可见）。

**涉及文件**：新增 `utils/confirm.ts`；`pages/Collections.tsx`、`pages/Workspaces.tsx`、`pages/WorkspaceDetail.tsx`、`components/CollectionCard.tsx`、`api/client.ts`（仅前端函数签名加回调参数，不动接口协议）

**验收标准**：

- [ ] 全站删除类操作确认弹窗均显示目标名称、红色确认按钮、统一文案
- [ ] 新建表单名称为空时提交给出行内校验错误，不再静默失败
- [ ] 上传 50MB+ zip 时弹窗内进度条实时推进，完成前可见百分比

### 3.8 空状态与引导

**现状问题**：`EmptyState.tsx` 组件（`.empty-wrap` 样式：48×48 线框图标 + 标题 + 描述 + 按钮）已在各页复用，结构完善但视觉单薄（单色图标）；空工作空间详情页仅提示"选择一个文件"，未引导上传；上传入口不支持页面级拖拽。

**设计方案**：

1. `EmptyState` 图标区升级为品牌化插画风格（CSS 绘制的层叠文件图形或内联 SVG，随主题变量着色），保留现有 `icon/title/description/actionText/onAction` API 不变。
2. 空工作空间（`tree.length === 0`）时内容区展示"拖拽 zip 到此处或点击上传"引导区，整个内容区注册 `onDragOver/onDrop` 直接触发 `handleUpload`。
3. 空集合、无搜索结果场景补充 CTA（如"上传第一篇文档"）。

**涉及文件**：`components/EmptyState.tsx`、`pages/WorkspaceDetail.tsx`、`pages/CollectionDetail.tsx`、`index.css`

**验收标准**：

- [ ] 空工作空间打开详情页即见上传引导，向内容区拖入 zip 文件直接开始上传
- [ ] 各空状态均有明确 CTA 按钮，插画在暗色模式下正常显示

---

## 4. 组件架构与复用

### 4.1 FilePreviewCard 通用卡片组件

**现状问题**：`Workspaces.tsx` 内联 60+ 行 antd Card JSX 与 `CollectionCard.tsx` 大量重复（图标容器、标题省略、描述兜底"暂无描述"、meta 行、`relativeTime`）。

**设计方案**：抽取 `components/FilePreviewCard.tsx`：

```tsx
interface FilePreviewCardProps {
  icon: React.ReactNode
  title: string
  description?: string | null
  meta: React.ReactNode          // 如 "{n} 个文件 · {size}" / "{n} 篇 · {time}"
  shared?: boolean               // 右上角分享标记（对应 share_token）
  menuItems: MenuProps['items']  // 操作下拉
  onClick: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>  // 兼容 dnd-kit 排序
}
```

`CollectionCard` 改为其薄包装（保留删除/取消分享确认逻辑），`Workspaces.tsx` 直接使用。样式统一走 2.1 升级后的 `.col-card`。

**涉及文件**：新增 `components/FilePreviewCard.tsx`；重构 `components/CollectionCard.tsx`、`pages/Workspaces.tsx`

**验收标准**：

- [ ] 两个列表页卡片渲染自同一组件，Collections 拖拽排序（dnd-kit）功能无回归
- [ ] 组件不含任何业务 API 调用（纯展示 + 回调）

### 4.2 DualLayoutPage 双栏布局组件

**现状问题**：`WorkspaceDetail.tsx` 的侧栏折叠/宽度/悬浮按钮逻辑（约 40 行布局代码）与 `SharedWorkspace.tsx`、未来的 `CollectionDetail` 双栏需求重复。

**设计方案**：抽取 `components/DualLayoutPage.tsx`，封装 3.3 与 3.4 的全部布局能力：

```tsx
interface DualLayoutPageProps {
  sidebar: React.ReactNode
  children: React.ReactNode
  storageKeyPrefix: string   // 派生 `${prefix}_collapsed` / `${prefix}_width`
  minWidth?: number          // 默认 200
  maxWidth?: number          // 默认 400
  mobileDrawerTitle?: string // <768px 抽屉标题
}
```

内部职责：宽度拖拽 + localStorage 持久化、折叠悬浮按钮、移动端自动切换 Drawer 形态。`WorkspaceDetail` 迁移后现有 `SIDEBAR_COLLAPSED_KEY` 值格式保持兼容（沿用 `'kb_ws_sidebar'` 前缀）。

**涉及文件**：新增 `components/DualLayoutPage.tsx`；重构 `pages/WorkspaceDetail.tsx`、`pages/SharedWorkspace.tsx`

**验收标准**：

- [ ] WorkspaceDetail 与 SharedWorkspace 使用同一布局组件，折叠状态老用户 localStorage 值仍生效
- [ ] 布局组件不感知业务数据（树/文件内容均由 props 注入）

### 4.3 FormModal 表单弹窗标准化

**现状问题**：新建/编辑集合与工作空间共 4 处弹窗，均为 `Modal` + 手写受控 state（`newName/newDesc/editName/editDesc`），无校验、无提交 loading、关闭不重置。

**设计方案**：抽取 `components/FormModal.tsx`：

```tsx
interface FormModalProps<T> {
  open: boolean
  title: string
  mode?: 'modal' | 'drawer'          // 3.7：创建类默认 drawer
  initialValues?: Partial<T>
  fields: FormField[]                 // { name, label, required, maxLength, type: 'input' | 'textarea' }
  onSubmit: (values: T) => Promise<void>  // 内部管理 loading 与错误 message
  onClose: () => void
}
```

内置 antd `Form` 校验、提交 loading、成功后自动关闭并 `form.resetFields()`。

**涉及文件**：新增 `components/FormModal.tsx`；重构 `pages/Collections.tsx`、`pages/Workspaces.tsx`、`pages/WorkspaceDetail.tsx`（编辑空间信息）

**验收标准**：

- [ ] 4 处新建/编辑弹窗全部迁移，名称必填校验生效，提交期间按钮 loading
- [ ] 关闭后重新打开表单为初始态（无上次残留输入）

---

## 5. 状态管理与性能

### 5.1 Zustand workspaceStore / collectionStore

**现状问题**：`Workspaces.tsx` 与 `Collections.tsx` 各自在 `useEffect` 中 `load()` 全量拉取；每次路由进入都重新请求且加载态闪烁；详情页与列表页数据完全隔离（`WorkspaceDetail` 再次 `api.getWorkspace`），面包屑（3.1）也需要跨组件读取实体名。

**设计方案**：仿照现有 `store/auth.ts` / `store/theme.ts` 风格新增两个 store：

```ts
// store/workspace.ts
interface WorkspaceStore {
  list: Workspace[]
  loaded: boolean                       // 首次加载完成标记
  current: Workspace | null             // 详情页当前空间（面包屑数据源）
  fetchList: (force?: boolean) => Promise<void>   // loaded 且非 force 时直接返回缓存
  mutate: () => Promise<void>           // 增删改后强制刷新
  setCurrent: (ws: Workspace | null) => void
}
```

- 列表页：`useEffect(() => { fetchList() }, [])`，缓存命中时立即渲染（无骨架屏），后台静默 revalidate。
- 写操作（创建/删除/上传/编辑）后调用 `mutate()`，保证一致性。
- `collectionStore` 同构。不引入 react-query，保持零新依赖。

**涉及文件**：新增 `store/workspace.ts`、`store/collection.ts`；`pages/Workspaces.tsx`、`pages/Collections.tsx`、`pages/WorkspaceDetail.tsx`、`pages/CollectionDetail.tsx`

**验收标准**：

- [ ] 列表页 → 详情页 → 返回列表，无重复网络请求（DevTools Network 验证）、无骨架屏闪烁
- [ ] 新建/删除后列表即时反映最新数据
- [ ] 退出登录（`auth.logout`）时两个 store 清空

### 5.2 路由级代码分割

**现状问题**：`App.tsx` 静态 import 全部 9 个页面；`mermaid`（约 1.5MB+）、`katex`、`highlight.js` 随 `MarkdownViewer` 被打进主包，登录页也要下载全部依赖。

**设计方案**：

1. 页面级 `React.lazy`：

```tsx
const Collections = lazy(() => import('./pages/Collections'))
// ... 其余页面同理；Login 保持同步（首屏）
<Suspense fallback={<PageSkeleton />}><Routes>…</Routes></Suspense>
```

2. `vite.config.ts` 配置 `build.rollupOptions.output.manualChunks`，将 `mermaid`、`katex`、`highlight.js`、`antd` 拆为独立 chunk。
3. `Suspense fallback` 使用 2.3 的骨架屏组件，避免白屏。

**涉及文件**：`App.tsx`、`vite.config.ts`、新增 `components/PageSkeleton.tsx`

**验收标准**：

- [ ] `npm run build` 后主入口 chunk 体积较改造前下降 ≥ 40%，mermaid/katex 为独立按需 chunk
- [ ] 登录页首屏不加载 Markdown 渲染相关依赖（Network 验证）
- [ ] 路由切换 fallback 为骨架屏，无白屏闪烁

### 5.3 大列表虚拟化（可选）

**现状问题**：`WorkspaceTree` 的 antd `Tree` 与 `CollectionDetail` 文档列表在数千节点时首次渲染卡顿。当前典型数据量（数百文件）尚可接受，故列为可选项。

**设计方案**：

1. 优先使用 antd Tree 内建虚拟滚动：设置 `height` 属性即启用（零新依赖），注意与 3.3 的 `scrollIntoView` 改为 Tree 实例的 `scrollTo({ key })`。
2. 文档平铺列表若超过 500 项，引入 `react-window`（新增依赖，需评审）`FixedSizeList` 渲染 `DocListItem`。
3. 触发阈值：节点数 > 500 时启用，避免小数据集损失"整树可见"体验。

**涉及文件**：`components/WorkspaceTree.tsx`、`pages/CollectionDetail.tsx`、`package.json`（如引入 react-window）

**验收标准**：

- [ ] 2000 节点模拟数据下树首次渲染 < 500ms，滚动 60fps 无明显掉帧
- [ ] 虚拟化开启后键盘导航（3.5）与自动定位（3.3）仍正常

---

## 6. 可访问性（a11y）

**现状问题**：图标按钮多数无可读文本（如 `AppLayout` 主题切换按钮仅有 `title`、头像 Dropdown 无 `aria-label`）；`.doc-item`、`.col-card`、`.toc-item` 为可点击 `div/span`，键盘不可达；焦点样式依赖浏览器默认；`Modal` 关闭后焦点不回归触发元素（antd 默认行为需验证）；`--ink-400`（#71717A）作正文辅助色在部分背景上对比度临界。

**设计方案**：

| 项 | 措施 |
|----|------|
| ARIA 标签 | 所有纯图标按钮补 `aria-label`（主题切换、折叠侧栏、删除、更多操作等）；`Breadcrumb`/`Tree`/`Drawer` 使用 antd 内建 ARIA 能力 |
| 键盘可达 | `.col-card`、`.doc-item` 增加 `role="button"` + `tabIndex={0}` + Enter/Space 触发；或改用原生 `<button>` 重置样式 |
| 焦点管理 | 全局 `:focus-visible` 焦点环（2.2 `--focus-ring`）；Modal/Drawer 关闭后焦点返回触发按钮（antd `autoFocus` + 手动 `ref.focus()` 兜底）；CommandPalette 内焦点圈闭（focus trap） |
| 屏幕阅读器 | 加载态容器 `aria-busy="true"`；搜索结果数用 `aria-live="polite"` 播报；`EmptyState` 图标 `aria-hidden` |
| 颜色对比度 | 审计 `--ink-400` 及以下色阶的使用场景：正文性文字最低使用 `--ink-500`，`--ink-300/400` 仅用于装饰性/mono 元数据；确保关键文本对比度 ≥ 4.5:1（WCAG AA） |

**涉及文件**：全部组件与页面文件、`index.css`

**验收标准**：

- [ ] 仅用键盘可完成：登录 → 浏览列表 → 打开卡片 → 目录树选文件 → 打开命令面板搜索 → 退出登录 全流程
- [ ] axe DevTools 扫描主要页面无 critical/serious 级别问题
- [ ] 亮/暗两模式下正文与交互文本对比度均 ≥ 4.5:1

---

## 7. 实施计划

### 7.1 P0 短期（1–2 周）——导航与移动端可用性

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|----------|----------|
| P0-1 | 面包屑导航（3.1，依赖 P0-5 store 提供实体名） | 新增 `Breadcrumbs.tsx`；`AppLayout.tsx` | 三级路径正确展示且可点击跳转 |
| P0-2 | WorkspaceDetail 移动端 Drawer 化 + 44px 触摸目标（3.4） | `WorkspaceDetail.tsx`、`index.css`、新增 `useMediaQuery.ts` | 375px 宽度全流程可用，桌面端无回归 |
| P0-3 | 目录树键盘导航 + 右键菜单（复制链接）+ 树内过滤（3.5），含目录 key 冲突修复 | `WorkspaceTree.tsx` | 全键盘操作可用；过滤正确保留祖先链 |
| P0-4 | 暗色变量补全 + `:focus-visible` 焦点环（2.2） | `index.css` | 新变量双主题生效，Tab 焦点可见 |
| P0-5 | workspaceStore / collectionStore（5.1） | 新增 `store/workspace.ts`、`store/collection.ts` 及 4 个页面接入 | 返回列表零重复请求 |

### 7.2 P1 中期（2–4 周）——效率交互与视觉升级

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|----------|----------|
| P1-1 | Ctrl+K 命令面板（3.2） | 新增 `CommandPalette.tsx`；`AppLayout.tsx`、`Search.tsx` | 快捷键唤起、全键盘搜索跳转 |
| P1-2 | 侧栏拖拽调宽 + 选中项自动滚动（3.3），沉淀 `DualLayoutPage`（4.2） | 新增 `DualLayoutPage.tsx`；`WorkspaceDetail.tsx`、`SharedWorkspace.tsx` | 200–400px 拖拽 + 持久化；深层文件自动定位 |
| P1-3 | 卡片统一升级（2.1）+ `FilePreviewCard`（4.1） | 新增 `FilePreviewCard.tsx`；`CollectionCard.tsx`、`Workspaces.tsx`、`index.css` | 两列表卡片视觉与交互一致 |
| P1-4 | 操作反馈统一：confirmDanger + FormModal/Drawer + 上传进度（3.7、4.3） | 新增 `utils/confirm.ts`、`FormModal.tsx`；相关页面 | 确认弹窗/表单校验/进度条全部生效 |
| P1-5 | shimmer 骨架屏统一（2.3）+ 路由代码分割（5.2） | `index.css`、`App.tsx`、`vite.config.ts`、新增 `PageSkeleton.tsx` | 主包体积降 40%+，全站骨架屏统一 |
| P1-6 | 筛选状态进 URL + 滚动位置恢复（3.6） | `Collections.tsx`、`Workspaces.tsx` | 返回列表恢复过滤与滚动 |

### 7.3 P2 长期（1–2 月）——打磨与可选项

| # | 任务 | 涉及文件 | 验收标准 |
|---|------|----------|----------|
| P2-1 | highlight.js / Mermaid 主题动态切换（2.4） | `main.tsx`、`theme.ts`、`MarkdownViewer.tsx` | 切主题后代码块与图表同步换肤 |
| P2-2 | 空状态插画 + 拖拽上传引导（3.8） | `EmptyState.tsx`、`WorkspaceDetail.tsx` | 空态有 CTA，拖入 zip 直接上传 |
| P2-3 | 页面/内容切换过渡动画完善（3.6-3） | `index.css`、`WorkspaceDetail.tsx` | 文件切换 0.2s 淡入 |
| P2-4 | 大列表虚拟化（5.3，可选） | `WorkspaceTree.tsx`、`CollectionDetail.tsx` | 2000 节点流畅滚动 |
| P2-5 | a11y 全面审计与修复（6） | 全站 | axe 无 critical/serious 问题 |
| P2-6 | 树节点重命名/移动/拖拽悬停展开（3.5-2/3，视后端 API 可用性） | `WorkspaceTree.tsx` | 依后端能力评审后启动 |

---

## 8. 验收标准与风险

### 8.1 总体验收清单

**功能验收**（各章节明细见对应小节，此处为发布门槛）：

- [ ] P0 全部任务完成且桌面端现有功能（上传/下载/分享/删除/主题切换/dnd 排序）零回归
- [ ] Given 移动端用户打开工作空间，When 通过 Drawer 选择深层文件，Then 内容正常展示且面包屑路径完整
- [ ] Given 用户在任意页面按 Ctrl+K，When 输入关键词并 Enter，Then 跳转目标文档且浮层关闭
- [ ] Given 用户调整侧栏宽度至 350px 并刷新，Then 宽度保持 350px；折叠后再展开恢复 350px

**质量验收**：

- [ ] `npm run build`（`tsc -b && vite build`）零错误零新增警告
- [ ] 亮/暗主题手动巡检全部页面（含 `/share/*` 分享页）无样式破损
- [ ] Chrome / Safari / Firefox 最新版 + iOS Safari / Android Chrome 冒烟通过
- [ ] Lighthouse 移动端 Performance ≥ 80、Accessibility ≥ 90（改造前留存基线数据对比）

### 8.2 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| antd Tree 定制限制：右键菜单、focus 管理、虚拟滚动与 `scrollIntoView` 的行为耦合较深 | 3.3/3.5 实现复杂度上升 | 优先使用 Tree 官方 API（`onRightClick`、`scrollTo`、`height`）；预研 spike 1 天验证可行性，不可行则右键菜单降级为行内"…"按钮 |
| 移动端真机测试覆盖不足（团队以桌面开发为主） | 触摸交互问题上线后才暴露 | P0-2 验收强制真机（iOS Safari + Android Chrome）走查清单；CI 加 375px 视口的截图对比 |
| store 缓存引入数据一致性问题（多标签页/他端修改） | 列表数据陈旧 | 缓存命中时后台静默 revalidate；所有写操作强制 `mutate()`；`window focus` 时触发刷新 |
| 代码分割后 chunk 加载失败（弱网/部署换版本） | 路由切换白屏 | `lazy` 包裹重试逻辑（失败一次后 `window.location.reload()`）；`Suspense` fallback 提供刷新提示 |
| `WorkspaceTree` 目录 key 格式变更影响已展开状态 | 无实际影响（当前 `defaultExpandAll`，无持久化展开态） | 改造为受控 `expandedKeys` 时一并切换，无迁移成本 |
| Mermaid 重渲染性能：主题切换需重绘所有图表 | 含大量图表的文档切换主题卡顿 | 仅对可视区域内图表立即重渲染，其余惰性处理；必要时提示"切换主题后重新打开文档" |
| `FilePreviewCard` 统一后 dnd-kit 拖拽回归 | Collections 排序失效 | 保留 `dragHandleProps` 透传接口，重构后专项回归拖拽排序 |

### 8.3 参考资料

- 顶栏与导航：`frontend/src/components/AppLayout.tsx`
- 双栏布局与侧栏折叠：`frontend/src/pages/WorkspaceDetail.tsx`（`SIDEBAR_COLLAPSED_KEY`）
- 目录树封装：`frontend/src/components/WorkspaceTree.tsx`（`toAntdTree`）
- 设计变量与暗色主题：`frontend/src/index.css`（`:root` / `[data-theme="dark"]`）
- antd 主题接入：`frontend/src/main.tsx`（`ConfigProvider` + `darkAlgorithm`）
- 主题持久化：`frontend/src/store/theme.ts`
- 既有 spec 风格参考：`specs/001-workspace/spec.md`、`specs/005-workspace-download/spec.md`

### 8.4 修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| 1.0 | 2026-07-30 | - | 初稿 |
