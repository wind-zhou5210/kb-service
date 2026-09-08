# CLI 功能全面对齐 需求规范

Version: 1.0
Created: 2026-09-08
Status: Implemented

## 1. 概述

### 1.1 背景

Web 端经过多轮迭代后能力已显著扩张（工作空间 zip 上传与文件级操作、文档包 md+图片、文件级锚点分享、版本历史、跨集合移动、上传限制反馈等），而 CLI 仍停留在 v0.1.0 的 17 条基础命令，**工作空间整块能力零覆盖**，导致终端用户无法完成 Web 端已支持的多数操作。

本规范以「后端 REST 端点全集」与「前端 `api/client.ts` 方法全集」为双重基准，梳理 CLI 的能力缺口并逐项对齐。

### 1.2 目标

- CLI 覆盖后端全部**可由命令行语义表达**的端点（排除纯浏览器渲染类）
- 命令风格、输出格式、错误处理与既有 CLI 保持一致，不引入破坏性变更
- 补齐 CI/CD 可用性：非交互登录、环境变量注入、机器可读输出、稳定退出码

### 1.3 基准规模

| 侧 | 规模 |
|----|------|
| 后端 REST 端点 | 47 个（auth 1 / collections 6 / documents 16 / search 1 / share 3 / doc_share 3 / workspaces 16 / health 1） |
| 前端 `api` 方法 | 38 个（另有 10 处页面直接拼 URL 调用的下载/serve 端点） |
| CLI 对齐前命令 | 17 条 |
| CLI 对齐后命令 | **40 条** |

## 2. 差距矩阵（对齐前）

### 2.1 按领域统计

| 领域 | 后端端点 | CLI 覆盖 | 缺口 |
|------|---------|---------|------|
| 认证 | 1 | 3 条命令（login/logout/whoami） | 无非交互登录 |
| 配置 | — | 2 条（set/get） | 仅支持 `server` 键，无凭据注入 |
| 集合 | 6 | 3 条（list/create/delete） | ❌ get、update（改名/描述/排序） |
| 文档 | 16 | 7 条（push/list/get/download/update/delete + search） | ❌ 文档包 zip、move、raw、version:delete、批量下载、sort_order |
| 版本 | （含在文档 16 内） | 3 条（list/view/restore） | ❌ delete |
| 搜索 | 1 | 1 条 | ⚠️ 后端 FTS `<<>>` 标记原样裸露，未做终端高亮适配 |
| 集合分享 | 3 | 1 条（share collection） | ❌ revoke |
| 文档分享 | 3 | 1 条（share document） | ❌ revoke |
| **工作空间** | **16** | **0** | ❌ **整组缺失**（CRUD/tree/upload/push/rm/serve/download/share） |

### 2.2 横切能力缺口

| 缺口 | 表现 | 影响 |
|------|------|------|
| 无上传体积校验 | 大文件传完才被拒 | 浪费时间与带宽，且中间层 413 时无任何说明 |
| 无上传进度 | 静态 spinner | 500MB 工作空间包上传期间无任何反馈 |
| 实例超时 30s 固定 | 大包必超时失败 | 工作空间 zip 上传不可用 |
| 错误体解析缺陷 | `responseType: arraybuffer/stream` 时 `err.response.data` 为 Buffer，取不到 `detail` | 用户看到 `Request failed with status code 404` 而非后端中文说明 |
| 401 文案单一 | 一律「登录已过期」 | 密码错误时也提示「已过期」，误导排查 |
| `--json` 可能被污染 | 若直接对含 ANSI 的文本做 JSON 输出，机器可读性被破坏 | 脚本管道解析失败 |
| 非交互登录缺失 | `login` 强制 TTY 输入密码 | CI/CD 无法使用 CLI |

## 3. 功能需求

### 3.1 P0 —— 工作空间命令组（F1，此前 0 覆盖）

新增 `kb workspace <sub>`（alias `kb ws`），13 条子命令：

