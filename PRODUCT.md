# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要使用者是**个人用户（自托管者）**：自己整理、上传、阅读 Markdown/HTML 文档。分享场景是把集合、文档或工作空间生成**只读链接**发给他人查看，访客无需登录、仅只读访问。登录账户基本只有自己（单账户 JWT 模型，默认 admin / admin123）。

## Product Purpose

自托管的文件型知识库：上传 Markdown 与 HTML 文件，在线**安全渲染**阅读；以文件为源头、内容按 SHA1 寻址存储并去重；支持全文检索、版本历史、标签/备注与只读分享。既有 Web 界面，也提供 `kb` CLI 命令行工具。

## Positioning

把文件当一等公民的知识库。区别于 Obsidian/Notion 等笔记生态：
- **文件原生**：Markdown 与 HTML 都按原貌渲染，上传的原始文件就是知识源头；
- **安全渲染任意 HTML**：后端 bleach 净化 + 前端 iframe `sandbox="allow-scripts"` 双重防御，这是技术上最大的差异化能力；
- **自托管 + 轻量**：数据完全在自己手里，无生态绑定、无锁定；
- 附带 CLI 推送/检索与 FTS5 全文检索，贴近开发者的使用习惯。

## Operating Context

- 用户自托管部署（Docker Compose 本地构建 / 阿里云 ACR 预构建镜像，GitHub Actions 自动部署）；
- 通过浏览器访问 Web 界面，或用 `kb` CLI 推送、检索、下载文档；
- 文档类型：`.md` 与 `.htm/.html`，单文件上限 10MB；
- 组织方式：**集合**（Collections，卡片网格、拖拽排序）组织文档；**工作空间**（Workspaces，目录树）提供文件夹式组织；文档可有标签、备注与版本历史；
- 分享：集合/文档/工作空间均可生成只读分享链接；
- 移动端响应式：触屏 44px 最小目标、文件列表改用 Drawer、隐藏品牌区。

## Capabilities and Constraints

- 上传：仅 `.md/.htm/.html` 白名单、10MB 上限、SHA1 内容去重；
- 渲染：Markdown 用 react-markdown（**无 rehype-raw**，不渲染原始 HTML）；HTML 走 bleach 净化 + iframe `sandbox="allow-scripts"`（绝不 `allow-same-origin`）；
- 全文检索：SQLite FTS5（文件名、集合名、文档正文）；
- 版本历史：文档多版本管理与还原；
- 拖拽排序：集合卡片与文档列表（dnd-kit）；
- 认证：单账户 JWT（python-jose HS256，默认 7 天）；写操作需登录，分享链接免登录只读；
- 主题：亮色/暗色可切换，无状态丢失；
- 约束：MVP 阶段，无单元测试；**单账户模型**，暂无多用户权限体系；内容寻址存储不可随意替换（有 `StorageBackend` Protocol 预留 S3 扩展）。

## Brand Commitments

- 产品 UI 名称为「文件知识库」，命令行工具 `kb`（npm 包 `kb-service-cli`）；
- 用户明确声明：**无品牌/视觉约束，UI 优化可自由发挥**，现有墨色 + 靛蓝风格可被替换或重构。

## Evidence on Hand

- Login 页自我描述的功能卖点（可作为定位证据）：
  - Markdown 渲染 —— 代码高亮 · 公式 · 图表；
  - HTML 沙箱 —— 安全渲染任意 HTML；
  - 内容寻址 —— 自动去重，省空间；
- Login 品牌文案：**「你的知识，你来掌控」**；
- 默认账户提示：admin / admin123；
- **无**真实用户测试数据、案例、证言——设计过程中不得虚构。

## Product Principles

1. **用户掌控数据**：文件原生、内容寻址、可自托管，不做数据锁定；
2. **安全优先**：任意 HTML 也能安全渲染，双重防御机制是不可妥协的底线；
3. **轻量直接**：无生态绑定、操作路径最短，克制地做少而精的功能；
4. **文件即源头**：上传的原始文件是知识的源头，UI 是进入它的入口。

## Accessibility & Inclusion

未确立明确无障碍标准，但现有代码已包含若干实践，UI 优化时应保持并增强：
- 键盘焦点环 `:focus-visible`；触屏 44px 最小点击目标；`aria-label`；暗色模式。
