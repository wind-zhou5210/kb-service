# 文件知识管理服务

自托管的文件型知识库：支持创建**知识集合**与**工作空间**，上传 Markdown / HTML 文件，并在线安全渲染。提供 Web 界面和命令行工具两种使用方式。

界面采用 **「工程图纸·规格单」** 视觉世界：暖纸墨阶 + 靛蓝制图墨 + 制图语言（图号标题栏、尺寸标注、注册标记、图纸网格、注释气泡），暗色为"夜间制图页"。设计系统记录于 [DESIGN.md](DESIGN.md)，产品档案见 [PRODUCT.md](PRODUCT.md)。

核心特点：
- **Markdown 渲染**：`react-markdown` + remark/rehype 插件（GFM、代码高亮、KaTeX 公式、锚点目录），默认禁用原始 HTML，杜绝 XSS。
- **HTML 渲染**：`iframe sandbox`（仅 `allow-scripts`）浏览器原生隔离，保留原貌脚本与样式的同时杜绝逃逸；服务端 bleach 二次净化高危事件属性；postMessage 上报高度实现自适应；带制图框架与"净化隔离"规格条。
- **内容寻址存储**：文件按 sha1 去重，引用计数自动清理。
- **工作空间**：按目录结构组织文件，支持 zip 整体上传、单个添加/替换/删除、目录树预览。
- **知识入口**：首页"最近阅读"（本地记录集合文档 + 工作空间文件），点击继续阅读并**恢复上次滚动位置**。
- **阅读体验**：阅读进度条、切换文档回到顶部、全屏模式。
- **版本历史**：文档多版本查看（应用内渲染）/ 恢复 / 删除。
- **组织整理**：标签、备注、集合卡片与文档列表拖拽排序（防抖批量保存 + 可撤销）。
- **暗色 / 亮色主题**：可切换、跟随系统偏好、首屏防闪。
- **CLI 工具**：`kb` 命令行，终端完成上传、搜索、管理，支持 JSON 输出。`npm install -g kb-service-cli`。
- **技术栈**：FastAPI（asyncio）+ SQLite + React 18 + Ant Design 5 + TypeScript CLI。

## 目录结构

```
.
├── backend/              FastAPI 后端
│   ├── app/
│   │   ├── api/            路由（auth / collections / documents / doc_share / search / share / workspaces）
│   │   ├── core/           配置 / 数据库 / 鉴权
│   │   ├── services/       渲染服务（HTML 净化 + 高度脚本注入）
│   │   ├── storage/        内容寻址存储适配器
│   │   ├── models.py       数据模型
│   │   └── main.py         入口
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/             React 前端
│   ├── public/fonts/       自托管 OFL 字体（IBM Plex Sans / JetBrains Mono）
│   ├── src/
│   │   ├── pages/          Login / Collections / CollectionDetail / Search / Workspaces / WorkspaceDetail / Shared*
│   │   ├── components/     MarkdownViewer / HtmlSandbox / DocToc / DocListItem / CollectionCard / WorkspaceTree / VersionHistoryModal / UploadModal / EmptyState / SubNav / Breadcrumbs
│   │   ├── api/            axios 封装
│   │   ├── store/          zustand（auth / collection / workspace / theme）
│   │   ├── utils/          format / clipboard / recent（最近阅读）
│   │   └── hooks/          useMediaQuery
│   └── Dockerfile
├── cli/                  kb 命令行工具
│   ├── src/
│   │   ├── commands/       auth / config / collection / document / share
│   │   └── utils/          table / format / prompt
│   ├── package.json
│   └── README.md
├── .github/workflows/     CI/CD 自动部署
│   └── deploy.yml
├── docs/                 设计文档
│   ├── plans/             实现计划
│   └── cicd-solutions.md  CI/CD 方案调研
├── specs/                需求规范
│   ├── 001-doc-fullscreen-and-share/
│   ├── 002-kb-cli/
│   └── 003-cicd-acr-deploy/
├── PRODUCT.md            产品档案（impeccable init）
├── DESIGN.md             设计系统记录（impeccable document）
├── CLAUDE.md             Claude Code 项目指引
├── docker-compose.yml        本地开发 compose
├── docker-compose.prod.yml   生产部署 compose（ACR 镜像）
├── deploy.sh                 一键部署脚本
├── .env.example              环境变量模板
```

## 快速开始

### 本地开发部署