| 编号 | 命令 | 对应端点 | 说明 |
|------|------|---------|------|
| F1.1 | `ws list [--json]` | `GET /api/workspaces` | 含文件数、体积、分享状态 |
| F1.2 | `ws get <id> [--json]` | `GET /api/workspaces/{id}` | 含存储路径、分享链接 |
| F1.3 | `ws create <name> [-d]` | `POST /api/workspaces` | — |
| F1.4 | `ws update <id> [--name] [--desc]` | `PATCH /api/workspaces/{id}` | — |
| F1.5 | `ws delete <id> [-y]` | `DELETE /api/workspaces/{id}` | 破坏性操作，默认确认 |
| F1.6 | `ws tree <id> [-f kw] [--json]` | `GET /api/workspaces/{id}/tree` | 默认树形渲染；`-f` 输出匹配的扁平路径列表 |
| F1.7 | `ws upload <id> <zip> [-y]` | `POST /api/workspaces/{id}/upload` | **全量替换**，默认二次确认 |
| F1.8 | `ws push <id> <file> [-p path]` | `POST /api/workspaces/{id}/files?path=` | 增量 upsert，`-p` 缺省用文件名 |
| F1.9 | `ws rm <id> <path> [-y]` | `DELETE /api/workspaces/{id}/files?path=` | — |
| F1.10 | `ws cat <id> <path> [-o]` | `GET /api/workspaces/{id}/serve/{path}` | 输出原文；`-o` 保存本地 |
| F1.11 | `ws download <id> [-o dir]` | `GET /api/workspaces/{id}/download` | 文件名从 `Content-Disposition` 的 RFC 5987 编码解析（支持中文） |
| F1.12 | `ws share <id> [-f path] [--json]` | `POST /api/workspaces/{id}/share` | `-f` 生成 `?file=` 文件级深链，对齐 Web 端锚点能力 |
| F1.13 | `ws unshare <id> [-y]` | `DELETE /api/workspaces/{id}/share` | — |

### 3.2 P0 —— 文档包（zip + 图片资产）上传（F2）

| 编号 | 需求 | 说明 |
|------|------|------|
| F2.1 | `kb push` 自动识别 `.zip` 并分流到 `POST /api/collections/{id}/documents/package` | 与 Web 端 UploadModal 分流逻辑一致，用户无需记新命令 |
| F2.2 | 目录递归收集扩展名白名单加入 `.zip` | 原 `walkDir` 只收 md/html，zip 会被静默过滤 |
| F2.3 | 同批次可同时含 zip 与普通文档 | zip 逐个请求，普通文档合并为一次批量请求 |
| F2.4 | 汇总输出 created / updated / duplicated | 两类结果合并统计与表格 |
| F2.5 | `kb raw <id>` 可验证资产重写 | md 内相对图片应显示为 `/api/documents/{id}/assets/...` |

### 3.3 P1 —— 文档与集合能力补齐（F3）

| 编号 | 命令 | 对应端点 |
|------|------|---------|
| F3.1 | `kb raw <id> [-o file] [--html]` | `GET /api/documents/{id}/raw` |
| F3.2 | `kb move <id> -c <colId>` | `POST /api/documents/{id}/move` |
| F3.3 | `kb version:delete <docId> <v> [-y]` | `DELETE /api/documents/{id}/versions/{v}` |
| F3.4 | `kb download --all -c <colId> [-o dir]` | 遍历 `GET /api/collections/{id}/documents` + 逐个 `/download` |
| F3.5 | `kb update <id> --sort <n>` | `PATCH /api/documents/{id}`（`sort_order`） |
| F3.6 | `kb collection get <id>` | 后端无单集合端点 → 从 `GET /api/collections` 取对应项 |
| F3.7 | `kb collection update <id> [--name] [--desc] [--cover] [--sort]` | `PATCH /api/collections/{id}` |
| F3.8 | `kb get` / `kb list` 展示 `current_version` / `source_dir` / 分享状态 | 类型层同步补齐字段 |

### 3.4 P1 —— 分享能力补齐（F4）

