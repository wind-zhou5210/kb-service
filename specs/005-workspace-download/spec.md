# 工作空间 ZIP 下载功能 需求规范

Version: 1.0
Created: 2026-07-30
Status: Draft

## 1. 概述

### 1.1 背景

当前 kb-service 的工作空间（Workspace）支持整包上传：用户将本地文件夹打包为 ZIP 上传后，服务端解压存储并提供在线预览。但目前**只有上传，没有下载**，用户遇到以下场景时无能为力：

- 本地原始文件夹已丢失/变更，需要从服务端取回完整快照
- 换设备工作，需要把工作空间内容同步到新机器
- 在其他工具中继续编辑工作空间里的文档

缺少下载功能时，用户只能在预览页逐个打开文件手动另存，多级目录、几十上百个文件的工作空间实际上无法完整取回。

### 1.2 目标

提供"一键下载整个工作空间为 ZIP"的能力，保证**下载 → 再上传的往返一致性**（目录结构与文件内容完全不变），并且只对登录用户开放。

### 1.3 范围

**MVP（本次实现）**：

| 功能 | 说明 |
|------|------|
| 下载 API | `GET /api/workspaces/{ws_id}/download`，服务端打包 ZIP 流式返回 |
| 前端下载入口 | WorkspaceDetail 页面按钮组新增「下载」按钮，浏览器原生下载 |
| 往返一致性 | ZIP 内部平铺（不包根目录），与上传的平铺解压语义对称 |
| 顺带修复 | 前端 `Workspace.doc_count` 与后端 `file_count` 字段错位 bug |

**不在本次范围（后续迭代）**：

| 功能 | 说明 |
|------|------|
| 分享态下载 | SharedWorkspace 页面不提供下载，share_token 通道保持只读预览 |
| CLI 下载 | `kb workspace pull` 命令，API 设计已天然兼容 |
| 部分下载 | 下载单个子目录/选中文件 |

### 1.4 成功指标

- 下载操作 1 步完成（点击「下载」按钮 → 浏览器开始下载）
- 下载的 ZIP 解压后与上传前的目录结构、文件内容完全一致（含中文文件名）
- 下载的 ZIP 原样再上传后，工作空间目录树不变形（不多一层目录）
- 打包数百 MB 工作空间时后端内存占用平稳（不随空间大小线性增长）

---

## 2. 用户分析

### 2.1 目标用户

| 角色 | 场景 | 诉求 |
|------|------|------|
| 产品/设计人员 | 上传设计产物后本地文件丢失或换设备 | 完整取回原始文件夹 |
| 知识库维护者 | 定期备份工作空间内容 | 一键导出、结构不变 |

### 2.2 用户故事

**作为** 已登录的工作空间使用者
**我想要** 一键下载整个工作空间为 ZIP 文件
**以便于** 完整取回所有文件和目录结构，在本地继续使用或备份

### 2.3 用户旅程

```
用户进入工作空间详情页（已登录）
      │
      ▼
侧栏按钮组看到「下载」按钮（空工作空间时置灰）
      │
      ▼
点击「下载」
      │
      ▼
浏览器原生下载管理器开始下载 {工作空间名}.zip（有进度、可取消）
      │
      ▼
解压后得到与上传时一致的目录结构与文件
```

---

## 3. 功能需求

### 3.1 核心功能

| 编号 | 功能点 | 描述 | 优先级 | 验收标准 |
|------|--------|------|--------|----------|
| F1 | 下载 API | 服务端将工作空间打包为 ZIP 并流式返回 | P0 | 返回 application/zip，文件名正确，内容完整 |
| F2 | 下载入口 | WorkspaceDetail 按钮组新增「下载」按钮 | P0 | 按钮位于「上传」之后，点击触发浏览器原生下载 |
| F3 | 空空间处理 | 无文件时前端按钮禁用、后端返回 400 | P0 | 空工作空间无法发起下载 |
| F4 | 往返一致性 | ZIP 平铺打包，下载→再上传结构不变 | P0 | 再上传后目录树与原来一致 |
| F5 | 字段修复 | 前端 `doc_count` 改为 `file_count` | P1 | 侧栏文件数正常显示，禁用判断正确 |

### 3.2 功能详细说明

#### F1：下载 API

