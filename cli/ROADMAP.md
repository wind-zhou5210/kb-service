# kb-service-cli TODO / 功能路线图

> 按优先级排序。P0 = 缺陷或必要补充，P1 = 近期应做，P2 = 后续迭代，P3 = 远期展望。
>
> **v0.2.0（当前）**：完成与后端 47 个端点、前端 38 个 API 方法的全面对齐，命令数 17 → 40。

---

## 已完成（v0.2.0 功能对齐）

### 工作空间命令组（此前 0 覆盖 → 13 条命令）

- [x] `kb ws list / get / create / update / delete` — 工作空间 CRUD
- [x] `kb ws tree [--filter]` — 目录树展示与关键词查文件
- [x] `kb ws upload <zip>` — zip 全量替换（破坏性操作带确认）
- [x] `kb ws push <file> [-p path]` — 单文件增量 upsert
- [x] `kb ws rm <path>` — 删除单文件
- [x] `kb ws cat <path> [-o]` — 输出文件内容
- [x] `kb ws download [-o]` — 整包下载（保留目录结构）
- [x] `kb ws share [--file]` / `kb ws unshare` — 分享与文件级直链

### 文档能力补齐

- [x] `kb push xxx.zip` — **文档包上传**（md/html 入口 + 图片资产，自动分流到 `/documents/package`）
- [x] `kb raw <id> [-o] [--html]` — 终端输出文档正文（P1 #5）
- [x] `kb move <id> -c <colId>` — 跨集合移动文档
- [x] `kb version:delete <docId> <v>` — 删除历史版本
- [x] `kb download --all -c <id>` — 批量下载集合全部文档（P2 #15）
- [x] `kb update --sort` — 文档排序
- [x] `kb get` 展示当前版本 / 包内目录 / 分享链接

### 集合能力补齐

- [x] `kb collection get` — 集合详情（P1 新增）
- [x] `kb collection update --name/--desc/--cover/--sort` — 修改集合（P1 #4）
- [x] `kb collection list` 增加排序与分享状态列

### 分享能力补齐

- [x] `kb share revoke collection/document/workspace` — 撤销分享（P0 #2、P1 #6、P1 #7）
- [x] `kb share workspace [-f path]` — 工作空间分享 + 文件级锚点直链
- [x] `kb share list` — 全部已分享对象总览（集合/文档/工作空间审计视图）
- [x] 文档分享端点已部署生效（P0 #3）

### 非交互与 CI/CD（P2 #12 / P3 #20 部分）

- [x] `kb login <user> -p <pwd>` — 非交互登录
- [x] `kb config set token/username` + `config unset` — 凭据注入与清除
- [x] `KB_SERVER` / `KB_TOKEN` / `KB_USERNAME` 环境变量（优先于配置文件，凭据不落盘）
- [x] `kb config get` 标注配置来源
- [x] `kb whoami` 校验令牌有效性
- [x] 失败命令统一退出码 1

### 体验与健壮性（P3 #16 等）

- [x] 上传实时进度百分比（替代静态 spinner）
- [x] 上传前体积校验（10MB / 100MB / 500MB，与后端前端三方对齐）
- [x] 413 中间层拦截时补出限制说明（nginx HTML 错误页无 detail 场景）
- [x] 搜索命中词终端高亮（剔除后端 FTS `<<>>` 标记），`--json` 保证无 ANSI 污染
- [x] 错误消息体系重写：arraybuffer/stream 响应下也能解析后端 detail；401/403/404/409/5xx 分类中文提示
- [x] 空列表友好提示与下一步命令引导
- [x] 类型层补齐：Workspace / WorkspaceTreeNode / UploadResult / WorkspaceFileResult

---

## P0 — 缺陷 & 安全（待做）

| # | 内容 | 涉及端 | 说明 |
|---|------|--------|------|
| 1 | **后端读接口加鉴权** | 后端 | `GET /api/collections`、`GET /api/collections/{id}/documents`、`GET /api/documents/{id}`、`/raw`、`/download`、`/versions` 目前无需认证即可访问，对外网暴露时文档原文可被未认证遍历下载。应改为登录用户才能读，未登录仅能访问已分享内容 |

---

