# CLI 浏览器授权登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `kb login` 默认走浏览器授权——命令发起后在浏览器打开服务登录页，用户在页面上登录后终端自动完成登录，无需在终端输入密码。

**Architecture:** OAuth 授权码 + PKCE + 本机回环回调。后端新增两个端点（`/auth/cli/authorize` 签发一次性授权码、`/auth/cli/token` 凭 `code + code_verifier` 换取 JWT），授权码存进程内存（服务为单 worker 部署）；前端登录页识别 `cli_callback` 参数后走授权分支；CLI 新增 `BrowserAuthProvider`，在 `127.0.0.1` 随机端口监听回调。

**Tech Stack:** FastAPI（后端）/ React + Ant Design + Vite（前端）/ TypeScript + Commander + Axios（CLI）；无新增运行时依赖。

**设计依据：** `docs/superpowers/specs/2026-09-22-cli-browser-login-design.md`

**约定：**
- 全部工作在本分支 `feat/cli-browser-login` 上进行，禁止直接在 main 提交
- 项目无 pytest / jest 基础设施，验证方式沿用现有模式：**纯逻辑用可执行脚本**、**端点用隔离容器 + curl**、**涉及浏览器行为用 headless Chromium 端到端**

---

## 文件结构总览

| 文件 | 责任 | 动作 |
|------|------|------|
| `backend/app/core/cli_auth.py` | 授权码存储 + PKCE 校验 + 回调地址白名单（纯逻辑，可独立验证） | 新建 |
| `backend/tests/test_cli_auth.py` | 上述纯逻辑的验证脚本（plain Python，无需 pytest） | 新建 |
| `backend/app/api/auth.py` | 新增 `/auth/cli/authorize` 与 `/auth/cli/token` 两个端点 | 修改 |
| `frontend/src/api/client.ts` | 新增 `cliAuthorize()` 方法 | 修改 |
| `frontend/src/pages/Login.tsx` | 识别 `cli_callback` 参数并走授权分支 | 修改 |
| `frontend/src/index.css` | CLI 授权提示条样式 | 修改 |
| `cli/src/utils/open-browser.ts` | 跨平台打开系统浏览器 | 新建 |
| `cli/src/browser-auth.ts` | `BrowserAuthProvider`：PKCE 参数、回调服务器、换取 JWT | 新建 |
| `cli/src/commands/auth.ts` | `kb login` 默认走浏览器，保留 `-p`，新增 `--print-url` | 修改 |
| `README.md`、`cli/README.md` | 登录方式说明 | 修改 |

---

## Task 1: 授权码存储与 PKCE 校验（后端纯逻辑）

**Files:**
- Create: `backend/tests/test_cli_auth.py`
- Create: `backend/app/core/cli_auth.py`

- [ ] **Step 1: 先写验证脚本（此时模块尚不存在，运行会失败）**

创建 `backend/tests/test_cli_auth.py`：

```python
"""CLI 授权码存储与 PKCE 校验的验证脚本。

项目未引入 pytest，此脚本为可直接运行的 plain Python 验证：
    python backend/tests/test_cli_auth.py
全部断言通过时退出码为 0。
"""
import base64
import hashlib
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def main() -> int:
    from app.core import cli_auth

    failures: list[str] = []

    def check(name: str, cond: bool) -> None:
        print(f"  {'✓' if cond else '✗'} {name}")
        if not cond:
            failures.append(name)

    verifier = "a" * 64
    challenge = s256(verifier)
    redirect = "http://127.0.0.1:51234/callback"

    # 1) 签发后可正常消费，返回用户名
    cli_auth.reset_store()
    code = cli_auth.issue_code("admin", challenge, redirect)
    check("签发后可消费并返回用户名", cli_auth.consume_code(code, verifier) == "admin")

    # 2) 一次性：同一授权码不可二次使用
    check("授权码一次性（二次消费被拒）", cli_auth.consume_code(code, verifier) is None)

    # 3) verifier 不匹配则拒绝，且不消费（可用正确 verifier 再试）
    cli_auth.reset_store()
    code = cli_auth.issue_code("admin", challenge, redirect)
    check("verifier 不匹配被拒", cli_auth.consume_code(code, "b" * 64) is None)
    check("不匹配失败后仍可用正确 verifier 消费",
          cli_auth.consume_code(code, verifier) == "admin")

    # 4) 过期的授权码被拒绝
    cli_auth.reset_store()
    code = cli_auth.issue_code("admin", challenge, redirect)
    cli_auth._codes[code].expires_at = time.time() - 1  # 直接改过期时间，避免等待
    check("过期授权码被拒", cli_auth.consume_code(code, verifier) is None)

    # 5) 未知授权码被拒
    check("未知授权码被拒", cli_auth.consume_code("not-exist", verifier) is None)

    # 6) 回调地址白名单
    check("允许 127.0.0.1", cli_auth.is_allowed_redirect_uri("http://127.0.0.1:51234/callback"))
    check("允许 localhost", cli_auth.is_allowed_redirect_uri("http://localhost:51234/callback"))
    check("拒绝外域", not cli_auth.is_allowed_redirect_uri("http://evil.com/callback"))
    check("拒绝 https", not cli_auth.is_allowed_redirect_uri("https://127.0.0.1:51234/callback"))
    check("拒绝缺少端口", not cli_auth.is_allowed_redirect_uri("http://127.0.0.1/callback"))
    check("拒绝局域网地址", not cli_auth.is_allowed_redirect_uri("http://192.168.1.5:51234/callback"))

    # 7) code_challenge 格式校验（PKCE 规定 43-128 字符）
    check("接受 43 字符 challenge", cli_auth.is_valid_challenge("x" * 43))
    check("接受 128 字符 challenge", cli_auth.is_valid_challenge("x" * 128))
    check("拒绝 42 字符 challenge", not cli_auth.is_valid_challenge("x" * 42))
    check("拒绝 129 字符 challenge", not cli_auth.is_valid_challenge("x" * 129))

    print()
    if failures:
        print(f"失败 {len(failures)} 项: {', '.join(failures)}")
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 运行验证脚本，确认失败**

Run: `cd backend && python3 tests/test_cli_auth.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.cli_auth'`

