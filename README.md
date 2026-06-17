# 文件知识管理服务

自托管的文件型知识库：支持创建知识集合、上传 Markdown / HTML 文件，并在线安全渲染。

核心特点：
- **Markdown 渲染**：`react-markdown` + remark/rehype 插件（GFM、代码高亮、KaTeX 公式、锚点目录），默认禁用原始 HTML，杜绝 XSS。
- **HTML 渲染**：`iframe sandbox`（仅 `allow-scripts`）浏览器原生隔离，保留原貌脚本与样式的同时杜绝逃逸；服务端 bleach 二次净化高危事件属性；postMessage 上报高度实现自适应。
- **内容寻址存储**：文件按 sha1 去重，引用计数自动清理。
- **技术栈**：FastAPI（asyncio）+ SQLite + React 18 + Ant Design 5。

## 目录结构

```
.
├─ backend/              FastAPI 后端
│  ├─ app/
│  │  ├─ api/            路由（auth / collections / documents）
│  │  ├─ core/           配置 / 数据库 / 鉴权
│  │  ├─ services/       渲染服务（HTML 净化 + 高度脚本注入）
│  │  ├─ storage/        内容寻址存储适配器
│  │  ├─ models.py       数据模型
│  │  └─ main.py         入口
│  ├─ requirements.txt
│  └─ Dockerfile
├─ frontend/             React 前端
│  ├─ src/
│  │  ├─ pages/          Login / Collections / CollectionDetail
│  │  ├─ components/     MarkdownViewer / HtmlSandbox / UploadModal
│  │  ├─ api/            axios 封装
│  │  └─ store/          zustand
│  └─ Dockerfile
├─ docker-compose.yml
└─ 文件知识管理服务-架构方案.md
```

## 快速开始（Docker Compose）

```bash
# 1. 修改默认密码（编辑 docker-compose.yml 里的 KB_ADMIN_PASSWORD / KB_JWT_SECRET）
# 2. 启动
docker compose up -d --build
# 3. 访问 http://localhost:8000 ，默认账号 admin / admin123
```

数据持久化在 `./data/`（原文 + SQLite）。

## 本地开发

### 后端

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 按需修改
uvicorn app.main:app --reload --port 8000
# API 文档：http://localhost:8000/docs
```

### 前端

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173 ，/api 自动代理到 8000
```

> 注意：本环境的 Node 被 `NODE_OPTIONS` 预加载了一个损坏的 shim，若遇 `genie-safe-delete.cjs` 报错，执行命令前加 `NODE_OPTIONS=` 清空即可。

## 安全要点

| 通道 | 防护 |
|---|---|
| Markdown | react-markdown 默认不渲染原始 HTML 标签；**切勿引入 rehype-raw** |
| HTML | iframe `sandbox="allow-scripts"`（绝不同时加 `allow-same-origin`）+ 服务端 bleach 净化 on* 事件属性 + 注入高度上报脚本 |
| 上传 | 扩展名白名单 `.md/.html/.htm` + 大小限制 |
| API | JWT 鉴权 + 集合归属校验 |

详见 `文件知识管理服务-架构方案.md` 第七章。

## 路线图

- [x] MVP：集合 / 文件 CRUD + 上传 + Markdown / HTML 渲染 + JWT 登录
- [ ] 全文检索（SQLite FTS5）、标签、拖拽排序、只读分享链接
- [ ] 在线 Markdown 编辑器、版本历史、S3 存储
