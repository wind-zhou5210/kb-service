# 工作空间安全整包更新 需求规范

Version: 1.0
Created: 2026-09-21
Status: Approved

## 1. 问题描述

### 1.1 用户痛点

工作空间内容需要频繁更新（AI 生成的设计原型，一次改动涉及多个文件）。当前无法在原空间上完成整体替换，只能**删除工作空间 → 重建 → 重新上传 → 重新生成分享链接**，导致：

- 操作繁琐，每次更新都要重复 4 步
- **已发出的分享链接全部失效**（删除空间即令牌失效，同名重建不会恢复）
- 接收方（评审人/合作方）需要重新获取链接

### 1.2 根因分析（已动态复现）

| # | 问题 | 证据 |
|---|------|------|
| 1 | **同路径整包上传必定失败**（核心根因） | [workspaces.py:456-467](file:///home/zhouzheng/Desktop/kb/kb-service/backend/app/api/workspaces.py#L456-L467)：`session.delete(old_records)` 仅登记待删除，随后 `session.add(new)`；SQLAlchemy flush 顺序为 INSERT-before-DELETE，撞联合唯一约束 `uq_workspace_file(workspace_id, path)`。真实模型 + 内存 SQLite 实测报 `IntegrityError: UNIQUE constraint failed: workspacefile.workspace_id, workspacefile.path`（sqlite 错误码 2067）。路径完全不重合时成功——这解释了"删空间重建反而能成功" |
| 2 | **失败即丢内容** | [:397-404](file:///home/zhouzheng/Desktop/kb/kb-service/backend/app/api/workspaces.py#L397-L404) 先清空磁盘再解压；DB 回滚无法恢复已删除的文件，留下"旧元数据 + 空/半新磁盘"的不一致状态 |
| 3 | 更新后看不到新内容 | 上传成功仅重拉目录树，不递增预览版本；同路径 Markdown 保留旧内容（[WorkspaceDetail.tsx:122-147](file:///home/zhouzheng/Desktop/kb/kb-service/frontend/src/pages/WorkspaceDetail.tsx#L122-L147)）；HTML 的 `?v=` 参数不会传播到其相对引用的 CSS/JS/图片 |
| 4 | 无重复提交保护、无解压资源限制 | 上传中未禁用入口；无解压总量与条目数上限；目录条目在路径校验之前处理（[:413-417](file:///home/zhouzheng/Desktop/kb/kb-service/backend/app/api/workspaces.py#L413-L417)），穿越目录绕过校验 |

### 1.3 现状说明

- 整包上传接口语义本就是"全量替换"（[:377-382](file:///home/zhouzheng/Desktop/kb/kb-service/backend/app/api/workspaces.py#L377-L382)），**且保留工作空间记录与分享令牌**；崩溃点在实现顺序而非设计意图。
- 已被用户接受的行为：ZIP 顶层目录原样保留（不剥离），文件相对路径即分享深链的定位依据。

## 2. 目标与范围

### 2.1 目标

- 工作空间 ID / 名称 / 分享令牌在整个更新周期内**保持不变**
- ZIP 作为**完整新内容**：同路径覆盖、新路径新增、包中缺失的旧文件删除
- **任何失败（坏包、超限、写盘、DB 冲突）都不破坏当前线上内容**
- 更新完成后，登录态与分享页都能看到新内容（含同路径文件的资源更新）

### 2.2 本轮范围

安全整包替换（replace 语义）。不做增量合并、目录同步、实时推送、多版本历史 UI。

## 3. 设计

### 3.1 数据模型

`Workspace` 新增字段 `content_dir`（当前生效的内容子目录名，可空）：

| 值 | 含义 |
|----|------|
| `NULL` | 旧布局：内容直接位于 `storage_path` 下（存量数据，零迁移） |
| `"rev-xxxxxxxx"` | 新布局：内容位于 `{storage_path}/rev-xxxxxxxx/` |

读取统一经辅助函数解析：`content_root(ws) = storage_path / content_dir if content_dir else storage_path`。

### 3.2 更新流程（DB 提交是唯一发布点）

```
1. 读包 + 体积校验（≤500MB，保持现有上限）
2. 解压到 {storage_path}/.staging/{uuid}/          ← 线上内容完全不动
3. 全量校验：
   - 路径：normpath 后拒绝 .. 与绝对路径；统一 \ → /；目录条目与文件条目同规则
   - 跳过：隐藏文件/目录、node_modules、黑名单扩展名（保持现有规则，预检明确展示）
   - 资源限制：条目数 ≤ workspace_max_entries(20000)、解压总量 ≤ workspace_max_extract_mb(1000)
   - 有效文件数必须 > 0（空包/全跳过 → 拒绝）
4. 任一失败 → 删除 staging → 返回 4xx，线上内容与链接完好
5. staging 原子改名 → {storage_path}/rev-{uuid8}/   （同卷 rename）
6. DB 事务：
   a. 删除旧 WorkspaceFile 记录后先 await session.flush()（修复 INSERT-before-DELETE）
   b. 插入新记录
   c. ws.content_dir = 新目录名；ws.updated_at 刷新
   d. 乐观锁：提交前校验 content_dir 与事务开始时一致，不一致返回 409
7. 提交成功后：尽力清理上一个内容目录（含首次替换时根下散落的旧文件）；清理失败仅记日志
8. 返回 { count, added, updated, removed, unchanged }
```

**失败语义**：步骤 1-5 失败 = 线上零影响；步骤 6 失败 = 新内容目录成为孤儿（下次更新时惰性回收），`content_dir` 仍指向旧内容。

### 3.3 读取路径统一

以下位置全部改用 `content_root(ws)`（不得再直接使用 `ws.storage_path` 拼接内容路径）：

- 登录态：`serve` / `tree` / `download` / 单文件 upsert / 单文件 delete
- 分享态：`share/{token}/serve` / `share/{token}/tree` / `share/{token}/download`
- 单文件写操作作用于**当前生效内容目录**，与整包替换共用同一把锁

### 3.4 缓存策略

登录态与分享态的 serve 统一返回 `Cache-Control: no-store`。

**理由**：HTML 内的相对引用（CSS/JS/图片）无法携带版本参数，仅靠入口 URL 加 `?v=` 无法覆盖子资源。原型预览场景以"更新后立刻可见"优先于重复访问性能。

### 3.5 并发

- 当前部署为**单 worker**（[Dockerfile:24](file:///home/zhouzheng/Desktop/kb/kb-service/backend/Dockerfile#L24) 无 `--workers`），进程内按工作空间加 `asyncio.Lock` 串行化整包更新与单文件写操作
- `content_dir` 乐观锁兜底，为将来多 worker 预留（冲突返回 409）

## 4. 接口契约

`POST /api/workspaces/{ws_id}/upload`：路径、方法与"全量替换"语义不变（**CLI 无需改动即兼容**）。

响应扩展（向后兼容）：

```json
{
  "count": 42,
  "added": 10,
  "updated": 28,
  "removed": 4,
  "unchanged": 0
}
```

统计口径（按相对路径比对旧内容与包内容）：

| 字段 | 定义 |
|------|------|
| `added` | 包中有、旧内容没有的路径 |
| `updated` | 两边都有但 sha1 不同 |
| `unchanged` | 两边都有且 sha1 相同 |
| `removed` | 旧内容有、包中没有的路径 |
| `count` | 新内容的总文件数（`added + updated + unchanged`） |

新增错误语义：

| 状态 | 场景 |
|------|------|
| 400 | ZIP 损坏 / 零有效文件 / 路径非法条目全部被拒 |
| 409 | 并发更新冲突（乐观锁） |
| 413 | 压缩包超限 / 解压总量或条目数超限 |

## 5. 前端交互

### 5.1 登录态（WorkspaceDetail）

- 有内容时上传入口文案为「更新内容」
- 弹窗明确说明：**「zip 将作为工作空间的完整新内容：同路径覆盖，包中未包含的文件会被删除；工作空间与已有分享链接保持不变」**
- 上传前二次确认（`Modal.confirm`），上传中禁用入口与按钮（真正阻止重复提交）
- 成功后依次：刷新空间信息与目录树 → **递增 `viewerVersion` 强制重载当前文件**（同路径也刷新）→ 若当前选中文件已不存在则清空选择/回退第一个文件 → 展示变更统计

### 5.2 分享页（SharedWorkspace）

- 新增「刷新内容」按钮：重拉空间信息与目录树 + 重载当前文件（含已删除文件的回退提示）
- 不做实时推送、不做轮询

### 5.3 前端依赖约束

不引入新的运行时依赖（不做前端 ZIP 解析）。

## 6. CLI

`kb ws upload` 保持现有语义与确认提示（已是全量替换 + `-y` 确认），成功后打印服务端返回的变更统计（added/updated/removed）。

## 7. 实施步骤

| # | 文件 | 改动 |
|---|------|------|
| 1 | `backend/app/models.py` | `Workspace` 增加 `content_dir: str \| None` |
| 2 | `backend/app/core/database.py` | 迁移：`ALTER TABLE workspace ADD COLUMN content_dir TEXT` |
| 3 | `backend/app/core/config.py` | 新增 `workspace_max_extract_mb=1000`、`workspace_max_entries=20000` 及 bytes 属性 |
| 4 | `backend/app/api/workspaces.py` | 新增 `_content_root(ws)`；替换全部内容路径使用点；重写 `upload_workspace_zip`（staging/校验/rename/事务/清理/统计）；加 per-workspace `asyncio.Lock`；serve 加 `no-store` |
| 5 | `frontend/src/api/client.ts` | `uploadWorkspaceZip` 返回类型扩展为统计结构 |
| 6 | `frontend/src/pages/WorkspaceDetail.tsx` | 更新文案与二次确认、上传中禁用、成功后刷新与统计、选中文件失效处理 |
| 7 | `frontend/src/pages/SharedWorkspace.tsx` | 新增「刷新内容」按钮 |
| 8 | `cli/src/commands/workspace.ts` | `ws upload` 输出变更统计 |
| 9 | `specs/012-workspace-safe-replace/spec.md` | 本文档 |

## 8. 测试计划

| # | 用例 | 期望 |
|---|------|------|
| 1 | 同路径整包重复上传（核心回归） | 成功，返回 updated/removed 统计（当前必失败） |
| 2 | 截断/损坏 ZIP | 400，旧内容完好，分享链接仍可访问 |
| 3 | 解压总量或条目数超限 | 413，旧内容完好 |
| 4 | 包中缺失文件 | 被删除，目录树与下载同步反映 |
| 5 | 分享链接 + `?file=` 深链在更新后 | 仍定位原文件且显示新内容 |
| 6 | 仅 CSS/JS 变化 | HTML 预览加载到新资源（no-store 生效） |
| 7 | 并发两次上传 | 一次成功、一次 409 |
| 8 | 单文件 upsert / 删除在切换后 | 作用于当前生效内容目录 |
| 9 | 旧内容目录回收 | 磁盘无孤儿目录泄漏 |
| 10 | CLI `kb ws upload` 全流程 | 输入确认 → 统计输出 |

## 9. 不做什么（明确排除）

- 增量合并模式（保留包外旧文件）与 `kb sync` 目录同步
- 两阶段"上传 → 预检确认 → 发布"接口（避免大包传输两次；改为确认文案 + 上传后统计）
- 已打开分享页的实时自动刷新（实时推送/轮询）
- 内容历史版本 UI 与回滚（磁盘仅保留最新一代）
- URL 携带版本号的强缓存方案（本轮以 no-store 等价实现）
- 前端 ZIP 预检（不新增前端解析依赖）
- 多用户并发冲突的 UI 提示（仅返回 409 与文案）
