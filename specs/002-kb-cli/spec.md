# kb-cli 命令行工具 需求规范

Version: 1.0
Created: 2026-06-18
Status: Draft

## 1. 概述

### 1.1 背景
当前 kb-service 知识库仅支持通过 Web 界面上传和管理 Markdown/HTML 文件。用户在本地写完文档后，需要打开浏览器、登录、选择集合、手动拖拽上传，流程断点长，且无法融入开发者日常工作流（终端）。

此外，CI/CD 流水线中自动生成的文档制品（如 API 文档、构建报告）无法自动化推送到知识库。

### 1.2 目标
- 提供 `kb` 命令行工具，让用户在终端完成文件上传、文档管理、搜索等全部操作
- 支持交互式使用与脚本化调用两种模式
- 降低知识库的使用门槛，使其融入开发者日常工具链

### 1.3 范围

**MVP**：
- 命令行认证（交互式密码登录）
- 集合管理（列表、创建、删除）
- 文档操作（上传、列表、搜索、查看、下载、更新元信息、删除）
- 分享管理（生成/查看集合和文档的分享链接）
- 全局服务端地址配置
- 人类友好表格输出 + `--json` 机器可读输出

**后续迭代**：
- `kb sync <dir>` 目录同步（保持本地目录与集合内容一致）
- 浏览器回调登录（`kb login` 打开浏览器完成认证）
- 配置文件 `.kbconfig` 支持（目录级默认集合和默认选项）
- 多账户切换（`kb profile`）
- Shell 自动补全（bash/zsh/fish）
- `kb watch` 监听文件变化自动推送

### 1.4 成功指标
- 用户可通过 `npm i -g kb-cli` 完成安装并成功完成首次 `kb login` + `kb push`
- 单文件上传耗时 ≤ Web 端同操作
- 每条命令执行耗时用户体验可接受（表格输出 < 3s，含网络延迟）

## 2. 用户分析

### 2.1 目标用户
| 角色 | 场景 | 频率 |
|------|------|------|
| **开发者** | 写完技术文档后终端一键推送 | 日常高频 |
| **技术写作者** | 批量导入已有 Markdown/HTML 文档 | 一次性或低频 |
| **CI/CD 流水线** | 自动化发布后推送构建文档制品 | 按触发，频次不定 |
| **知识库管理员** | 通过命令行快速管理集合和文档 | 中频 |

所有 CLI 操作需要与现有 Web 端同等级别的鉴权（JWT Bearer Token）。

### 2.2 用户故事

**作为** 开发者
**我想要** 在终端中执行 `kb push ./doc.md -c 1` 将刚写完的文档推送到知识库
**以便于** 不离开编辑器/终端环境就能完成知识沉淀

**作为** CI/CD 流水线运维者
**我想要** 在构建脚本中执行 `kb push dist/report.html -c 3 --json` 自动推送构建报告
**以便于** 团队成员在知识库中统一查看最新制品文档

**作为** 知识库管理员
**我想要** 通过命令行管理集合和文档（创建、列表、删除）
**以便于** 在服务器或远程环境中批量维护知识库

**作为** 技术写作者
**我想要** 在终端中全文搜索知识库内容
**以便于** 快速定位已有文档，避免重复创作

### 2.3 用户旅程

**首次使用**：
1. 安装：`npm i -g kb-cli`
2. 配置服务端地址：`kb config set server https://kb.example.com`
3. 登录：`kb login --username admin` → 输入密码
4. 查看集合：`kb collection list`
5. 上传文件：`kb push ./my-doc.md -c 1`
6. 搜索：`kb search "关键词"`

**日常使用**（已登录）：
1. 写完文档 `api-guide.md`
2. `kb push api-guide.md -c 1`
3. 在终端看到上传成功确认和文档 ID

## 3. 功能需求

### 3.1 核心功能