- **端点**：`GET /api/workspaces/{ws_id}/download`
- **鉴权**：复用现有 `CurrentUserFromQuery` 依赖（支持 `Authorization: Bearer` header 与 `?jwt=` query 两种方式；后者用于浏览器原生下载无法携带 header 的场景，与 iframe serve 的既有模式一致）
- **打包流程**：
  1. 查询 `workspace_file` 表全部记录，**以 DB 记录为打包清单**（与目录树 API 展示内容严格一致，磁盘上的孤儿文件不打包）
  2. 记录为空 → 返回 `400 工作空间为空`
  3. `tempfile.mkstemp(suffix=".zip")` 创建临时文件，`zipfile.ZipFile(..., "w", ZIP_DEFLATED)` 逐条写入：
     - 每条路径先过现有 `_safe_join(ws.storage_path, f.path)` 校验，防止 DB 记录被篡改后打包目录外文件
     - `zf.write(disk_path, arcname=f.path)`，arcname 用相对路径，ZIP 内平铺不包根目录
     - DB 有记录但磁盘缺失的文件跳过，不中断打包
  4. `FileResponse(tmp_path, media_type="application/zip", ...)` 流式返回（自动分块、带 Content-Length，浏览器可显示进度）
  5. `background=BackgroundTask(os.unlink, tmp_path)` 在响应发送完成后删除临时文件；打包过程抛异常时先清理临时文件再 raise
- **下载文件名**：`{工作空间名}.zip`
  - Windows 非法字符 `\ / : * ? " < > |` 及控制字符替换为 `_`
  - 清理后为空则回退 `workspace-{ws_id}.zip`
  - 使用 `quote()` + RFC 5987 编码：`Content-Disposition: attachment; filename*=UTF-8''{encoded}.zip`（模式与 `documents.py` 的单文档下载端点一致）
- **中文文件名**：Python `zipfile` 写入时自动置 UTF-8 标志位（0x800），现代解压工具无乱码；与上传侧 `_fix_zip_filename` 形成对称闭环

#### F2：前端下载入口

- **位置**：`WorkspaceDetail.tsx` 侧栏按钮组，顺序为 `[上传] [下载] [分享] [删除]`
- **样式**：`<Button size="small" icon={<DownloadOutlined />}>下载</Button>`，与相邻按钮一致
- **行为**：点击时动态创建 `<a href={downloadUrl}>` 并触发 click，由浏览器原生下载管理器接管（进度、取消由浏览器处理，不占页面内存）
- **URL 构造**：`client.ts` 新增 `workspaceDownloadUrl(id)` 函数，返回 `/api/workspaces/{id}/download?jwt={encodeURIComponent(token)}`；URL 在点击时即时构造，不预生成、不展示，规避 JWT 过期与泄露风险
- **禁用条件**：`workspace.file_count === 0` 时按钮 `disabled`

#### F3：空工作空间处理

- 前端：按钮禁用（依赖 F5 修复后的 `file_count` 字段）
- 后端：`workspace_file` 记录为 0 条时返回 `400 工作空间为空`（双保险，防止直接调 API）

#### F5：字段错位修复

- 现状：`client.ts` 中 `Workspace` 接口声明 `doc_count`，但后端 `list_workspaces` / `get_workspace` 实际返回 `file_count`，导致 `WorkspaceDetail` 侧栏「{n} 个文件」显示 `undefined`
- 修复：`Workspace` 接口字段改为 `file_count`，同步修正 `WorkspaceDetail.tsx`、`Workspaces.tsx`、`SharedWorkspace.tsx` 中的引用处

---

## 4. 数据需求

### 4.1 API 设计

```
GET /api/workspaces/{ws_id}/download
鉴权: CurrentUserFromQuery（Bearer header 或 ?jwt= query）
成功: 200
  Content-Type: application/zip
  Content-Disposition: attachment; filename*=UTF-8''{name}.zip
  Body: ZIP 二进制流
失败:
  401 无效的认证凭据
  404 工作空间不存在
  400 工作空间为空
```

**路由注册位置**：置于 `workspaces.py` 中 `/{ws_id}/serve/{path:path}` 之前、与其他 `/{ws_id}/xxx` 端点并列（FastAPI 按注册顺序匹配，`/download` 为精确段不会与 `serve` 冲突，但保持与现有 upload/tree 端点相邻以便维护）。

### 4.2 数据操作

| 数据 | 操作 | 说明 |
|------|------|------|
| workspace | 只读 | 取 name（文件名）、storage_path（磁盘根） |
| workspace_file | 只读 | 打包清单：path 即 arcname |
| 磁盘文件 | 只读 | 逐条读入 ZIP，不修改 |
| 临时 ZIP 文件 | 创建 + 响应后删除 | 系统 temp 目录，BackgroundTask 清理 |

无任何表结构变更、无数据迁移。

### 4.3 业务规则校验

| 规则 | 校验方式 |
|------|----------|
| 需登录 | `CurrentUserFromQuery` 依赖，无有效 JWT 返回 401 |
| 工作空间必须存在 | `session.get(Workspace, ws_id)`，不存在返回 404 |
| 工作空间非空 | `workspace_file` 记录数 > 0，否则返回 400 |
| 路径不越权 | 每条 path 过 `_safe_join`，越权路径直接拒绝 |
| 分享态不可下载 | `/share/{token}/` 通道不新增下载端点 |

