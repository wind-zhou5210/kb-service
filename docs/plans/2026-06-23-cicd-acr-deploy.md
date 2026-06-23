# kb-service CI/CD 自动化部署 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 GitHub Actions + 阿里云 ACR 自动构建推送 + 服务器拉取部署的完整 CI/CD 流程

**Architecture:** GitHub Actions 在 push to main 时自动触发，完成前端构建校验、后端语法校验、Docker 镜像构建推送（ACR），然后 SSH 到服务器执行 `docker compose pull && up -d`。构建和部署分离，镜像版本可追溯、可回滚。

**Tech Stack:** GitHub Actions, Docker Buildx, 阿里云 ACR (registry.cn-hangzhou.aliyuncs.com), SSH

**Prerequisites（需人工完成，不在本计划中）:**
- 阿里云 ACR 命名空间 `wind-zhou` 已存在
- 服务器已 `docker login` 到 ACR
- GitHub Secrets 已配置：`ACR_USERNAME`, `ACR_PASSWORD`, `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_KEY`

---

### Task 1: GitHub Actions Deploy Workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**目的:** 定义自动化部署的完整 CI/CD 流程

**Step 1: 创建目录和 workflow 文件**

```bash
mkdir -p .github/workflows
```

**Step 2: 编写 deploy.yml**

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: registry.cn-hangzhou.aliyuncs.com
  IMAGE: registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      # ===== 阶段 1: 代码拉取 =====
      - name: Checkout
        uses: actions/checkout@v4

      # ===== 阶段 2: 前置校验 =====
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Build Frontend (CI 校验)
        run: |
          cd frontend
          npm config set registry https://registry.npmmirror.com
          npm ci
          npm run build

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Lint Backend (CI 校验)
        run: |
          cd backend
          pip install -r requirements.txt \
            -i https://mirrors.aliyun.com/pypi/simple/ \
            --trusted-host mirrors.aliyun.com
          python -m py_compile app/main.py

      # ===== 阶段 3: 构建并推送镜像 =====
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to ACR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and Push Backend
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          push: true
          tags: |
            ${{ env.IMAGE }}:backend-latest
            ${{ env.IMAGE }}:backend-${{ github.sha }}

      - name: Build and Push Frontend
        uses: docker/build-push-action@v5
        with:
          context: ./frontend
          push: true
          tags: |
            ${{ env.IMAGE }}:frontend-latest
            ${{ env.IMAGE }}:frontend-${{ github.sha }}

      # ===== 阶段 4: 服务器部署 =====
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          port: ${{ secrets.SSH_PORT }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /root/kb-service
            docker compose -f docker-compose.prod.yml pull
            docker compose -f docker-compose.prod.yml up -d --remove-orphans
            docker image prune -f
```

**Step 3: 验证 YAML 语法**

```bash
# 可以用 yamllint 或在线工具验证，GitHub 也会在 push 后自动校验
cat .github/workflows/deploy.yml | head -1
# 预期: name: Build and Deploy
```

---

### Task 2: 生产环境 Docker Compose 文件

**Files:**
- Create: `docker-compose.prod.yml`

**目的:** 服务器端使用的 compose 文件，用 `image:` 从 ACR 拉取镜像，不在服务器本地构建

**Step 1: 编写 docker-compose.prod.yml**

```yaml
services:
  backend:
    image: registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:backend-latest
    container_name: kb-backend
    volumes:
      - ./data/files:/data/files
      - ./data/db:/data/db
    env_file:
      - .env
    restart: unless-stopped

  frontend:
    image: registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:frontend-latest
    container_name: kb-frontend
    ports:
      - "8000:80"
    depends_on:
      - backend
    restart: unless-stopped
```

**Step 2: 与 dev compose 文件对比验证**

| 字段 | docker-compose.yml (dev) | docker-compose.prod.yml (server) |
|------|--------------------------|----------------------------------|
| backend | `build: ./backend` | `image: ...brilliant:backend-latest` |
| frontend | `build: ./frontend` | `image: ...brilliant:frontend-latest` |
| 其他 | 完全相同 | 完全相同 |

---

### Task 3: 根目录 .env.example

**Files:**
- Create: `./.env.example`（项目根目录）

**目的:** 服务器部署时参考，复制为 `.env` 并修改

**Step 1: 编写 .env.example**

```bash
# kb-service 环境变量，复制为 .env 并修改
KB_JWT_SECRET=请修改为强随机字符串
KB_ADMIN_USERNAME=admin
KB_ADMIN_PASSWORD=admin123
KB_STORAGE_DIR=/data/files
KB_DB_PATH=/data/db/kb.sqlite
KB_MAX_UPLOAD_MB=10
```

**Step 2: 确保 .gitignore 已包含根目录 .env**

```bash
grep "^\.env$" .gitignore
# 预期: .env
```

---

### Task 4: 更新 deploy.sh

**Files:**
- Modify: `deploy.sh`（项目根目录）

**目的:** 部署方式从本地构建改为从 ACR 拉取镜像

**Step 1: 修改构建部署步骤**

将原文件中：

```bash
# ---------- 4. 构建并启动 ----------
log_info "开始构建镜像并启动服务..."
$COMPOSE_CMD up -d --build
```

替换为：

```bash
# ---------- 4. 拉取镜像并启动 ----------
log_info "从阿里云 ACR 拉取镜像..."
$COMPOSE_CMD -f docker-compose.prod.yml pull

log_info "启动服务..."
$COMPOSE_CMD -f docker-compose.prod.yml up -d --remove-orphans

# 清理旧镜像
docker image prune -f
```

**Step 2: 更新完成信息中的启动命令提示**

```bash
# ---------- 5. 完成 ----------
log_info "部署完成！"
echo "  访问地址: http://localhost:8000"
echo "  管理员:   admin / admin123"
echo ""
echo "  常用命令:"
echo "    $COMPOSE_CMD -f docker-compose.prod.yml ps      查看服务状态"
echo "    $COMPOSE_CMD -f docker-compose.prod.yml logs -f  查看实时日志"
echo "    $COMPOSE_CMD -f docker-compose.prod.yml down     停止并移除服务"
```

---

### Task 5: 提交所有文件

**Step 1: 添加所有新文件和修改**

```bash
git add .github/workflows/deploy.yml
git add docker-compose.prod.yml
git add .env.example
git add deploy.sh
```

**Step 2: 提交**

```bash
git commit -m "feat: add CI/CD pipeline with GitHub Actions + ACR

- .github/workflows/deploy.yml: build, push to ACR, SSH deploy
- docker-compose.prod.yml: server compose using ACR images
- .env.example: environment variable template
- deploy.sh: updated for registry-based deployment

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Verification

### 本地验证（无需服务器）

1. YAML 语法无误：GitHub push 后 Actions 页面不报 YAML 解析错误
2. 前端构建可在 CI 完成
3. 后端语法检查可在 CI 完成
4. Docker 镜像可成功推送至 ACR

### 端到端验证（需服务器）

1. 推送代码到 main → 观察 Actions 自动执行
2. ACR 控制台确认 `backend-latest`、`frontend-latest` 两个 tag 已更新
3. SSH 登录服务器检查容器状态：
   ```bash
   docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
   ```
   预期：`kb-backend` 和 `kb-frontend` 运行中，镜像为 `registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:*`
4. 浏览器访问 `http://<服务器IP>:8000` 确认功能正常

### 失败路径验证

1. 故意引入前端编译错误 → PR check 应标红，部署不触发
2. 确认 ACR 镜像未被更新（前端构建失败时 docker build push 不会执行到后端步骤 — 实际流程会继续执行后端构建但前端阶段已标红停止）

> **注意:** 当前 workflow 设计为每个 build-push step 独立，前端失败不会阻止后端。如需要更严格的"全有或全无"语义，可以在 step 间添加 `if: success()` 条件。

---

## 回滚操作手册

```bash
# 1. 在 GitHub Actions 日志中找到目标 commit SHA（如 a3f2b1c7）
# 2. SSH 登录服务器
cd /root/kb-service

# 3. 拉取指定版本镜像
docker pull registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:backend-a3f2b1c7
docker pull registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:frontend-a3f2b1c7

# 4. 打回 latest 标签
docker tag registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:backend-a3f2b1c7 \
           registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:backend-latest
docker tag registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:frontend-a3f2b1c7 \
           registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant:frontend-latest

# 5. 重启服务
docker compose -f docker-compose.prod.yml up -d
```

---

## 关联文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `.github/workflows/deploy.yml` | 新增 | 核心 CI/CD 流程定义 |
| `docker-compose.prod.yml` | 新增 | 服务器生产 compose 文件 |
| `.env.example` | 新增 | 环境变量模板 |
| `deploy.sh` | 修改 | 适配 registry 部署 |
| `specs/003-cicd-acr-deploy/spec.md` | 已存在 | 需求规范 |
| `docs/cicd-solutions.md` | 已存在 | 业界方案调研 |
