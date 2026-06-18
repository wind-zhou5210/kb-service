"""全文检索路由：基于 SQLite FTS5。"""
import re
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import CurrentUser

router = APIRouter(prefix="/search", tags=["search"])


def _build_fts_query(q: str) -> str:
    """将用户输入转为 FTS5 MATCH 表达式：保留词字符与 CJK，末词加前缀通配。"""
    clean = re.sub(r'[^\w\s\u4e00-\u9fff]', ' ', q).strip()
    if not clean:
        return ''
    words = clean.split()
    if words:
        words[-1] = words[-1] + '*'
    return ' '.join(words)


@router.get("")
async def search(
    q: Annotated[str, Query(min_length=1)],
    session: Annotated[AsyncSession, Depends(get_session)],
    user: CurrentUser,
):
    fts_q = _build_fts_query(q)
    if not fts_q:
        return []

    stmt = text("""
        SELECT
            d.id           AS document_id,
            d.title        AS title,
            d.ext          AS ext,
            d.collection_id AS collection_id,
            c.name         AS collection_name,
            snippet(fts_index, 3, '<<', '>>', '...', 24) AS snippet
        FROM fts_index
        JOIN document d ON d.id = fts_index.document_id
        JOIN collection c ON c.id = d.collection_id
        WHERE fts_index MATCH :q
        ORDER BY rank
        LIMIT 20
    """)
    result = await session.execute(stmt, {"q": fts_q})
    rows = result.all()
    return [
        {
            "document_id": row.document_id,
            "title": row.title,
            "ext": row.ext,
            "collection_id": row.collection_id,
            "collection_name": row.collection_name,
            "snippet": row.snippet,
        }
        for row in rows
    ]
