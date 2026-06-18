# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

文件知识管理服务 — 自托管文件型知识库，支持上传 Markdown/HTML 文件并在线安全渲染。

## 构建与运行

```bash
# 生产部署（推荐）
docker compose up -d --build

# 本地后端开发
cd backend
cp .env.example .env
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 本地前端开发
cd frontend
npm install
npm run dev           # localhost:5173，/api 代理到 localhost:8000
```

项目无 Makefile，无单元测试（MVP 阶段）。

## 架构

```
React 18 SPA (Vite + TS)  <-->  FastAPI (asyncio)  <-->  SQLite + 文件系统
        前端                        后端 API
```

- **后端** `backend/`：Python FastAPI，REST JSON API。入口 `app/main.py`。
- **前端** `frontend/`：React 18 + Vite + TypeScript + Ant Design v5。入口 `src/main.tsx`。
- **存储**：文件内容按 SHA1 寻址存储，引用计数管理。`StorageBackend` Protocol 可替换为 S3。
- **数据库**：SQLite（aiosqlite 异步驱动），含 FTS5 全文检索虚拟表。

## 后端结构

```
app/
  main.py               # FastAPI 应用入口、lifespan、CORS、路由挂载
  models.py              # SQLModel ORM：Collection, Document, FileBlob
  api/
    auth.py              # POST /api/auth/login（JWT 签发，明文密码比较）
    collections.py       # /api/collections CRUD + 分享令牌
    documents.py         # 文档 CRUD、上传、原始内容获取、FTS 同步
    search.py            # GET /api/search?q=（FTS5 MATCH 全文检索）
    share.py             # GET /api/share/{token}（无需认证的公共只读访问）
  core/
    config.py            # pydantic-settings，KB_ 前缀环境变量
    database.py          # 异步 SQLAlchemy 引擎、AsyncSession、init_db()
    security.py          # JWT 创建/验证、get_current_user 依赖注入
  services/
    render.py            # HTML bleach 净化 + iframe srcdoc 高度报告脚本注入
  storage/
    __init__.py          # LocalStorage 实现，SHA1 前缀分片目录
```

## 前端结构

```
src/
  main.tsx               # 入口：ConfigProvider(antd zhCN) + BrowserRouter
  App.tsx                # 5 条路由 + RequireAuth 守卫
  api/client.ts          # Axios 实例、请求/响应拦截器、全部 API 方法
  store/auth.ts          # Zustand store（token + localStorage 持久化）
  pages/
    Login.tsx            # 登录页
    Collections.tsx      # 集合网格（dnd-kit 拖拽排序）
    CollectionDetail.tsx # 文件列表 + Markdown/HTML 查看器
    Search.tsx           # FTS 搜索结果页
    SharedCollection.tsx # 公开分享只读视图
  components/
    AppLayout.tsx        # 顶栏 + 搜索 + 用户菜单
    HtmlSandbox.tsx      # iframe sandbox="allow-scripts"（安全核心）
    MarkdownViewer.tsx   # react-markdown + GFM/KaTeX/高亮/锚点
    DocToc.tsx           # 目录侧栏（IntersectionObserver 滚动 spy）
    UploadModal.tsx      # 拖拽上传弹窗
```

## 关键安全机制

1. **Markdown**：`react-markdown` 无 `rehype-raw`，不渲染原始 HTML。
2. **HTML 渲染**：双重防御 — (a) 后端 `render.py` bleach 净化（剥离所有 `on*` 事件属性），(b) 前端 `HtmlSandbox.tsx` iframe `sandbox="allow-scripts"`（绝不 `allow-same-origin`）。
3. **上传**：扩展名白名单（`.md/.html/.htm`），10MB 上限，SHA1 内容去重。

## API 约定

- `GET/POST/PATCH/DELETE` REST 风格，标准状态码
- 认证：除 `/api/auth/login` 和 `/api/share/{token}` 外，全部需要 Bearer JWT
- JWT 通过 `python-jose` HS256 签发，默认 7 天过期
- 402/404/401/413 错误返回 `{"detail": "message"}`