- [ ] **Step 3: 实现 `backend/app/core/cli_auth.py`**

```python
"""CLI 浏览器授权登录：授权码存储、PKCE 校验、回调地址白名单。

授权码为一次性凭据，保存在进程内存中。依据：Dockerfile 中 uvicorn 为单 worker
部署，进程内状态一致；进程重启导致授权码失效时，用户重新执行 kb login 即可。
若将来改为多 worker，需改用共享存储（见设计文档「风险与缓解」）。
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlparse

# 授权码有效期：5 分钟（用户完成登录的合理窗口）
CODE_TTL_SECONDS = 300

# PKCE 规范（RFC 7636）规定的 code_challenge 长度范围
_MIN_CHALLENGE_LEN = 43
_MAX_CHALLENGE_LEN = 128


@dataclass
class _AuthCode:
    """一条待消费的授权码及其绑定信息。"""

    username: str
    code_challenge: str
    redirect_uri: str
    expires_at: float


_codes: dict[str, _AuthCode] = {}


def is_allowed_redirect_uri(uri: str) -> bool:
    """校验回调地址是否为本机回环地址（http + 显式端口）。

    白名单用于阻断开放重定向：授权码只允许回传到用户本机，
    不接受任何外部域名或局域网地址。
    """
    try:
        parsed = urlparse(uri)
    except ValueError:
        return False
    if parsed.scheme != "http":
        return False
    if parsed.hostname not in ("127.0.0.1", "localhost"):
        return False
    # 必须带端口：CLI 使用系统分配的随机高位端口
    return parsed.port is not None


def is_valid_challenge(challenge: str) -> bool:
    """校验 PKCE code_challenge 长度是否在规范范围内。"""
    return _MIN_CHALLENGE_LEN <= len(challenge) <= _MAX_CHALLENGE_LEN


def issue_code(username: str, code_challenge: str, redirect_uri: str) -> str:
    """签发一次性授权码，记录其与用户/PKCE/回调地址的绑定关系。"""
    _purge_expired()
    code = secrets.token_urlsafe(32)
    _codes[code] = _AuthCode(
        username=username,
        code_challenge=code_challenge,
        redirect_uri=redirect_uri,
        expires_at=time.time() + CODE_TTL_SECONDS,
    )
    return code


def consume_code(code: str, code_verifier: str) -> str | None:
    """校验并消费授权码：成功返回用户名，失败返回 None。

    校验项：存在、未过期、PKCE 的 S256(verifier) 与签发时的 challenge 一致。
    仅在校验全部通过时才删除（一次性）；失败不消费，允许用户在有效期内重试。
    """
    _purge_expired()
    entry = _codes.get(code)
    if entry is None:
        return None
    if time.time() > entry.expires_at:
        _codes.pop(code, None)
        return None
    if _s256(code_verifier) != entry.code_challenge:
        return None
    _codes.pop(code, None)
    return entry.username


def _s256(verifier: str) -> str:
    """计算 PKCE 的 S256 变换：base64url(sha256(verifier)) 去填充。"""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _purge_expired() -> None:
    """惰性清理过期授权码，避免内存无界增长。"""
    now = time.time()
    for key in [k for k, v in _codes.items() if v.expires_at < now]:
        _codes.pop(key, None)


def reset_store() -> None:
    """清空全部授权码（仅供验证脚本与测试使用）。"""
    _codes.clear()
```

- [ ] **Step 4: 运行验证脚本，确认全部通过**

Run: `cd backend && python3 tests/test_cli_auth.py`
Expected: PASS — 末尾输出 `全部通过`，退出码 0

- [ ] **Step 5: 提交**

```bash
git add backend/app/core/cli_auth.py backend/tests/test_cli_auth.py
git commit -m "feat(auth): CLI 授权码存储与 PKCE 校验（含可执行验证脚本）"
```

---

## Task 2: 后端端点（authorize / token）

**Files:**
- Modify: `backend/app/api/auth.py`

- [ ] **Step 1: 在 `backend/app/api/auth.py` 增加导入与请求模型**

在文件顶部导入区追加（保留现有导入不动）：

```python
from fastapi import Form
from pydantic import BaseModel

from app.core import cli_auth
```

- [ ] **Step 2: 在文件末尾追加两个端点**