| 编号 | 命令 | 对应端点 |
|------|------|---------|
| F4.1 | `kb share revoke collection <id> [-y]` | `DELETE /api/collections/{id}/share` |
| F4.2 | `kb share revoke document <id> [-y]` | `DELETE /api/documents/{id}/share` |
| F4.3 | `kb share revoke workspace <id> [-y]` | `DELETE /api/workspaces/{id}/share` |
| F4.4 | `kb share workspace <id> [-f path]` | `POST /api/workspaces/{id}/share` |
| F4.5 | `kb share list` | 组合查询：collections + workspaces + 逐集合 documents，汇总所有含 `share_token` 的对象（分享审计视图） |

分享 URL 构造与前端路由严格一致：集合 `/share/{token}`、文档 `/share/doc/{token}`、工作空间 `/share/workspace/{token}[?file=]`。

### 3.5 P1 —— CI/CD 与非交互（F5）

| 编号 | 需求 |
|------|------|
| F5.1 | `kb login <user> -p <pwd>` 非交互登录 |
| F5.2 | `KB_SERVER` / `KB_TOKEN` / `KB_USERNAME` 环境变量，**优先于**配置文件（凭据可不落盘） |
| F5.3 | `kb config set token\|username`、`kb config unset token\|username` |
| F5.4 | `kb config get` 标注每项值来源（环境变量 or 文件） |
| F5.5 | `kb whoami` 调用需鉴权端点校验令牌有效性 |
| F5.6 | 所有失败路径统一 `process.exit(1)` |

### 3.6 P2 —— 横切体验（F6）

| 编号 | 需求 |
|------|------|
| F6.1 | 上传前体积校验：单文档 10MB / zip 文档包 100MB / 工作空间 500MB（常量与后端 settings、前端 `utils/uploadLimit.ts` 三方对齐） |
| F6.2 | 上传实时进度：`onUploadProgress` → spinner 文案显示百分比与已传字节；同百分比不重绘 |
| F6.3 | 上传类请求 `timeout: 0`（实例默认 30s 对大包不足） |
| F6.4 | 413 且无 JSON detail 时，按请求 URL 推断端点并补出限制说明 |
| F6.5 | 搜索摘要：剔除后端 FTS `<<>>` 标记并对命中词着色；`--json` 走纯文本分支，保证无 ANSI 污染 |
| F6.6 | 空列表友好提示 + 下一步命令引导（集合/文档/工作空间） |

### 3.7 P0 —— 错误消息体系（F7）

| 编号 | 需求 |
|------|------|
| F7.1 | `extractDetail()` 支持 string / Buffer / ArrayBuffer / 对象四种错误体形态，解决 arraybuffer 与 stream 响应下 detail 丢失 |
| F7.2 | 非 JSON 错误体（nginx HTML）解析失败时安全回退 |
| F7.3 | 401 区分登录请求（展示后端「用户名或密码错误」）与其他端点（展示中文引导，替代 FastAPI 默认 `Not authenticated`） |
| F7.4 | 404 / 403 / 409 / 5xx 分类中文提示 |
| F7.5 | `ECONNREFUSED` / `ETIMEDOUT` 网络错误保留既有友好提示 |

## 4. 设计规范

### 4.1 命令风格

沿用既有「扁平根命令 + 分组子命令」混合风格，不引入破坏性变更：

- 文档操作为根命令（`push` / `list` / `get` / `raw` / `download` / `update` / `move` / `delete`）
- 版本操作为 `version:*` 前缀命令
- 领域对象为子命令组（`collection|col`、`workspace|ws`、`share`、`config`）
- 工作空间内文件级动作采用 POSIX 语义词：`upload`（整包）/ `push`（单文件）/ `rm` / `cat` / `tree`

### 4.2 选项约定

| 选项 | 语义 | 一致用于 |
|------|------|---------|
| `-y, --yes` | 跳过破坏性操作确认 | delete / rm / unshare / revoke / upload / version:restore / version:delete |
| `-o, --output` | 输出目录或文件 | download / raw / cat / version:view |
| `-c, --collection` | 目标集合 ID | push / list / move / download --all |
| `-p, --path` | 工作空间内目标路径 | ws push |
| `-f, --file` / `--filter` | 文件级深链 / 树过滤 | ws share / ws tree / share workspace |
| `--json` | 机器可读输出 | 全部 list / get / tree / search / share |

