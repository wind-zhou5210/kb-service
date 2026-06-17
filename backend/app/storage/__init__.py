"""存储适配器：本地文件系统 + 内容寻址（sha1 去重）。

抽象为 StorageBackend Protocol，便于后续替换为 S3 / MinIO。
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Protocol

from app.core.config import settings


class StorageBackend(Protocol):
    async def save(self, data: bytes, ext: str) -> tuple[str, int]:
        """保存内容，返回 (sha1, size)。相同内容只存一份。"""
        ...

    async def read(self, sha1: str) -> bytes:
        ...

    async def delete(self, sha1: str) -> None:
        ...


class LocalStorage:
    """本地文件系统实现，按 sha1 分目录存储避免单目录文件过多。"""

    def __init__(self, base_dir: Path = settings.storage_dir) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, sha1: str, ext: str = "") -> Path:
        # 用 sha1 前两位做一级目录分片
        sub = self.base_dir / sha1[:2]
        sub.mkdir(parents=True, exist_ok=True)
        return sub / f"{sha1}{ext}"

    async def save(self, data: bytes, ext: str) -> tuple[str, int]:
        sha1 = hashlib.sha1(data).hexdigest()
        size = len(data)
        path = self._path(sha1, ext)
        if not path.exists():
            # 原子写：先写临时文件再 rename
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)
        return sha1, size

    async def read(self, sha1: str) -> bytes:
        # 需要找到对应 ext 的文件；MVP 遍历两个分片目录内的可能文件
        for ext in (".md", ".html", ".htm"):
            path = self._path(sha1, ext)
            if path.exists():
                return path.read_bytes()
        raise FileNotFoundError(f"物理文件不存在: {sha1}")

    async def delete(self, sha1: str) -> None:
        for ext in (".md", ".html", ".htm"):
            path = self._path(sha1, ext)
            if path.exists():
                path.unlink(missing_ok=True)
                return


# 单例
storage: LocalStorage = LocalStorage()