```python
class CliTokenRequest(BaseModel):
    """CLI 换取令牌的请求体（JSON）。"""

    code: str
    code_verifier: str


@router.post("/cli/authorize")
async def cli_authorize(
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    redirect_uri: Annotated[str, Form()],
    code_challenge: Annotated[str, Form()],
    state: Annotated[str, Form()],
):
    """CLI 浏览器授权：校验凭据与参数后签发一次性授权码。

    不直接 302，而是返回跳转地址由前端执行——这样凭据错误时可在页面内提示，
    而不是把用户甩到一个无法展示错误的回调地址上。
    """
    if not cli_auth.is_allowed_redirect_uri(redirect_uri):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="回调地址不被允许（仅支持本机回环地址）",
        )
    if not cli_auth.is_valid_challenge(code_challenge):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="code_challenge 格式不正确",
        )
    if not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="state 不能为空",
        )
    if username != settings.admin_username or password != settings.admin_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    code = cli_auth.issue_code(username, code_challenge, redirect_uri)
    separator = "&" if "?" in redirect_uri else "?"
    return {"redirect": f"{redirect_uri}{separator}code={code}&state={state}"}


@router.post("/cli/token")
async def cli_token(payload: CliTokenRequest):
    """用授权码 + PKCE verifier 换取 JWT（授权码一次性，用过即废）。"""
    username = cli_auth.consume_code(payload.code, payload.code_verifier)
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="授权码无效、已使用或已过期，请重新执行 kb login",
        )
    return {
        "access_token": create_access_token(username),
        "token_type": "bearer",
        "username": username,
    }
```

- [ ] **Step 3: 启动隔离后端容器做端点验证**

```bash
cd /home/zhouzheng/Desktop/kb/kb-service
docker rm -f kb-cli-auth-test >/dev/null 2>&1
docker volume rm kb-cli-files kb-cli-db kb-cli-ws >/dev/null 2>&1
docker run -d --name kb-cli-auth-test -p 8000:8000 \
  -e KB_JWT_SECRET=testsecret -e KB_ADMIN_USERNAME=admin -e KB_ADMIN_PASSWORD=admin123 \
  -e KB_STORAGE_DIR=/data/files -e KB_DB_PATH=/data/db/kb.sqlite -e KB_WORKSPACE_DIR=/data/workspaces \
  -e KB_COOKIE_SECURE=false \
  -v kb-cli-files:/data/files -v kb-cli-db:/data/db -v kb-cli-ws:/data/workspaces \
  -v /home/zhouzheng/Desktop/kb/kb-service/backend/app:/app/app \
  registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:backend-latest
sleep 6
curl -s -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:8000/api/health
```

Expected: `health: 200`

- [ ] **Step 4: 验证正向流程（签发 → 换取 → 令牌可用）**

```bash
# 计算 PKCE 参数（verifier 固定为便于演示）
VERIFIER=$(python3 -c "print('a'*64)")
CHALLENGE=$(python3 -c "
import base64,hashlib
print(base64.urlsafe_b64encode(hashlib.sha256(('a'*64).encode()).digest()).rstrip(b'=').decode())
")
REDIRECT="http://127.0.0.1:51234/callback"

# 签发授权码
RESP=$(curl -s -X POST http://127.0.0.1:8000/api/auth/cli/authorize \
  -d "username=admin" -d "password=admin123" \
  -d "redirect_uri=$REDIRECT" -d "code_challenge=$CHALLENGE" -d "state=st-123")
echo "$RESP"
CODE=$(echo "$RESP" | python3 -c "import sys,json,urllib.parse as u; print(u.parse_qs(u.urlparse(json.load(sys.stdin)['redirect']).query)['code'][0])")

# 换取令牌
curl -s -X POST http://127.0.0.1:8000/api/auth/cli/token \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"code_verifier\":\"$VERIFIER\"}"
```

Expected: 第一条返回 `{"redirect":"http://127.0.0.1:51234/callback?code=...&state=st-123"}`；
第二条返回含 `access_token` 与 `username":"admin"` 的 JSON

- [ ] **Step 5: 验证反向用例（安全边界）**

```bash
# a) 授权码一次性：同一 code 第二次换取必须失败
curl -s -o /dev/null -w "重复使用授权码: %{http_code} (期望 400)\n" -X POST \
  http://127.0.0.1:8000/api/auth/cli/token -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"code_verifier\":\"$VERIFIER\"}"

# b) verifier 不匹配：重新签发后用错误 verifier 换取
RESP2=$(curl -s -X POST http://127.0.0.1:8000/api/auth/cli/authorize -d "username=admin" \
  -d "password=admin123" -d "redirect_uri=$REDIRECT" -d "code_challenge=$CHALLENGE" -d "state=st-2")
CODE2=$(echo "$RESP2" | python3 -c "import sys,json,urllib.parse as u; print(u.parse_qs(u.urlparse(json.load(sys.stdin)['redirect']).query)['code'][0])")
curl -s -o /dev/null -w "错误 verifier: %{http_code} (期望 400)\n" -X POST \
  http://127.0.0.1:8000/api/auth/cli/token -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE2\",\"code_verifier\":\"$(python3 -c "print('b'*64)")\"}"

# c) 外域回调地址必须被拒
curl -s -o /dev/null -w "外域 redirect_uri: %{http_code} (期望 400)\n" -X POST \
  http://127.0.0.1:8000/api/auth/cli/authorize -d "username=admin" -d "password=admin123" \
  -d "redirect_uri=http://evil.com/callback" -d "code_challenge=$CHALLENGE" -d "state=st-3"

# d) 错误密码必须被拒
curl -s -o /dev/null -w "错误密码: %{http_code} (期望 401)\n" -X POST \
  http://127.0.0.1:8000/api/auth/cli/authorize -d "username=admin" -d "password=wrong" \
  -d "redirect_uri=$REDIRECT" -d "code_challenge=$CHALLENGE" -d "state=st-4"

# e) 回归：既有登录端点不受影响
curl -s -o /dev/null -w "既有 /auth/login: %{http_code} (期望 200)\n" -X POST \
  http://127.0.0.1:8000/api/auth/login -d "username=admin&password=admin123"
```

