"""CLI 浏览器授权登录：授权码存储、PKCE 校验、回调地址白名单。

授权码为一次性凭据，保存在进程内存中。依据：Dockerfile 中 uvicorn 为单 worker
部署，进程内状态一致；进程重启导致授权码失效时，用户重新执行 kb login 即可。
若将来改为多 worker，需改用共享存储（见设计文档「风险与缓解」）。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlparse

# 授权码有效期：5 分钟（用户完成登录的合理窗口）
CODE_TTL_SECONDS = 300

# PKCE 规范（RFC 7636）规定的 code_challenge 长度范围
_MIN_CHALLENGE_LEN = 43
_MAX_CHALLENGE_LEN = 128

# PKCE code_challenge 必须为 base64url 字符集（RFC 7636）：
# 字符集校验是必需的——hmac.compare_digest 只能比较 ASCII 字符串，
# 非 ASCII 的 challenge 会让后续校验抛 TypeError
_CHALLENGE_PATTERN = re.compile(
    rf"[A-Za-z0-9_\-]{{{_MIN_CHALLENGE_LEN},{_MAX_CHALLENGE_LEN}}}"
)


@dataclass
class _AuthCode:
    """一条待消费的授权码及其绑定信息。"""

    username: str
    code_challenge: str
    # 记录签发时的回调地址，供后续按需做绑定校验（当前端点未复校验，仅留存）
    redirect_uri: str
    expires_at: float


_codes: dict[str, _AuthCode] = {}


def is_allowed_redirect_uri(uri: str) -> bool:
    """校验回调地址是否为本机回环地址（http + 显式端口）。

    白名单用于阻断开放重定向：授权码只允许回传到用户本机，
    不接受任何外部域名或局域网地址。对畸形输入一律返回 False（绝不抛异常），
    因为该函数直接校验外部输入的参数。
    """
    try:
        parsed = urlparse(uri)
        # 端口越界（如 :99999）或非数字端口会在访问 .port 时抛 ValueError，
        # 必须与 urlparse 一并捕获：畸形输入应被拒绝，而不是让调用方崩成 500
        port = parsed.port
    except ValueError:
        return False

    # netloc 中不允许出现 userinfo(@) 或反斜杠：Python 的 urlparse 按最后一个 @
    # 取 host，而浏览器会把 \ 规范化为 /，二者对
    # http://evil.com\@127.0.0.1:PORT/cb 的解析结果不同——浏览器认为 host 是
    # evil.com，会使白名单被绕过并把授权码泄露给攻击者
    if "@" in parsed.netloc or "\\" in parsed.netloc:
        return False

    if parsed.scheme != "http":
        return False
    if parsed.hostname not in ("127.0.0.1", "localhost"):
        return False
    # 带 fragment 时（含末尾空 #），后续拼接的 ?code= 会落在 # 之后而浏览器
    # 从不发送，CLI 将收不到授权码并静默等到超时，故直接拒绝。
    # 用原字符串判断：parsed.fragment 为空串时无法区分 "callback#" 这种形态
    if "#" in uri:
        return False
    # 必须为有效端口：CLI 使用系统分配的随机高位端口（0 不可连接）
    return port is not None and port > 0


def is_valid_challenge(challenge: str) -> bool:
    """校验 PKCE code_challenge：base64url 字符集且长度在 43-128 之间（RFC 7636）。"""
    return bool(_CHALLENGE_PATTERN.fullmatch(challenge))


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
    对畸形 verifier（如非 ASCII）返回 None 而非抛异常。
    """
    _purge_expired()
    entry = _codes.get(code)
    if entry is None:
        return None
    if time.time() > entry.expires_at:
        _codes.pop(code, None)
        return None
    # 非 ASCII 无法参与 S256 计算：直接判失败，避免抛 UnicodeEncodeError
    if not code_verifier.isascii():
        return None
    # challenge 侧同理：compare_digest 无法比较非 ASCII 字符串
    # （正常签发路径已由 is_valid_challenge 拦下，此处为防御性兜底）
    if not entry.code_challenge.isascii():
        return None
    # 常量时间比较（S256 输出为 base64url 定长串）
    if not hmac.compare_digest(_s256(code_verifier), entry.code_challenge):
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