| 功能点 | 描述 | 优先级 | 验收标准 |
|--------|------|--------|----------|
| 全局配置 | 设置和查看服务端地址 | P0 | `config set/get` 正常读写 `~/.kbconfig.json` |
| 密码登录 | 交互式用户名+密码登录获取 JWT | P0 | 登录成功写入 token，失败提示错误 |
| 登出 | 清除本地凭据 | P0 | token 从配置中移除 |
| 当前用户 | 显示已登录用户名 | P1 | 输出当前配置中的用户信息 |
| 集合列表 | 列出全部集合（含文档计数） | P0 | 表格展示，`--json` 输出 JSON |
| 集合创建 | 创建新集合 | P0 | 支持 `--desc` 描述参数 |
| 集合删除 | 删除集合（级联删除文档） | P1 | 需要二次确认 |
| 文件上传 | 上传一个或多个文件到指定集合 | P0 | 通配符批量上传，进度反馈 |
| 文档列表 | 列出指定集合下的文档 | P0 | 表格展示，`--json` 输出 JSON |
| 全文搜索 | FTS5 全文检索文档 | P0 | 带高亮片段展示 |
| 文档详情 | 查看文档元信息 | P1 | 表格或键值对展示 |
| 文档下载 | 下载文档到本地 | P1 | 支持 `-o` 指定输出目录 |
| 文档更新 | 修改文档标题、标签、备注 | P1 | 至少传一个字段 |
| 文档删除 | 删除文档 | P1 | 需要二次确认 |
| 集合分享 | 生成/查看集合分享链接 | P1 | 输出完整分享 URL |
| 文档分享 | 生成/查看文档分享链接 | P1 | 输出完整分享 URL |

### 3.2 功能详细说明

#### 功能 A：全局配置（config）
- **触发条件**：首次使用，或切换服务端地址
- **操作流程**：`kb config set server <url>` → 写入 `~/.kbconfig.json` → 提示配置成功
- **业务规则**：URL 需包含协议（http/https），末尾不带斜杠；未配置 server 时所有命令提示先配置
- **输出结果**：`config set` 静默成功或简单提示；`config get` 以表格显示当前全部配置项

#### 功能 B：密码登录（login）
- **触发条件**：首次使用，或 token 过期
- **操作流程**：
  1. 用户执行 `kb login [--username <user>]`
  2. 若未传 `--username`，交互式询问用户名
  3. 交互式输入密码（终端回显隐藏）
  4. CLI 调用 `POST /api/auth/login` 获取 JWT
  5. 成功后将 token 写入 `~/.kbconfig.json`
  6. 提示登录成功，显示用户名
- **业务规则**：服务端未配置时先提示配置 server；密码输入错误返回友好提示（不透露细节）；架构上预留 `AuthProvider` 接口，未来可扩展浏览器回调登录
- **输出结果**：登录状态和用户名

#### 功能 C：文件上传（push）
- **触发条件**：用户有一批文件需要推送到知识库
- **操作流程**：`kb push ./doc1.md ./doc2.html -c 1` → 依次上传，显示进度 → 输出结果表格
- **业务规则**：
  - 支持通配符：`kb push docs/*.md -c 1`
  - 文件扩展名不在白名单（.md/.html/.htm）时跳过并警告
  - 文件大小超限（默认 10MB）时跳过并报错
  - 集合不存在时返回明确错误
  - 上传成功后显示文档 ID、标题、大小
- **输出结果**：表格列出每个文件的上传状态（成功/失败/跳过）

#### 功能 D：全文搜索（search）
- **触发条件**：用户想快速查找包含某关键词的文档
- **操作流程**：`kb search "部署流程"` → 返回匹配文档列表 + 关键词高亮片段
- **业务规则**：支持中文分词；最多返回 20 条结果；结果按相关度排序
- **输出结果**：表格含标题、所属集合、高亮片段；`--json` 输出完整结果

