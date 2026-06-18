"""FastAPI 主应用入口。"""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api import auth, collections, documents, search
from app.core.config import settings
from app.core.database import init_db

# 前端构建产物目录（同源托管，避免跨域）
FRONTEND_DIST = Path(os.environ.get("KB_FRONTEND_DIR", "/workspace/frontend/dist"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

prefix = settings.api_prefix
app.include_router(auth.router, prefix=prefix)
app.include_router(collections.router, prefix=prefix)
app.include_router(documents.router, prefix=prefix)
app.include_router(search.router, prefix=prefix)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ---- 前端静态文件托管 + SPA fallback ----
# 必须放在所有 /api 路由之后：非 api 请求落到此处。
# 命中真实静态文件则返回文件，否则返回 index.html（供 BrowserRouter 前端路由使用）。
if FRONTEND_DIST.is_dir():
    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        # 兜底防护：api 路径不应到这里（已被上面的路由匹配）；若到达则 404
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        # SPA fallback：所有未匹配的路径返回 index.html
        index = FRONTEND_DIST / "index.html"
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Frontend not built")
else:
    @app.get("/")
    async def root():
        return {"service": settings.app_name, "docs": "/docs", "hint": "前端未构建，仅 API 可用"}
