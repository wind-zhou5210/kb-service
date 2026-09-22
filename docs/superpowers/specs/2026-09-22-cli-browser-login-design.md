# CLI 浏览器授权登录（OAuth 风格）设计文档

- 日期：2026-09-22
- 状态：已确认，待实施
- 相关模块：`cli/`、`backend/app/api/auth.py`、`frontend/src/pages/Login.tsx`

## 1. 背景与目标

### 1.1 现状

CLI 目前只支持账号密码登录（`kb login <用户名>` 交互式输入或 `kb login <用户名> -p <密码>`），
在 `cli/src/auth.ts` 中以 `PasswordAuthProvider` 实现，凭据以表单请求 `POST /api/auth/login`
换取 JWT 并保存到 `~/.kbconfig.json`。

该方式存在两个体验问题：

1. 密码需要在终端中再次输入，而用户通常已经在浏览器中登录过；
2. 交互式密码输入在不同终端的 raw mode 行为不一致（Windows 需特殊分支处理）。

### 1.2 目标

让 `kb login` 默认走浏览器授权：命令发起后在浏览器打开服务登录页，用户在页面上完成登录，
CLI 终端自动完成登录，无需在终端输入密码。

### 1.3 非目标（明确不做）

- **不接入第三方身份提供方**（GitHub / Google OAuth）。本服务是单管理员自托管，无用户体系，
  引入外部 IdP 无对应收益（此前已评估并否决）。
- **不实现设备码流程（RFC 8628）**。已确认 CLI 只在本机运行（有浏览器、可访问 localhost），
  因而无需设备码轮询这一针对无浏览器环境的方案。
- **不改造前端整体登录体验**。仅在现有登录页增加 CLI 授权分支，无参数时行为完全不变。

## 2. 需求澄清结论

| 决策点 | 结论 | 影响 |
|--------|------|------|
| CLI 运行环境 | 只在本机（有浏览器，localhost 可达） | 采用**本地回调**，无需设备码流程 |
| 密码登录兼容 | **保留** `kb login -p` 作为备选 | 脚本/CI 场景不受影响；`KB_TOKEN` 环境变量继续有效 |
| 授权交互 | **登录即授权**（不增加确认页） | 服务仅一个管理员，不存在误授权给第三方应用的风险 |

## 3. 方案选型

### 3.1 候选方案

| 方案 | 做法 | 安全评估 | 复杂度 |
|------|------|----------|--------|
| ① **授权码 + PKCE**（选定） | CLI 生成 `code_challenge`；登录后服务端返回一次性授权码；CLI 用 `code + code_verifier` 换取 JWT | JWT 不经过 URL；授权码一次性、5 分钟失效、经 PKCE 与发起方绑定 | 中 |
| ② 签名票据（无服务端存储） | 服务端返回 HMAC 签名的短期票据，CLI 用票据换 JWT | 需额外密钥管理；无状态难以保证"一次性"，防重放依赖短时效 | 高 |
| ③ 直接回调 JWT | 登录后 302 将 `?token=<jwt>` 交给 CLI | **JWT 明文进入 URL**：浏览器历史、代理日志、本机其他进程均可读取；无 PKCE 绑定 | 低 |

### 3.2 选择理由

选定方案 ①：

- **凭据不进 URL**：JWT 仅在 `POST /auth/cli/token` 的响应体中返回，避免 ③ 的泄露面；
- **一次性 + 短时效 + PKCE 绑定**：即使授权码被本机其他进程截获，没有 `code_verifier` 也无法换取 JWT；
- **与业界一致**：`gh auth login`、`gcloud auth login` 均为此流程，行为可预期；
- 方案 ② 的收益（服务重启不丢授权码）在本场景价值极低——重启后重新登录一次即可。

## 4. 详细设计

### 4.1 完整流程

```
终端 kb login                               浏览器                        服务端
──────────────────────────────────────────────────────────────────────────────────────
1. 生成 code_verifier（随机 43-128 字符）
   code_challenge = base64url(sha256(verifier))
   state = 随机串
2. 启动本机回调服务器（bind 127.0.0.1:随机高位端口）
3. 打开浏览器 ────────────────────────► GET /login
                                          ?cli_callback=1
                                          &redirect_uri=http://127.0.0.1:PORT/callback
                                          &code_challenge=<challenge>
                                          &state=<state>
                                          &client=kb-cli
                                            │
                                            页面顶部显示「kb-cli 正在请求登录」提示条
                                            用户输入账号密码并提交
                                            │
                                            ├─► POST /api/auth/cli/authorize
                                            │     校验凭据
                                            │     校验 redirect_uri 白名单
                                            │     生成一次性授权码（5 分钟 TTL）
                                            │◄── { redirect: "http://127.0.0.1:PORT/callback?code=…&state=…" }
                                            页面执行 location.href = redirect
                                                                          │
4. 回调服务器收到请求 ◄────────────────────────────────────────────────────┘
   校验 state 一致
5. POST /api/auth/cli/token {code, code_verifier} ──► 校验授权码存在/未过期/未使用
                                                     校验 SHA256(verifier) == challenge
                                                     标记授权码已使用
                                                ◄─── { access_token, token_type }
6. 保存 token 与 username 到 ~/.kbconfig.json（沿用现有逻辑）
7. 回调响应返回简洁 HTML「登录成功，请返回终端」
8. 终端显示登录成功，关闭回调服务器
```