Expected: 依次为 `400 / 400 / 400 / 401 / 200`

- [ ] **Step 6: 提交**

```bash
git add backend/app/api/auth.py
git commit -m "feat(auth): 新增 CLI 浏览器授权端点 authorize/token"
```

---

## Task 3: 前端登录页授权分支

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/Login.tsx`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: 在 `frontend/src/api/client.ts` 的 api 对象中新增方法**

在 `logoutSession` 之后插入（保持与既有风格一致，用 `URLSearchParams` 提交表单）：

```typescript
  /** CLI 浏览器授权：校验凭据后取得携带一次性授权码的回调地址 */
  cliAuthorize: (payload: {
    username: string
    password: string
    redirect_uri: string
    code_challenge: string
    state: string
  }) =>
    client
      .post<{ redirect: string }>(
        '/auth/cli/authorize',
        new URLSearchParams({
          username: payload.username,
          password: payload.password,
          redirect_uri: payload.redirect_uri,
          code_challenge: payload.code_challenge,
          state: payload.state,
        }),
      )
      .then((r) => r.data),
```

- [ ] **Step 2: 改造 `frontend/src/pages/Login.tsx`**

将文件顶部的导入与组件内的 `onFinish` 替换为下述版本（其余 JSX 不变，仅新增提示条）：

```typescript
import { useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined, FileTextOutlined, SafetyCertificateOutlined, DatabaseOutlined } from '@ant-design/icons'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../store/auth'
```

```typescript
export default function Login() {
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const setToken = useAuth((s) => s.setToken)
  const from = (location.state as any)?.from?.pathname || '/'

  // CLI 授权模式：URL 由 kb login 生成，携带回调地址与 PKCE 参数
  const isCliAuth = searchParams.get('cli_callback') === '1'
  const cliRedirectUri = searchParams.get('redirect_uri') || ''
  const cliChallenge = searchParams.get('code_challenge') || ''
  const cliState = searchParams.get('state') || ''

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    setErrorText('')
    try {
      if (isCliAuth) {
        // 授权模式：换取携带一次性授权码的回调地址后跳转，CLI 在本机接收
        const { redirect } = await api.cliAuthorize({
          username: values.username,
          password: values.password,
          redirect_uri: cliRedirectUri,
          code_challenge: cliChallenge,
          state: cliState,
        })
        window.location.href = redirect
        return
      }
      const { access_token } = await api.login(values.username, values.password)
      setToken(access_token)
      navigate(from, { replace: true })
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      const fallback = isCliAuth ? '授权失败，请重试' : '用户名或密码错误'
      if (isCliAuth) setErrorText(typeof detail === 'string' ? detail : fallback)
      else message.error(fallback)
    } finally {
      setLoading(false)
    }
  }
```

在 `<div className="login-form-wrap">` 内、`<div className="login-form-header">` 之前插入提示条：

```tsx
          {isCliAuth && (
            <div className="login-cli-notice">
              <strong>kb-cli 正在请求登录</strong>
              <span>登录后将授权该命令行工具访问你的知识库，凭据仅保存在你本机</span>
            </div>
          )}
```

在 `<Form ...>` 之后（`login-hint` 之前）插入错误提示：

```tsx
          {errorText && <div className="login-error-text">{errorText}</div>}