### 4.3 输出约定

- 表格用 `cli-table3` + 加粗表头；键值对用 `printKeyValue`
- 成功 `✓`（绿）/ 警告 `!`（黄）/ 失败 `✖`（红）
- `--json` 输出**禁止**包含 ANSI 转义码

## 5. 边缘情况

| 场景 | 处理 |
|------|------|
| 上传内容与已有文档完全重复 | 后端返回 409，CLI 展示「内容与集合中已有文件重复，已跳过」（与 Web 端语义一致） |
| `ws upload` 传入非 zip | 前置拦截并提示打包为 zip，不发请求 |
| 文件超体积限制 | 前置校验拦截，展示实际大小与上限，不发请求 |
| 目标 ID / 路径不存在 | 展示后端 detail（如「工作空间不存在」「文件不存在」）；无 detail 时展示 404 分类提示 |
| 删除工作空间后 ID 被复用 | SQLite 无 AUTOINCREMENT，rowid 会复用；命令按 ID 精确定位，行为正确（已在 e2e 中验证并澄清） |
| 路径穿越（`../../etc/passwd`） | CLI 原样透传，由后端 `_safe_join` 拒绝返回 404 |
| 中文文件名下载 | 解析 `Content-Disposition` 的 `filename*=UTF-8''` 编码 |
| 未登录访问需鉴权端点 | 中文引导「未登录或登录已过期，请执行: kb login」 |
| 环境变量与配置文件同时存在 | 环境变量优先，`config get` 标注来源 |
| `logout` 时仍存在 `KB_TOKEN` | 提示环境变量仍在生效，需 `unset` 才彻底退出 |
| md 文档包 `raw` 输出长度大于原文件 | 预期行为：serve 期图片路径被重写为资产端点，长度增加 |

## 6. 验收标准

### 6.1 构建

- [x] `npx tsc` 零错误零警告
- [x] `kb --help` 列出全部命令组，分组说明与实际命令一致
- [x] `kb ws --help` 列出 13 条子命令

### 6.2 功能 e2e（隔离后端容器 + 隔离 HOME，全部实测通过）

- [x] `login -p` 非交互登录成功；`whoami` 校验令牌有效
- [x] `config get` 正确标注 `KB_SERVER` 来源，配置写入隔离 HOME
- [x] `col create/list/get/update`（含 `--sort`、分享状态列）
- [x] `push` 单 md 创建文档；`push zip` 自动分流文档包端点并创建入口文档
- [x] `list` / `get`（展示所属集合、当前版本、包内目录）
- [x] `raw` 输出正文，文档包图片引用被重写为 `/api/documents/{id}/assets/...`
- [x] `push -o` 覆盖生成 v2；重复内容触发 409 重复提示
- [x] `version:list / view / restore / delete` 全链路
- [x] `update --title --tags --sort`、`move -c`
- [x] `download` 单文档、`download --all -c` 批量、`raw -o` 保存
- [x] `search` 命中词高亮且剔除 `<<>>`；`--json` 可解析、无 ANSI、无标记
- [x] `ws create/list/get/update`
- [x] `ws upload zip -y` 写入 3 文件；`ws tree` 树形渲染含子目录；`tree --filter` 命中
- [x] `ws push -p docs/extra.md` 增量新增；`ws cat` 输出；`ws rm -y` 删除
- [x] `ws download` 整包，zip 内保留 `sub/note.txt` 目录结构，中文名正确解析
- [x] `ws share` 整空间链接；`ws share --file todo.html` 生成 `?file=` 直链
- [x] 分享链接免登录可访问（`tree` 200 / `serve` 200）；`ws unshare` 后原链接 404
- [x] `share document/collection/workspace`、`share list` 汇总、`share revoke *` 三类撤销
- [x] `delete` / `ws delete` / `col delete` 清理链路；清空后列表显示友好空态