### 4.2 后端设计（`backend/app/api/auth.py`）

新增两个端点：

| 端点 | 请求 | 响应 | 说明 |
|------|------|------|------|
| `POST /auth/cli/authorize` | 表单：`username`、`password`、`redirect_uri`、`code_challenge`、`state` | `{ "redirect": "<回调地址>?code=…&state=…" }` | 校验凭据与参数合法性后生成授权码。**不直接 302**，由前端跳转，便于在页面内展示错误 |
| `POST /auth/cli/token` | JSON：`code`、`code_verifier` | `{ "access_token": "<jwt>", "token_type": "bearer" }` | 校验并**消费**授权码，返回 JWT |

授权码存储：

- 结构：内存字典 `code -> { username, code_challenge, redirect_uri, expires_at }`
- TTL：5 分钟（过期条目在读写时惰性清理）
- 一次性：换取成功后立即删除；校验失败不消费（允许同码重试，但受 TTL 限制）
- 一致性依据：Dockerfile 中 uvicorn 为**单 worker**，内存状态一致；进程重启导致授权码丢失时，
  用户重新执行 `kb login` 即可

校验规则：

- `redirect_uri` 白名单：仅允许 `http://127.0.0.1:<port>` 与 `http://localhost:<port>`（含路径），
  其余一律拒绝，防开放重定向
- `code_challenge` 非空且长度合理（43-128 字符）
- `state` 非空
- 凭据校验复用与 `/auth/login` 完全相同的判断逻辑

### 4.3 前端设计（`frontend/src/pages/Login.tsx`）

读取 URL 查询参数：

- **存在 `cli_callback=1`**（CLI 授权模式）：
  - 表单上方显示提示条：「**kb-cli 正在请求登录** — 登录后将授权该命令行工具访问你的知识库」
  - 提交时改为调用 `POST /api/auth/cli/authorize`，并携带 `redirect_uri`、`code_challenge`、`state`
  - 成功后执行 `window.location.href = resp.redirect`（跳回 CLI 的本地回调地址）
  - 失败时在页面内展示后端返回的错误信息（如"用户名或密码错误"）
- **不存在该参数**：保持现有行为不变（调 `/auth/login` → 存 token → 跳转 `location.state.from`）

说明：授权模式下**不写入浏览器本地 token**（CLI 自己保存凭据），避免网页登录态被意外改变。

### 4.4 CLI 设计（`cli/src/auth.ts`、`cli/src/commands/auth.ts`）

新增 `BrowserAuthProvider implements AuthProvider`（补上 `auth.ts` 中已有的注释预留）：

1. 生成 `code_verifier`（`crypto.randomBytes` → base64url）、`code_challenge`（SHA-256）、`state`
2. 以 `http.createServer` 在 `127.0.0.1` 上监听随机端口（`listen(0)` 由系统分配，避免占用冲突）
3. 打印授权链接并尝试打开浏览器；打开命令按平台选择：macOS `open`、Windows `start`、Linux `xdg-open`
4. 等待回调（默认 5 分钟超时）：
   - 校验 `state` 与本地一致，否则返回错误页并继续等待（防伪造回调）
   - 取得 `code` 后立即向用户返回「登录成功，请返回终端」页面
5. 调用 `POST /api/auth/cli/token` 换取 JWT，写入 `~/.kbconfig.json`（`token` + `username`）
6. 关闭本地服务器

命令层调整（`kb login`）：

| 用法 | 行为 |
|------|------|
| `kb login` | **默认走浏览器授权流程** |
| `kb login -p <密码>` / `--password` | 保留原密码登录（脚本/CI） |
| `kb login --print-url` | 仅打印授权链接、不自动打开浏览器（本机无 GUI 时手动复制到浏览器） |

依赖策略：**零新增运行时依赖**——`crypto`、`http` 均为 Node 内置；打开浏览器用 `child_process` 自行实现。

### 4.5 安全设计

