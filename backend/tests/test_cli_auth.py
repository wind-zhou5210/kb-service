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

    # 3b) 非 ASCII verifier：返回 None 而非抛 UnicodeEncodeError
    cli_auth.reset_store()
    code = cli_auth.issue_code("admin", challenge, redirect)
    try:
        non_ascii_result = cli_auth.consume_code(code, "中文verifier")
        non_ascii_ok = non_ascii_result is None
    except Exception as exc:  # 抛异常即为缺陷
        non_ascii_ok = False
        print(f"    （异常: {exc!r}）")
    check("非 ASCII verifier 返回 None 且不抛异常", non_ascii_ok)
    check("非 ASCII 失败后仍可用正确 verifier 消费",
          cli_auth.consume_code(code, verifier) == "admin")

    # 3c) 非 ASCII challenge：消费时不得抛异常
    cli_auth.reset_store()
    code = cli_auth.issue_code("admin", "中" * 43, redirect)
    try:
        ch_result = cli_auth.consume_code(code, verifier)
        ch_ok = ch_result is None
    except Exception as exc:  # 抛异常即为缺陷
        ch_ok = False
        print(f"    （异常: {exc!r}）")
    check("非 ASCII challenge 不抛异常且返回 None", ch_ok)

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
    check("拒绝端口越界", not cli_auth.is_allowed_redirect_uri("http://127.0.0.1:99999/callback"))
    check("拒绝非数字端口", not cli_auth.is_allowed_redirect_uri("http://127.0.0.1:abc/callback"))
    check("拒绝反斜杠混淆",
          not cli_auth.is_allowed_redirect_uri("http://evil.com\\@127.0.0.1:51234/callback"))
    check("拒绝 userinfo 形态",
          not cli_auth.is_allowed_redirect_uri("http://user@127.0.0.1:51234/callback"))
    check("拒绝 fragment",
          not cli_auth.is_allowed_redirect_uri("http://127.0.0.1:51234/callback#x"))
    check("拒绝端口 0", not cli_auth.is_allowed_redirect_uri("http://127.0.0.1:0/callback"))
    check("拒绝空串", not cli_auth.is_allowed_redirect_uri(""))
    check("拒绝末尾空 fragment",
          not cli_auth.is_allowed_redirect_uri("http://127.0.0.1:51234/callback#"))

    # 7) code_challenge 格式校验（PKCE 规定 43-128 字符）
    check("接受 43 字符 challenge", cli_auth.is_valid_challenge("x" * 43))
    check("接受 128 字符 challenge", cli_auth.is_valid_challenge("x" * 128))
    check("拒绝 42 字符 challenge", not cli_auth.is_valid_challenge("x" * 42))
    check("拒绝 129 字符 challenge", not cli_auth.is_valid_challenge("x" * 129))
    check("拒绝非 ASCII challenge", not cli_auth.is_valid_challenge("中" * 43))
    check("拒绝含空格 challenge", not cli_auth.is_valid_challenge("a" * 42 + " "))
    check("拒绝含加号 challenge", not cli_auth.is_valid_challenge("a" * 42 + "+"))

    print()
    if failures:
        print(f"失败 {len(failures)} 项: {', '.join(failures)}")
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