#### 功能 E：文档更新（update）
- **触发条件**：用户想修改文档标题、标签或备注
- **操作流程**：`kb update 42 --title "新标题" --tags "tag1,tag2" --note "补充说明"`
- **业务规则**：`--title`、`--tags`、`--note` 至少传一个；不传任何参数时提示用法
- **输出结果**：更新后的文档元信息

### 3.3 交互说明

**输出格式原则**：
- 默认：人类友好的 ASCII 表格（cli-table3），彩色状态标识（成功/失败/警告）
- `--json`：机器可读 JSON，适合脚本管道处理（如 `kb list -c 1 --json | jq`）
- 加载中：spinner 动画（ora），避免终端卡死感
- 错误信息：红色文字，输出到 stderr

**危险操作保护**：
- 删除集合/文档需要用户输入 `y/N` 二次确认
- 可加 `--yes` / `-y` 跳过确认（用于脚本化）

**配置文件 `~/.kbconfig.json`**：
```json
{
  "server": "https://kb.example.com",
  "token": "eyJhbG...",
  "username": "admin"
}
```

## 4. 数据需求

### 4.1 数据展示

| 数据项 | 来源接口 | 展示格式 |
|--------|----------|----------|
| 集合列表 | GET /api/collections | 表格：ID、名称、描述、文档数、更新时间 |
| 文档列表 | GET /api/collections/{id}/documents | 表格：ID、标题、文件名、扩展名、大小、标签、更新时间 |
| 搜索结果 | GET /api/search?q= | 表格：文档ID、标题、类型、所属集合、高亮片段 |
| 文档详情 | GET /api/documents/{id} | 键值对：所有字段 + 表格 |
| 分享链接 | POST /api/collections/{id}/share | 完整 URL 文本 |

### 4.2 数据操作

| 操作 | HTTP 方法 | 接口路径 | 需要鉴权 |
|------|-----------|----------|----------|
| 登录 | POST | /api/auth/login | 否 |
| 列出集合 | GET | /api/collections | 是 |
| 创建集合 | POST | /api/collections | 是 |
| 更新集合 | PATCH | /api/collections/{id} | 是 |
| 删除集合 | DELETE | /api/collections/{id} | 是 |
| 列出文档 | GET | /api/collections/{id}/documents | 是 |
| 上传文档 | POST | /api/collections/{id}/documents | 是 |
| 获取文档 | GET | /api/documents/{id} | 是 |
| 更新文档 | PATCH | /api/documents/{id} | 是 |
| 删除文档 | DELETE | /api/documents/{id} | 是 |
| 搜索 | GET | /api/search?q= | 是 |
| 生成集合分享 | POST | /api/collections/{id}/share | 是 |
| 撤销集合分享 | DELETE | /api/collections/{id}/share | 是 |
| 生成文档分享 | POST | /api/documents/{id}/share | 是 |
| 撤销文档分享 | DELETE | /api/documents/{id}/share | 是 |

### 4.3 数据校验规则

- 服务端 URL 必须以 `http://` 或 `https://` 开头
- 文件扩展名仅允许 `.md`、`.html`、`.htm`
- 集合 ID 必须为正整数
- 更新文档时至少提供 title/tags/note 中的一个字段
- Token 过期（HTTP 401）时提示用户重新登录

## 5. 非功能需求

### 5.1 性能要求

- 命令冷启动时间（解析 + 网络连接）：< 1s
- 单文件上传（1MB 以内）：< 5s
- 列表/搜索查询：< 3s
- 支持同时上传最多 50 个文件（受后端限制）

### 5.2 兼容性要求

- Windows 10+、macOS 12+、Linux（主流发行版）
- Node.js >= 18 LTS
- 终端宽度 >= 80 列（自动适配）
- 支持 PowerShell、cmd、bash、zsh、fish

### 5.3 安全要求

- Token 存储在 `~/.kbconfig.json`，文件权限建议为 600（用户可读写）
- 密码在终端输入时不回显
- Token 明文存储于本地文件系统（用户自行保障机器安全）
- HTTPS 连接的证书错误应明确提示，不静默忽略
- CLI 不记录命令历史中的密码（使用 stdin 交互式输入，而非命令行参数传入密码）