```

- [ ] **Step 3: 在 `frontend/src/index.css` 追加样式**

```css
/* CLI 授权模式提示条（登录页） */
.login-cli-notice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  margin-bottom: 18px;
  border: 1px solid var(--line-200, #d9d9d9);
  border-left: 3px solid var(--brand-ink, #1f1f1f);
  background: var(--paper-50, #fafafa);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.6;
}

.login-cli-notice strong {
  font-size: 14px;
}

.login-cli-notice span {
  color: var(--ink-400, #8c8c8c);
}

.login-error-text {
  margin-top: 12px;
  color: #cf1322;
  font-size: 13px;
}
```

- [ ] **Step 4: 类型检查与构建**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 无类型错误；构建输出 `✓ built in ...`

- [ ] **Step 5: 提交**

```bash
git add frontend/src/api/client.ts frontend/src/pages/Login.tsx frontend/src/index.css
git commit -m "feat(frontend): 登录页支持 CLI 授权模式（cli_callback 参数）"
```

---

## Task 4: CLI 浏览器授权 Provider

**Files:**
- Create: `cli/src/utils/open-browser.ts`
- Create: `cli/src/browser-auth.ts`
- Modify: `cli/src/commands/auth.ts`

- [ ] **Step 1: 创建 `cli/src/utils/open-browser.ts`**

```typescript
import { exec } from 'child_process';

/**
 * 用系统默认浏览器打开链接。
 * 失败时静默忽略：无图形环境（如纯 SSH 会话）由调用方打印链接兜底。
 */
export function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(command, () => {
    /* 忽略错误，用户可手动复制链接访问 */
  });
}
```

- [ ] **Step 2: 创建 `cli/src/browser-auth.ts`**

```typescript
import * as crypto from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';
import { getClient } from './client';
import { loadConfig, saveConfig } from './config';
import { AuthProvider } from './auth';
import { openBrowser } from './utils/open-browser';

/** 等待用户完成浏览器登录的最长时间 */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface BrowserAuthOptions {
  /** 只打印授权链接，不自动打开浏览器（本机无图形环境时使用） */
  printUrlOnly?: boolean;
  /** 回调等待超时（毫秒） */
  timeoutMs?: number;
}

/**
 * 浏览器授权登录：OAuth 授权码 + PKCE + 本机回环回调。
 *
 * 1. 生成 code_verifier / code_challenge / state
 * 2. 在 127.0.0.1 的随机端口启动回调服务器
 * 3. 打开服务端登录页（地址取自 KB_SERVER 配置），用户在页面上登录
 * 4. 浏览器登录后跳回本机回调地址并携带一次性授权码
 * 5. 用 code + code_verifier 换取 JWT 并保存到 ~/.kbconfig.json
 */
export class BrowserAuthProvider implements AuthProvider {
  constructor(private readonly options: BrowserAuthOptions = {}) {}

  async login(): Promise<string> {
    const config = loadConfig();
    if (!config.server) {
      throw new Error('未配置服务端地址，请先执行: kb config set server <url>');
    }

    const verifier = base64Url(crypto.randomBytes(48));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64Url(crypto.randomBytes(16));

    const server = http.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    }).catch(() => {
      throw new Error('无法在本机启动回调端口，请改用: kb login --print-url');
    });

    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authUrl =
      `${config.server}/login?cli_callback=1` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&state=${encodeURIComponent(state)}` +
      `&client=kb-cli`;

    console.log('\n请在浏览器中完成登录：');
    console.log(`  ${authUrl}\n`);
    if (!this.options.printUrlOnly) {
      openBrowser(authUrl);
    }

    try {
      const code = await this.waitForCode(server, state, redirectUri, this.options.timeoutMs);
      const client = getClient();
      const res = await client.post('/api/auth/cli/token', {
        code,
        code_verifier: verifier,
      });

      const token: string = res.data.access_token;
      const username: string = res.data.username || config.username || 'admin';
      const latest = loadConfig();
      latest.token = token;
      latest.username = username;
      saveConfig(latest);
      return token;
    } finally {
      server.close();
    }
  }

  /**
   * 等待浏览器回调并取出授权码。
   * state 不匹配的回调不会结束等待（防伪造回调），仅返回错误页。
   */
  private waitForCode(
    server: http.Server,
    expectedState: string,
    redirectUri: string,
    timeoutMs = CALLBACK_TIMEOUT_MS
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const finish = (error: Error | null, code?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.removeListener('request', onRequest);
        if (error) reject(error);
        else resolve(code as string);
      };

      const timer = setTimeout(
        () => finish(new Error('授权超时（5 分钟），请重新执行 kb login')),
        timeoutMs
      );

      const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        const url = new URL(req.url || '/', redirectUri);
        if (url.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
          return;
        }

        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');

        if (state !== expectedState) {
          res
            .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end('<h3>回调校验失败</h3><p>请返回终端重试。</p>');
          return;
        }
        if (!code) {
          res
            .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end('<h3>未收到授权码</h3><p>请返回终端重试。</p>');
          return;
        }

        res
          .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<h3>登录成功</h3><p>请返回终端，kb 正在完成登录。</p>');
        finish(null, code);
      };

      server.on('request', onRequest);
    });
  }
}
```

- [ ] **Step 3: 修改 `cli/src/commands/auth.ts` 的 login 命令**

将文件顶部的导入改为：

```typescript
import { Command } from 'commander';
import ora from 'ora';
import { PasswordAuthProvider, logout } from '../auth';
import { BrowserAuthProvider } from '../browser-auth';
import { loadConfig } from '../config';
import {
  printSuccess,
  printError,
  printWarning,
  printKeyValue,
} from '../utils/table';
import { resetClient, getClient } from '../client';
```

将 `login` 命令整段替换为：

```typescript
  program
    .command('login')
    .description('登录 kb-service（默认打开浏览器授权；带用户名或 -p 时走密码登录）')
    .argument('[username]', '管理员用户名；传入则走密码登录')
    .option('-u, --username <user>', '用户名（同位置参数）')
    .option(
      '-p, --password <pwd>',
      '密码（非交互登录，适合脚本；CI 场景更推荐 KB_TOKEN 环境变量）'
    )
    .option('--print-url', '仅打印授权链接，不自动打开浏览器')
    .addHelpText(
      'after',
      `
示例:
  $ kb login                       打开浏览器完成授权（推荐）
  $ kb login --print-url           只打印授权链接，手动在浏览器打开
  $ kb login admin -p secret       密码登录（脚本/CI）
  $ kb login admin                 交互式输入密码

浏览器授权说明:
  命令会在本机 127.0.0.1 的随机端口临时启动回调服务，并在浏览器打开本服务的
  登录页；登录完成后浏览器自动跳回本机完成授权，令牌只保存在你本机。

CI/CD 免登录方式（不落盘凭据）:
  $ export KB_SERVER=https://kb.example.com
  $ export KB_TOKEN=<jwt>`
    )
    .action(async (usernameArg: string | undefined, options) => {
      try {
        const usePassword =
          Boolean(options.password) || Boolean(usernameArg) || Boolean(options.username);

        if (usePassword) {
          const provider = new PasswordAuthProvider();
          await provider.login(usernameArg || options.username, options.password);
        } else {
          const provider = new BrowserAuthProvider({ printUrlOnly: options.printUrl });
          const spinner = ora('等待浏览器完成授权...').start();
          try {
            await provider.login();
          } finally {
            spinner.stop();
          }
        }

        const cfg = loadConfig();
        printSuccess(
          `登录成功！当前用户: ${cfg.username}  |  服务端: ${cfg.server}`
        );
      } catch (err: any) {
        printError(err.message || '登录失败');
        process.exit(1);
      }
    });
```

- [ ] **Step 4: 编译 CLI**

Run: `cd cli && npm run build`
Expected: 编译无错误，生成 `dist/browser-auth.js` 与 `dist/utils/open-browser.js`

- [ ] **Step 5: 提交**

```bash
git add cli/src/browser-auth.ts cli/src/utils/open-browser.ts cli/src/commands/auth.ts
git commit -m "feat(cli): kb login 默认走浏览器授权（授权码 + PKCE + 本机回调）"
```

---

## Task 5: 真实浏览器端到端验证

**Files:** 无（验证任务，不产生提交；证据记录在 PR 描述中）

- [ ] **Step 1: 启动隔离环境（后端容器 + 前端 dev 服务器）**

```bash
cd /home/zhouzheng/Desktop/kb/kb-service
docker rm -f kb-cli-auth-test >/dev/null 2>&1
docker volume rm kb-cli-files kb-cli-db kb-cli-ws >/dev/null 2>&1
docker run -d --name kb-cli-auth-test -p 8000:8000 \
  -e KB_JWT_SECRET=testsecret -e KB_ADMIN_USERNAME=admin -e KB_ADMIN_PASSWORD=admin123 \
  -e KB_STORAGE_DIR=/data/files -e KB_DB_PATH=/data/db/kb.sqlite -e KB_WORKSPACE_DIR=/data/workspaces \
  -e KB_COOKIE_SECURE=false \
  -v kb-cli-files:/data/files -v kb-cli-db:/data/db -v kb-cli-ws:/data/workspaces \
  -v /home/zhouzheng/Desktop/kb/kb-service/backend/app:/app/app \
  registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:backend-latest
sleep 6
curl -s -o /dev/null -w "backend: %{http_code}\n" http://127.0.0.1:8000/api/health
```

Expected: `backend: 200`

- [ ] **Step 2: 验证前端授权页渲染（headless Chromium）**

先生成一条真实授权链接（PKCE 参数用固定值即可，仅验证页面渲染）：

```bash
cd /home/zhouzheng/Desktop/kb/kb-service
VERIFIER=$(python3 -c "print('a'*64)")
CHALLENGE=$(python3 -c "
import base64,hashlib
print(base64.urlsafe_b64encode(hashlib.sha256(('a'*64).encode()).digest()).rstrip(b'=').decode())
")
AUTH_URL="http://127.0.0.1:8000/login?cli_callback=1&redirect_uri=http%3A%2F%2F127.0.0.1%3A51234%2Fcallback&code_challenge=$CHALLENGE&state=st-e2e&client=kb-cli"
echo "$AUTH_URL" > /tmp/kb-auth-url.txt

C=~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
"$C" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=8000 \
  --dump-dom "$AUTH_URL" > /tmp/kb-login-dom.html 2>/dev/null

grep -c "kb-cli 正在请求登录" /tmp/kb-login-dom.html
```

Expected: 输出 `1`（提示条已渲染）

> 说明：前端 dev（5173）与生产（nginx 同源）的差异不影响本页判断——授权页与 API 同源，
> 用后端容器直接托管前端产物亦可；若要在 5173 上验证，把上述 URL 的 host:port 换成 `localhost:5173`。

- [ ] **Step 3: 完整链路验证（CLI 真实运行 + 脚本扮演浏览器）**

CLI 的回调服务器与 PKCE 逻辑是本次改动的核心，必须真实运行 CLI：

```bash
cd /home/zhouzheng/Desktop/kb/kb-service
# 配置 CLI 指向隔离环境
node cli/dist/index.js config set server http://127.0.0.1:8000

# 后台启动 kb login（--print-url 便于脚本读取链接），输出重定向到日志
rm -f /tmp/kb-login-out.log
(node cli/dist/index.js login --print-url > /tmp/kb-login-out.log 2>&1 &) 
sleep 3

# 从日志中解析 CLI 生成的授权链接（含它自己的 challenge/state/回调端口）
AUTH_URL=$(grep -o 'http://127.0.0.1:8000/login?[^ ]*' /tmp/kb-login-out.log | head -1)
echo "CLI 生成的授权链接: $AUTH_URL"
```

Expected: 日志中出现授权链接，且其中的 `redirect_uri` 端口为随机高位端口

```bash
# 扮演浏览器：提交登录表单换取回调地址，再访问回调（触发 CLI 的本地服务器）
PARAMS=$(python3 -c "
import sys, urllib.parse as u
q = u.parse_qs(u.urlparse('$AUTH_URL').query)
print(q['redirect_uri'][0], q['code_challenge'][0], q['state'][0])
")
RURI=$(echo "$PARAMS" | cut -d' ' -f1)
CHAL=$(echo "$PARAMS" | cut -d' ' -f2)
ST=$(echo "$PARAMS" | cut -d' ' -f3)

RESP=$(curl -s -X POST http://127.0.0.1:8000/api/auth/cli/authorize \
  -d "username=admin" -d "password=admin123" \
  -d "redirect_uri=$RURI" -d "code_challenge=$CHAL" -d "state=$ST")
REDIRECT=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['redirect'])")

# 访问回调地址（等价于浏览器自动跳转），CLI 会在此收到授权码并换取令牌
curl -s "$REDIRECT" | grep -o "登录成功"

sleep 3
echo "--- CLI 输出 ---"
cat /tmp/kb-login-out.log | tail -6
```

Expected: 回调响应包含 `登录成功`；CLI 日志出现 `登录成功！当前用户: admin`

- [ ] **Step 4: 验证令牌确实可用**

```bash
cd /home/zhouzheng/Desktop/kb/kb-service
node cli/dist/index.js whoami
```

Expected: 输出用户名 `admin`、服务端地址，并以 `令牌有效` 结尾

- [ ] **Step 5: 反向验证（安全边界）**

```bash
# a) state 不匹配的回调不应让 CLI 完成登录（CLI 仍在等待 → 用超时兜底，此处只验证回调被拒）
#    再次启动一次 login，然后用错误 state 访问回调
rm -f /tmp/kb-login-bad.log
(node /home/zhouzheng/Desktop/kb/kb-service/cli/dist/index.js login --print-url > /tmp/kb-login-bad.log 2>&1 &)
sleep 3
AUTH_URL2=$(grep -o 'http://127.0.0.1:8000/login?[^ ]*' /tmp/kb-login-bad.log | head -1)
RURI2=$(python3 -c "
import urllib.parse as u
print(u.parse_qs(u.urlparse('$AUTH_URL2').query)['redirect_uri'][0])
")
curl -s -o /tmp/kb-bad-cb.html -w "错误 state 回调状态码: %{http_code} (期望 400)\n" "${RURI2}?code=fake&state=wrong-state"
grep -o "回调校验失败" /tmp/kb-bad-cb.html
pkill -f "kb login" 2>/dev/null || true
pkill -f "cli/dist/index.js login" 2>/dev/null || true
```

Expected: 状态码 `400`，页面含 `回调校验失败`

```bash
# b) 外域回调地址仍被服务端拒绝（防开放重定向）
VERIFIER=$(python3 -c "print('a'*64)")
CHALLENGE=$(python3 -c "
import base64,hashlib
print(base64.urlsafe_b64encode(hashlib.sha256(('a'*64).encode()).digest()).rstrip(b'=').decode())
")
curl -s -o /dev/null -w "外域回调: %{http_code} (期望 400)\n" -X POST \
  http://127.0.0.1:8000/api/auth/cli/authorize \
  -d "username=admin" -d "password=admin123" \
  -d "redirect_uri=http://evil.com/callback" -d "code_challenge=$CHALLENGE" -d "state=x"
```

Expected: `400`

- [ ] **Step 6: 回归验证（密码登录与网页登录不受影响）**

```bash
cd /home/zhouzheng/Desktop/kb/kb-service
node cli/dist/index.js login admin -p admin123
node cli/dist/index.js whoami
```

Expected: 仍能正常登录（`登录成功！当前用户: admin`）且 `令牌有效`

- [ ] **Step 7: 清理环境**

```bash
cd /home/zhouzheng/Desktop/kb/kb-service
docker rm -f kb-cli-auth-test >/dev/null 2>&1
docker volume rm kb-cli-files kb-cli-db kb-cli-ws >/dev/null 2>&1
rm -f /tmp/kb-auth-url.txt /tmp/kb-login-dom.html /tmp/kb-login-out.log /tmp/kb-login-bad.log /tmp/kb-bad-cb.html
# 恢复本机 CLI 配置（避免指向测试环境）
node cli/dist/index.js config set server "$(git config --get remote.origin.url >/dev/null 2>&1 && echo '')" 2>/dev/null || true
echo "清理完成（如本机 CLI 配置被改动，请手动执行: kb config set server <你的服务地址>）"
```

---

## Task 6: 文档更新

**Files:**
- Modify: `README.md`（CLI 章节的登录说明）
- Modify: `cli/README.md`

- [ ] **Step 1: 更新 `cli/README.md` 的登录章节**

把其中描述 `kb login` 用法的段落替换为：

```markdown
### 登录

默认使用**浏览器授权**（无需在终端输入密码）：

```bash
kb config set server http://<你的服务地址>:8000
kb login
```

命令会在浏览器打开服务登录页，登录完成后终端自动完成登录（令牌保存在 `~/.kbconfig.json`）。
本机无图形环境（如纯 SSH）时可只打印链接、手动在能上网的设备打开：

```bash
kb login --print-url
```

脚本与 CI 场景仍可用密码登录或环境变量：

```bash
kb login admin -p <密码>            # 密码登录
export KB_SERVER=http://... KB_TOKEN=<jwt>   # 完全免登录（推荐用于 CI）
```
```

- [ ] **Step 2: 更新根 `README.md` 中 CLI 的登录描述**

找到 CLI 章节里描述 `kb login` 的一句（形如"使用 `kb login` 登录"或含密码字样），替换为：

```markdown
- 登录：`kb login` 默认打开浏览器完成授权（授权码 + PKCE），也支持 `kb login <用户名> -p <密码>` 与 `KB_TOKEN` 环境变量
```

- [ ] **Step 3: 提交**

```bash
git add README.md cli/README.md
git commit -m "docs: 说明 CLI 浏览器授权登录用法"
```

---

## Task 7: 推送并存 PR

**Files:** 无（交付流程）

- [ ] **Step 1: 确认分支与改动清单**

```bash
git status -sb
git log --oneline main..HEAD
```

Expected: 当前分支为 `feat/cli-browser-login`，包含 Task 1-6 的提交

- [ ] **Step 2: 推送分支**

```bash
git push -u origin feat/cli-browser-login
```

- [ ] **Step 3: 创建 PR**

```bash
gh pr create --base main --head feat/cli-browser-login \
  --title "feat(cli): kb login 支持浏览器授权登录（授权码 + PKCE）" \
  --body "## 需求

`kb login` 默认改为**浏览器授权**：命令发起后在浏览器打开服务登录页，用户完成登录后终端自动登录成功，无需在终端输入密码。

## 方案

OAuth 授权码 + PKCE + 本机回环回调（`gh auth login` 同款形态）：

- 浏览器打开的是**服务登录页**（地址取自 KB_SERVER 配置）
- 登录成功后浏览器自动跳回 CLI 在本机 127.0.0.1 随机端口开启的回调服务
- CLI 用一次性授权码 + code_verifier 换取 JWT（**令牌不经过 URL**）

设计文档：\`docs/superpowers/specs/2026-09-22-cli-browser-login-design.md\`

## 改动

- 后端：新增 \`/auth/cli/authorize\`（签发一次性授权码）与 \`/auth/cli/token\`（换取 JWT），授权码存进程内存（单 worker）、5 分钟 TTL、用过即废；回调地址白名单仅允许本机回环地址
- 前端：登录页识别 \`cli_callback\` 参数后展示「kb-cli 正在请求登录」提示条并走授权分支（无参数时行为不变）
- CLI：新增 \`BrowserAuthProvider\`；\`kb login\` 默认走浏览器，保留 \`-p\` 密码登录，新增 \`--print-url\`
- 文档：README 与 cli/README 说明新登录方式

## 兼容性

- \`kb login -p\`、\`KB_TOKEN\` 环境变量、网页端登录均不受影响
- 既有端点未改动契约

## 测试

见下方评论（Task 5 的端到端验证证据）"
```

Expected: 输出 PR 链接

- [ ] **Step 4: 记录验证证据到 PR**

把 Task 5 中各步骤的实际输出（提示条渲染计数、CLI 登录成功日志、whoami 结果、反向用例状态码）整理为一条 PR 评论：

```bash
gh pr comment <PR号> --body "## 端到端验证结果

| 验证项 | 命令/方式 | 结果 |
|--------|-----------|------|
| 授权页渲染 | headless Chromium dump-dom | 提示条出现 1 次 ✅ |
| CLI 完整链路 | 真实 \`kb login\` + 脚本扮演浏览器 | 终端输出「登录成功！当前用户: admin」✅ |
| 令牌可用 | \`kb whoami\` | 「令牌有效」✅ |
| state 不匹配 | 回调带错误 state | 400 + 「回调校验失败」✅ |
| 外域回调 | redirect_uri=http://evil.com | 400 ✅ |
| 回归：密码登录 | \`kb login admin -p\` | 登录成功 ✅ |"
```

- [ ] **Step 5: 合并前确认**

合并需用户确认。合并后 CI 会自动部署（服务器本地构建），部署完成后建议用真实浏览器再走一遍 \`kb login\`（对生产地址）。

---

## 自检记录

- **Spec 覆盖**：设计文档 §3（方案选型）→ Task 1-4 实现；§4.2 后端两端点 → Task 2；§4.3 前端 → Task 3；§4.4 CLI → Task 4；§4.5 安全 → Task 1（白名单/PKCE/一次性）+ Task 5 Step 5（反向验证）；§4.6 错误处理 → Task 4 代码内的错误分支；§6 测试计划 → Task 1/2/5；§8 文档 → Task 6
- **占位符扫描**：无 TBD/TODO；所有代码步骤均给出完整可粘贴代码
- **类型一致性**：`issue_code / consume_code / is_allowed_redirect_uri / is_valid_challenge / reset_store` 在 Task 1 定义，Task 2 按同名调用；`BrowserAuthProvider` 的 `login()` 与 `AuthProvider` 接口签名一致；`ApiResponse` 字段 `access_token / token_type / username` 在 Task 2 返回、Task 4 读取一致
- **与设计的差异（已确认合理）**：`/auth/cli/token` 额外返回 `username`，使 CLI 无需再发请求即可保存用户名（设计文档 §4.4 要求保存 username）
