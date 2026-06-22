# kb-service-cli TODO / 功能路线图

> 按优先级排序。P0 = 缺陷或必要补充，P1 = 近期应做，P2 = 后续迭代，P3 = 远期展望。

---

## P0 — 缺陷 & 安全

| # | 内容 | 涉及端 | 说明 |
|---|------|--------|------|
| 1 | **后端读接口加鉴权** | 后端 | `GET /api/collections`、`GET /api/documents/*` 目前无需认证即可访问，应改为登录用户才能读，未登录只能访问已分享文档 |
| 2 | **撤销分享链接** | CLI + 后端 | 后端 `DELETE /api/collections/{id}/share` 和 `DELETE /api/documents/{id}/share` 已存在，CLI 需补充 `kb share revoke collection/document <id>` |
| 3 | **修复文档分享端点部署** | 后端 | `POST /api/documents/{id}/share` 源码已有但云端未部署，导致 `kb share document` 返回 404 |

---

## P1 — 缺失的命令

| # | 命令 | 对应后端接口 | 说明 |
|---|------|-------------|------|
| 4 | `kb collection update <id> --name --desc` | `PATCH /api/collections/{id}` | 修改集合名称和描述 |
| 5 | `kb raw <id>` | `GET /api/documents/{id}/raw` | 在终端直接输出文档原始内容（类似 `cat`） |
| 6 | `kb share revoke collection <id>` | `DELETE /api/collections/{id}/share` | 撤销集合分享 |
| 7 | `kb share revoke document <id>` | `DELETE /api/documents/{id}/share` | 撤销文档分享 |

---

## P2 — 功能增强

| # | 功能 | 说明 |
|---|------|------|
| 8 | **目录同步 `kb sync`** | 将本地目录内容同步到指定集合：`kb sync ./docs -c 1`。对比文件名，新增的上传，已存在的跳过（或按 SHA1 判断），本地已删除的远程可选删除。 |
| 9 | **浏览器登录** | 实现 `BrowserAuthProvider`（架构已预留）：`kb login` 打开浏览器 → 后端 OAuth/回调 → 自动获取 token。配合后端新增 `/api/auth/cli/login` 回调端点。 |
| 10 | **`kb watch`** | 监听文件/dir 变化，自动 push：`kb watch ./docs -c 1`，类似 `nodemon` 的行为。 |
| 11 | **Shell 自动补全** | `kb completion bash/zsh/fish/powershell`，通过 commander 内置的补全生成能力。 |
| 12 | **目录级配置文件** | 支持在项目目录下放置 `.kbconfig`，记录默认集合 ID 和选项，省去每次传 `-c`：`kb push ./doc.md` 自动使用当前目录配置的集合。 |
| 13 | **多账户/多服务端切换** | `kb profile add <name> <url>` / `kb profile use <name>`，支持连接多个 kb-service 实例。 |
| 14 | **推送到指定文件名** | `kb push doc.md -c 1 --as "新文件名.md"` 上传时允许重命名。 |
| 15 | **批量下载** | `kb download --all -c 1 -o ./export` 下载某集合下全部文档，或按查询结果批量下载。 |

---

## P3 — 体验优化

| # | 功能 | 说明 |
|---|------|------|
| 16 | **上传进度条** | 大文件 push 时显示百分比进度，而非静态 spinner。 |
| 17 | **彩色 diff 对比** | `kb diff <id1> <id2>` 对比两个文档内容差异。 |
| 18 | **Markdown 终端渲染** | `kb raw <id> --render` 在终端用 ANSI 渲染 Markdown（标题加粗、表格、代码高亮），参考 `glow`。 |
| 19 | **离线缓存** | 本地缓存集合和文档列表，`kb search` / `kb list` 可离线查询缓存数据，附加 `--refresh` 重新拉取。 |
| 20 | **CI/CD 友好输出** | 加 `--quiet` 只输出 ID，加 `--fail-on-error` 非 0 退出码，方便管道使用。 |
| 21 | **npm 告警修复** | 发布时 `"bin[kb]" script name was cleaned` 告警需要修复。 |

---

## 后端待改（非 CLI 代码）

| # | 内容 | 文件 |
|---|------|------|
| 22 | 统一鉴权：所有 GET 接口加 `Depends(get_current_user)` | `collections.py`, `documents.py`, `search.py` |
| 23 | 公开分享接口允许未登录访问 `GET /api/share/{token}` | `share.py`, `doc_share.py` |
| 24 | 新增 `GET /api/auth/cli/callback` 为浏览器登录做准备 | `auth.py` |

---

## 已完成

- [x] 全部基础 CRUD 命令（17 条）
- [x] 表格 + JSON 双输出
- [x] `--json` 机器可读
- [x] 交互式密码登录（Windows 兼容）
- [x] npm 发布 `kb-service-cli`
- [x] README / help 体系 / 测试用例