## 6. 边缘情况与异常处理

| 场景 | 处理方式 |
|------|----------|
| 未配置 server 就执行命令 | 提示先执行 `kb config set server <url>` |
| 未登录就执行需鉴权命令 | 提示先执行 `kb login` |
| Token 过期 | HTTP 401 → 提示 token 过期，请重新 `kb login` |
| 用户名或密码错误 | 提示"登录失败：用户名或密码错误" |
| 服务端不可达 | 提示"无法连接到 {server}，请检查地址或网络" |
| 上传不支持的文件类型 | 跳过该文件，警告"不支持的文件类型: xxx，仅支持 .md/.html/.htm" |
| 上传文件超过大小限制 | 跳过该文件，报错"文件过大: xxx（上限 10MB）" |
| 集合不存在 | 提示"集合 ID xxx 不存在"，列出可用集合 |
| 文档不存在 | 提示"文档 ID xxx 不存在" |
| 搜索无结果 | 提示"未找到匹配 'xxx' 的文档" |
| 网络超时 | 提示"请求超时，请检查网络连接" |
| 删除操作无确认 | 第二行提示"输入 y 确认，其他键取消" |
| `--json` 模式下错误 | 错误信息以 JSON 格式输出到 stderr：`{"error": "..."}` |

## 7. 验收标准

### 7.1 功能验收
- [ ] `npm i -g kb-cli` 安装成功，`kb --help` 显示帮助
- [ ] `kb config set server <url>` + `kb config get` 正常读写配置
- [ ] `kb login --username <user>` 交互式密码登录成功，token 写入配置
- [ ] `kb logout` 清除 token
- [ ] `kb whoami` 显示当前用户
- [ ] `kb collection list` 表格输出全部集合
- [ ] `kb collection create <name> --desc <desc>` 创建成功
- [ ] `kb collection delete <id>` 二次确认后删除
- [ ] `kb push <files...> -c <id>` 批量上传，输出每个文件状态
- [ ] `kb list -c <id>` 列出集合下文档
- [ ] `kb search <query>` 全文检索，含高亮片段
- [ ] `kb get <id>` 显示文档详情
- [ ] `kb download <id> -o <dir>` 下载到指定目录
- [ ] `kb update <id> --title/--tags/--note` 更新文档
- [ ] `kb delete <id>` 二次确认后删除文档
- [ ] `kb share collection <id>` 输出分享链接
- [ ] `kb share document <id>` 输出分享链接
- [ ] 全部查询命令 `--json` 输出合法 JSON

### 7.2 体验验收
- [ ] 表格输出对齐，中文不乱
- [ ] 加载中有 spinner 动画
- [ ] 成功/失败/警告有颜色区分
- [ ] 错误信息友好，包含建议操作
- [ ] 密码输入不回显
- [ ] 危险操作有二次确认

## 8. 附录

### 8.1 参考资料
- 现有后端 API 接口代码：`backend/app/api/`
- 现有前端 API 客户端：`frontend/src/api/client.ts`
- CLI 设计讨论原始对话（2026-06-18）
- 参考 CLI 工具：`gh` (GitHub CLI)、`vercel` (Vercel CLI)

### 8.2 技术架构参考（非规范内容，供开发团队参考）
- 语言：Node.js TypeScript
- CLI 框架：commander
- HTTP 客户端：axios
- 输出美化：chalk + cli-table3 + ora
- 配置存储：`~/.kbconfig.json`
- 认证架构：`AuthProvider` 接口 → MVP: `PasswordAuthProvider`，预留 `BrowserAuthProvider`
- npm 包名：`kb-cli`，bin 命令名：`kb`

### 8.3 修订记录
| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| 1.0 | 2026-06-18 | - | 初稿，基于 2026-06-18 CLI 工具设计讨论 |