| 风险 | 措施 |
|------|------|
| 授权码被本机其他进程截获 | PKCE(S256) 绑定：无 `code_verifier` 无法换取 JWT |
| 授权码重放 | 一次性消费 + 5 分钟 TTL |
| 开放重定向（授权码被导向攻击者域名） | `redirect_uri` 白名单仅允许本机 `http://127.0.0.1` / `http://localhost` |
| CSRF / 伪造回调 | CLI 校验 `state` |
| JWT 泄露 | 不经过 URL；仅在 POST 响应体返回 |
| 本机端口被抢占 | 由系统分配随机端口（`listen(0)`）+ `state` 校验 + PKCE 绑定 |

补充说明：服务部署在 http（IP 直连）下，本地回调用 http 属 OAuth 规范明确允许的形式
（本机回环地址不要求 TLS），安全性由 PKCE 与一次性授权码保证。

### 4.6 错误处理

| 场景 | 终端表现 | 页面表现 |
|------|----------|----------|
| 密码错误 | 提示"授权失败：用户名或密码错误"（含退出码 1） | 表单下方展示错误信息，可重试 |
| 授权码过期（>5 分钟） | 提示"授权码已过期，请重新执行 kb login" | — |
| 回调超时（用户未完成） | 提示"授权超时（5 分钟），请重新执行 kb login" | — |
| 用户直接关闭浏览器页面 | 同超时处理 | — |
| 端口无法监听 | 回退提示使用 `--print-url` 并说明原因 | — |
| 浏览器打开失败 | 打印链接并提示手动访问（不视为失败） | — |

## 5. 兼容性

- `kb login <用户名>`（交互式密码）与 `kb login <用户名> -p <密码>`：**保留**，行为不变
- `KB_SERVER` / `KB_TOKEN` / `KB_USERNAME` 环境变量优先级：不变
- 网页端登录（`/login` 无 `cli_callback` 参数）：行为完全不变
- 后端既有 `/auth/login`、`/auth/session`、`/auth/logout`：不修改
- 旧版本 CLI 连接新服务端：不受影响（只新增端点，未改动既有端点契约）

## 6. 测试计划

### 6.1 后端（隔离容器 + curl）

- `POST /auth/cli/authorize`：正确凭据返回 `redirect`，且 `redirect` 中 `code` 与 `state` 正确回填
- `redirect_uri` 白名单：`http://127.0.0.1:1234/cb`（通过）、`http://localhost:1234/cb`（通过）、
  `http://evil.com/cb`（拒绝）、`https://127.0.0.1:1234/cb`（拒绝）
- `POST /auth/cli/token`：正确 `code + verifier` 换取 JWT；`verifier` 不匹配拒绝；
  同一 `code` 第二次使用拒绝（一次性）；过期 `code` 拒绝
- 回归：`/auth/login`、`/auth/session`、`/auth/logout` 行为不变

### 6.2 真实浏览器端到端（关键，吸取此前 iframe 事故教训）

用 headless Chromium 走完整链路，而非仅接口层验证：

1. 打开授权 URL（含全部查询参数），断言页面出现「kb-cli 正在请求登录」提示条
2. 填入凭据并提交，断言页面发生跳转且目标为 `127.0.0.1:<port>` 回调地址
3. 断言回调页面显示「登录成功」
4. 用回调得到的 `code` + `verifier` 换取 JWT，并调用需鉴权接口验证令牌可用
5. 反向断言：`redirect_uri` 为外域时页面/接口拒绝

### 6.3 CLI

- 成功路径（本机执行，验证 token 写入 `~/.kbconfig.json` 且 `kb whoami` 通过）
- 回调超时（缩短超时便于验证）
- 用户取消（关闭页面）
- `--print-url` 模式
- 端口占用/无法监听时的回退提示

### 6.4 回归

- `kb login -p` 与 `KB_TOKEN` 环境变量仍可用
- 网页端登录与工作空间预览不受影响

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 本机防火墙拦截回环端口 | 使用回环地址（一般不受防火墙限制）；失败时提示改用 `--print-url` |
| 用户浏览器已登录网页端，授权页需要重新登录 | 属预期行为：授权流程始终要求显式登录，避免静默授权 |
| 服务重启导致授权码失效 | 提示重新执行即可；单管理员场景影响极小 |
| 多 worker 部署时内存授权码不一致 | 当前 Dockerfile 为单 worker；若未来调整为多 worker，需改为共享存储（在本设计中记录为约束条件） |

## 8. 交付物

- 后端：`/auth/cli/authorize`、`/auth/cli/token` 两个端点 + 授权码存储与校验
- 前端：登录页 CLI 授权分支与提示条
- CLI：`BrowserAuthProvider` + `kb login` 默认走浏览器 + `--print-url`
- 文档：README（CLI 章节）与 `cli/README.md` 更新登录说明