---

## 5. 非功能需求

### 5.1 性能要求

- 打包采用临时文件方式，后端内存占用与工作空间大小无关（逐文件写入）
- `FileResponse` 流式发送，带 `Content-Length`，浏览器显示下载进度
- 500MB 工作空间（上传上限）打包首字节延迟秒级，可接受

### 5.2 安全要求

- 仅 JWT 认证用户可下载；分享页无下载入口，`share_token` 不开放打包能力
- 打包时每条路径过 `_safe_join`，物理上不可能打出 `storage_path` 之外的文件
- `?jwt=` 进 URL 与现有 iframe serve 模式一致：程序化即时构造、HTTPS 传输、不落页面不展示
- 临时文件位于系统 temp 目录，正常响应或异常路径均被清理，不残留

### 5.3 部署要求

- nginx 现有配置无需修改：`client_max_body_size` 仅限制上传方向；默认 `proxy_buffering` 对大响应会写 nginx 临时缓冲文件但功能正常

---

## 6. 边缘情况与异常处理

| 场景 | 处理方式 |
|------|----------|
| 空工作空间 | 前端按钮禁用；后端 400「工作空间为空」 |
| 工作空间不存在 | 后端 404「工作空间不存在」 |
| 未登录/JWT 过期直接调 API | 后端 401；页面内正常操作不会触发（URL 点击时即时构造） |
| DB 有记录但磁盘文件缺失 | 跳过该文件继续打包，不中断 |
| 下载期间发生上传替换（并发） | 磁盘缺失文件跳过；单用户服务不引入锁 |
| 工作空间名含 `\ / : * ? " < > \|` | 替换为 `_`；清理后为空回退 `workspace-{id}.zip` |
| 中文工作空间名/文件名 | 文件名 RFC 5987 编码；ZIP 条目 UTF-8 标志位自动置位 |
| 打包过程抛异常 | 清理临时文件后 raise，返回 500 |
| 用户中途取消下载 | 浏览器断开连接，FileResponse 停止发送，BackgroundTask 仍清理临时文件 |
| 空目录 | 不保留（DB 只记录文件，与目录树 API 行为一致） |

---

## 7. 验收标准

### 7.1 功能验收

- [ ] WorkspaceDetail 按钮组出现「下载」按钮，位于「上传」之后
- [ ] 点击后浏览器开始下载 `{工作空间名}.zip`，有原生进度显示
- [ ] 上传含中文文件名 + 多级目录的 ZIP → 下载 → 解压，结构与内容完全一致
- [ ] 下载的 ZIP 原样再上传，目录树不变形（不多一层根目录）
- [ ] 空工作空间「下载」按钮置灰
- [ ] 直接请求空工作空间下载 API 返回 400
- [ ] 无 JWT 直接请求下载 API 返回 401
- [ ] 不存在的 ws_id 返回 404
- [ ] SharedWorkspace 分享页无下载入口，`/share/{token}/download` 不存在（404）
- [ ] 侧栏「{n} 个文件」显示正确数字（不再是 undefined）

### 7.2 体验与质量验收

- [ ] 下载不阻塞页面，期间可继续浏览/切换文件
- [ ] 大工作空间（数百 MB）下载时后端内存平稳
- [ ] 下载完成后系统 temp 目录无 ZIP 残留

---

## 8. 附录

### 8.1 技术方案备选记录

| 方案 | 结论 |
|------|------|
| A. 内存打包（io.BytesIO） | 否决：500MB 空间峰值内存过高，容器有 OOM 风险 |
| B. 临时文件 + FileResponse | **采用**：零新依赖、内存恒定、有 Content-Length |
| C. 流式打包（zipstream-ng） | 否决：需新增依赖、无下载进度、中途出错产出损坏 ZIP |
| 前端 axios blob 下载 | 否决：大文件占浏览器内存、无原生进度条 |
| 前端 `<a href ?jwt=>` 原生下载 | **采用**：与现有 iframe `?jwt=` 鉴权模式一致 |
| ZIP 内包一层根目录 | 否决：破坏「下载→再上传」往返一致性 |

### 8.2 参考资料

- 工作空间路由：`backend/app/api/workspaces.py`（`_safe_join`、`_fix_zip_filename`、upload 端点）
- 单文档下载的 Content-Disposition 模式：`backend/app/api/documents.py` `download_document`
- 鉴权依赖：`backend/app/core/security.py` `CurrentUserFromQuery`
- 前端按钮组：`frontend/src/pages/WorkspaceDetail.tsx` 侧栏 `Space`
- 工作空间设计文档：`docs/plans/2026-07-27-workspace-design.md`

### 8.3 修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| 1.0 | 2026-07-30 | wb_zhouzheng | 初稿 |
