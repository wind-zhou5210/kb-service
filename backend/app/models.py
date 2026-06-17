"""数据模型：Collection / Document / FileBlob。

关系：Collection 1—N Document N—1 FileBlob（多文档共享同一物理文件，内容寻址去重）。
"""
from datetime import datetime
from sqlmodel import Field, SQLModel


class Collection(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str | None = None
    cover: str | None = None
    sort_order: int = 0
    share_token: str | None = Field(default=None, index=True)  # 只读分享令牌
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FileBlob(SQLModel, table=True):
    """物理文件（内容寻址，按 sha1 去重）。"""
    sha1: str = Field(primary_key=True)
    ext: str  # .md / .html
    size: int
    ref_count: int = 0  # 引用计数，归零方可删物理文件


class Document(SQLModel, table=True):
    """逻辑文件（用户视角的文档，可重命名、打标签）。"""
    id: int | None = Field(default=None, primary_key=True)
    collection_id: int = Field(foreign_key="collection.id", index=True)
    title: str = Field(index=True)         # 显示名
    filename: str                          # 原始文件名
    ext: str                               # .md / .html
    content_sha1: str = Field(foreign_key="fileblob.sha1", index=True)
    size: int
    tags: str | None = None                # JSON 字符串，MVP 简化为逗号分隔
    note: str | None = None
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