## P1 — 近期应做

| # | 命令 | 说明 |
|---|------|------|
| 2 | `kb push doc.md --as "新文件名.md"` | 上传时重命名（P2 #14 文档侧，工作空间侧已由 `ws push -p` 覆盖） |
| 3 | `kb collection download <id> -o <dir>` | 集合整包 zip 下载。后端目前仅在分享态提供 `GET /api/share/{token}/download`，需新增登录态端点，或 CLI 侧沿用 `download --all` 逐个下载 |
| 4 | `kb ws mv <oldPath> <newPath>` | 工作空间文件重命名/移动。后端无对应端点，需 CLI 侧组合「cat → push 新路径 → rm 旧路径」实现，或后端补 `PATCH /workspaces/{id}/files` |
| 5 | `kb assets <docId>` | 列出文档包内图片资产。后端无资产列表端点，需先补 `GET /api/documents/{id}/assets` |
| 6 | `--quiet` / `--no-color` 全局开关 | 管道与 CI 场景只输出关键值（ID / URL） |

---

## P2 — 功能增强

| # | 功能 | 说明 |
|---|------|------|
| 7 | **目录同步 `kb sync`** | 将本地目录同步到集合或工作空间：新增上传、变更覆盖、本地已删除的远程可选删除（`--prune`）。工作空间侧可基于 tree + sha1 差异实现 |
| 8 | **浏览器登录** | 实现 `BrowserAuthProvider`（架构已预留）：`kb login` 打开浏览器 → 后端回调 → 自动获取 token。需后端新增 `/api/auth/cli/callback` |
| 9 | **`kb watch`** | 监听文件/目录变化自动 push，类似 nodemon |
| 10 | **Shell 自动补全** | `kb completion bash/zsh/fish/powershell` |
| 11 | **项目级配置文件** | 项目目录下 `.kbconfig` 记录默认集合/工作空间 ID，省去每次传 `-c`（环境变量注入已完成，此项为文件级） |
| 12 | **多账户/多服务端切换** | `kb profile add/use/list`，连接多个 kb-service 实例 |

---

## P3 — 体验优化

| # | 功能 | 说明 |
|---|------|------|
| 13 | **彩色 diff 对比** | `kb diff <id1> <id2>` 或 `kb diff <id> <localFile>` 对比文档差异 |
| 14 | **Markdown 终端渲染** | `kb raw <id> --render` 用 ANSI 渲染标题/表格/代码高亮，参考 `glow` |
| 15 | **离线缓存** | 本地缓存集合与文档列表，`kb list` / `kb search` 可离线查询，`--refresh` 重新拉取 |
| 16 | **npm 发布告警修复** | 发布时 `"bin[kb]" script name was cleaned` 告警 |
| 17 | **搜索分页与过滤** | 后端 `GET /api/search` 仅支持 `q` 且硬编码 LIMIT 20，需后端补 `limit/offset/collection_id/ext` 参数后 CLI 跟进 |

---

## 后端待改（非 CLI 代码，阻塞上表部分项）

| # | 内容 | 文件 | 阻塞的 CLI 项 |
|---|------|------|--------------|
| 18 | 统一鉴权：读接口加 `Depends(get_current_user)` | `collections.py`, `documents.py` | P0 #1 |
| 19 | 新增登录态集合整包下载端点 | `collections.py` | P1 #3 |
| 20 | 新增工作空间文件重命名/移动端点 | `workspaces.py` | P1 #4 |
| 21 | 新增文档资产列表端点 | `documents.py` | P1 #5 |
| 22 | 搜索端点补分页与过滤参数 | `search.py` | P3 #17 |
| 23 | 新增 `GET /api/auth/cli/callback` 为浏览器登录做准备 | `auth.py` | P2 #8 |

---

## 版本历史

- **v0.2.0** — 与后端/前端全面功能对齐：新增工作空间命令组（13 条）、文档包 zip 上传、`raw`/`move`/`version:delete`/批量下载、集合 get/update、分享撤销与总览、非交互登录与环境变量、上传进度与体积校验、错误消息体系重写
- **v0.1.0** — 基础 CRUD 命令（17 条）、表格 + JSON 双输出、交互式密码登录、npm 发布