```bash
# 本地构建并启动（在服务器上直接构建镜像）
docker compose up -d --build
# 访问 http://localhost:8000 ，默认账号 admin / admin123
```

### 生产环境部署（推荐）

```bash
# 一键部署：自动生成 JWT 密钥、从阿里云 ACR 拉取预构建镜像
./deploy.sh
```

数据持久化在 `./data/`（原文 + SQLite）。环境变量模板见 `.env.example`。

### CI/CD 自动部署

push 到 `main` 分支时，GitHub Actions 自动执行：
1. 前端构建校验 + 后端语法检查
2. Docker 构建前后端镜像，推送到阿里云 ACR
3. SSH 到服务器拉取最新镜像并重启服务

详见 [CI/CD 部署文档](docs/cicd-solutions.md)，[实施计划](docs/plans/2026-06-23-cicd-acr-deploy.md)。

## CLI 工具

```bash
# 安装
npm install -g kb-service-cli

# 快速上手
kb config set server https://kb.example.com
kb login admin
kb push ./doc.md -c 1
kb search "关键词"
```

支持 17 条命令覆盖全部操作，详见 [cli/README.md](cli/README.md)。

## 本地开发

### 后端

系统 Python 可能过旧（本机为 3.7，无法运行 FastAPI 依赖），推荐用 conda 建 Python 3.11 环境：

```bash
conda create -n kb python=3.11 -y
conda activate kb
cd backend
pip install -r requirements.txt
cp .env.example .env      # 修改 KB_JWT_SECRET 与本地存储路径（KB_STORAGE_DIR / KB_DB_PATH / KB_WORKSPACE_DIR）
uvicorn app.main:app --reload --port 8000
# API 文档：http://localhost:8000/docs
```

### 前端

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173 ，/api 自动代理到 8000
```

> **inotify 限制提示**：低配 Linux 上 `fs.inotify.max_user_watches` 默认 8192，Vite 文件监视可能触发 ENOSPC 崩溃。
> 永久修复：`sudo sysctl fs.inotify.max_user_watches=524288`（并写入 `/etc/sysctl.d/`）。
> 临时变通：`VITE_USE_POLLING=1 npm run dev`（改用轮询，CPU 略高）。

### CLI

```bash
cd cli
npm install
npm run build              # 编译 TypeScript
npm run start -- config get  # 运行命令
node dist/index.js --help    # 直接运行
```

> 注意：本环境的 Node 被 `NODE_OPTIONS` 预加载了一个损坏的 shim，若遇 `genie-safe-delete.cjs` 报错，执行命令前加 `NODE_OPTIONS=` 清空即可。

## 安全要点

| 通道 | 防护 |
|---|---|
| Markdown | react-markdown 默认不渲染原始 HTML 标签；**切勿引入 rehype-raw** |
| HTML | iframe `sandbox="allow-scripts"`（绝不同时加 `allow-same-origin`）+ 服务端 bleach 净化 on* 事件属性 + 注入高度上报脚本 |
| 上传 | 扩展名白名单 `.md/.html/.htm` + 大小限制 |
| API | JWT 鉴权 + 集合归属校验 |
| CLI | 凭据存储在 `~/.kbconfig.json`，密码输入不回显 |

详见 `文件知识管理服务-架构方案.md` 第七章。

## 路线图

- [x] MVP：集合 / 文件 CRUD + 上传 + Markdown / HTML 渲染 + JWT 登录
- [x] 全文检索（SQLite FTS5）、标签、拖拽排序、只读分享链接、文档全屏模式
- [x] CLI 命令行工具（npm 发布 `kb-service-cli`）
- [x] CI/CD 自动化部署（GitHub Actions + 阿里云 ACR）
- [x] 文档移动（集合间迁移）
- [x] 重复文件上传校验（SHA1 去重提示）
- [x] 工作空间（目录树 + zip 上传）
- [x] 版本历史、最近阅读、阅读进度、暗色主题
- [x] 前端 UI 全面重设计（工程图纸·规格单视觉世界）
- [ ] 语雀文档批量导出迁移工具
- [ ] 登录系统升级（手机验证码登录）
- [ ] CI/CD 增加自动化测试 step
- [ ] 引入向量知识库（ChromaDB）
- [ ] RAG 化改造（语义检索 + LLM 对话）
- [ ] CLI 工具 OAuth2 方式接入
- [ ] 后端读接口鉴权（未登录仅可访问分享文档）
