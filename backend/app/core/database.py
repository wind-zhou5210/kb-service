"""数据库引擎与异步 session 工厂。"""
from collections.abc import AsyncGenerator
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

engine: AsyncEngine = create_async_engine(
    settings.db_url,
    echo=False,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def init_db() -> None:
    """启动时建表。MVP 用 SQLModel.metadata 建表，生产建议用 Alembic 迁移。"""
    # 确保模型已导入，metadata 才会被填充
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        # 迁移：Document 加 share_token 列（已有数据库兼容）
        from sqlalchemy import text
        cols = (await conn.execute(text("PRAGMA table_info(document)"))).fetchall()
        col_names = [c[1] for c in cols]
        if "share_token" not in col_names:
            await conn.execute(text("ALTER TABLE document ADD COLUMN share_token TEXT"))
        # 开启 WAL，提升 SQLite 并发读性能
        await conn.execute(__import__("sqlalchemy").text("PRAGMA journal_mode=WAL"))
        # FTS5 全文索引虚表
        await conn.execute(__import__("sqlalchemy").text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
                document_id UNINDEXED,
                title,
                collection_name,
                body_text
            )
        """))


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