### 6.3 错误处理 e2e

- [x] 无效 ID → 后端中文 detail（「文件不存在」「工作空间不存在」）
- [x] `ws cat` 不存在路径（arraybuffer 响应）→ 正确解析 detail，不再出现 `Request failed with status code 404`
- [x] 11MB md → 前置拦截「过大（10.5 MB），上限 10MB」
- [x] 非 zip 传 `ws upload` → 前置拦截
- [x] 错误密码 → 「用户名或密码错误」（非「登录已过期」）
- [x] 未登录 → 「未登录或登录已过期，请执行: kb login」（非 `Not authenticated`）
- [x] 服务端不可达 → 「无法连接到服务端，请检查地址: ...」
- [x] 全部失败场景退出码为 1

## 7. 不做什么（明确排除）

- **后端任何改动**：本次仅 CLI 侧对齐；ROADMAP 中记录的 6 项后端待改（读接口鉴权、登录态集合整包下载、工作空间文件重命名端点、资产列表端点、搜索分页、CLI 登录回调）不在本次范围
- **纯浏览器体验能力**：暗色模式、TOC 目录导航、面包屑、最近阅读、拖拽排序、阅读进度记忆、Markdown/HTML 渲染管线、iframe 沙箱、响应式 Drawer 等无 CLI 对应语义
- **破坏性重命名**：保留 v0.1.0 全部既有命令与选项语义，仅新增
- **新增运行时依赖**：复用既有 axios / commander / chalk / cli-table3 / form-data / ora
- **`kb sync` / `kb watch` / Shell 补全 / 多 profile / 离线缓存 / 终端 Markdown 渲染**：列入 ROADMAP P2-P3

## 8. 附录

### 8.1 交付文件

| 类型 | 文件 | 说明 |
|------|------|------|
| 新增 | `cli/src/commands/workspace.ts` | 工作空间命令组（13 条） |
| 新增 | `cli/src/utils/limits.ts` | 体积限制常量 + 校验 + 413 文案推断 |
| 新增 | `cli/src/utils/upload.ts` | 上传进度、流保存、Content-Disposition 解析 |
| 重写 | `cli/src/commands/share.ts` | 三类分享 + revoke 子组 + share list |
| 重写 | `cli/src/commands/config.ts` | token/username 键 + unset + 来源标注 |
| 重写 | `cli/src/commands/auth.ts` | `-p` 非交互 + whoami 令牌校验 |
| 重写 | `cli/src/index.ts` | 注册 workspace + 帮助体系与版本号 |
| 重写 | `cli/README.md` | 40 条命令完整文档 |
| 重写 | `cli/ROADMAP.md` | 已完成项归档 + 剩余路线（含后端阻塞项映射） |
| 改造 | `cli/src/commands/document.ts` | zip 分流、raw/move/version:delete、批量下载、搜索高亮、空态 |
| 改造 | `cli/src/commands/collection.ts` | get / update、列表新列、空态 |
| 改造 | `cli/src/client.ts` | extractDetail + 错误分类体系 |
| 改造 | `cli/src/config.ts` | 环境变量优先 + loadFileConfig |
| 改造 | `cli/src/auth.ts` | 预设密码登录 |
| 改造 | `cli/src/types.ts` | Workspace / WorkspaceTreeNode / UploadResult 等类型与字段补齐 |
| 改造 | `cli/src/utils/format.ts` | plainSnippet / highlightSnippet |
| 改造 | `cli/package.json` | 0.1.0 → 0.2.0，描述与关键词更新 |

### 8.2 命令数变化

| 分组 | 对齐前 | 对齐后 |
|------|-------|-------|
| 认证 | 3 | 3（能力增强） |
| 配置 | 2 | 3 |
| 集合 | 3 | 5 |
| 文档（含版本） | 10 | 13 |
| 工作空间 | **0** | **13** |
| 分享 | 2 | 6 |
| **合计** | **17** | **40** |
