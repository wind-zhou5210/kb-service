# kb-service CI/CD 自动化部署方案

## 项目现状

| 维度 | 现状 |
|------|------|
| 代码仓库 | GitHub (`wind-zhou5210/kb-service`) |
| 部署方式 | Docker Compose（backend + frontend） |
| 部署服务器 | 单机自托管 |
| 构建方式 | `docker compose up -d --build` |
| 镜像仓库 | 无（本地构建） |

## 业界方案全景

| 方案 | 复杂度 | 适用规模 | 费用 | 核心思路 |
|------|--------|---------|------|---------|
| A. GitHub Actions + SSH | ⭐ | 单机/小集群 | 免费 | CI 构建后 SSH 到服务器执行部署命令 |
| B. GitHub Actions + Registry | ⭐⭐ | 中小型 | 免费+仓库费 | CI 构建并推送镜像 → 服务器拉取部署 |
| C. Self-hosted Runner | ⭐⭐ | 中小型 | 免费 | Runner 直接装在目标服务器上 |
| D. Webhook + 部署代理 | ⭐ | 单机 | 免费 | GitHub Webhook → 轻量 HTTP 服务触发脚本 |
| E. GitLab CI/CD | ⭐⭐ | 中小型 | 免费 | 代码迁到 GitLab，内置 CI/CD |
| F. Jenkins | ⭐⭐⭐⭐ | 大型/企业 | 免费+服务器 | 自建 Jenkins 服务，插件生态齐全 |

---

## 方案 A: GitHub Actions + SSH 远程部署（推荐）

**最匹配本项目现状的方案**，改动最小，上手最快。

### 架构

```
main 分支 push ──> GitHub Actions
                      │
                      ├─ checkout 代码
                      ├─ 构建前端 (npm ci && npm run build)
                      ├─ 构建后端 (pip install)
                      ├─ 运行测试 (如果有)
                      └─ SSH → 服务器
                                  │
                                  ├─ git pull
                                  ├─ docker compose up -d --build
                                  └─ docker image prune -f
```

### 前置准备

1. **服务器创建部署专用 SSH Key**

```bash
# 在服务器上执行
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github_actions  # 复制私钥内容
```

2. **GitHub Secrets 配置**

在仓库 `Settings → Secrets and variables → Actions` 添加：

| Secret 名 | 值 | 说明 |
|-----------|-----|------|
| `SSH_HOST` | `192.168.x.x` | 服务器 IP |
| `SSH_PORT` | `22` | SSH 端口 |
| `SSH_USER` | `root` 或 `deploy` | 登录用户 |
| `SSH_KEY` | `-----BEGIN...` | 上一步的私钥 |

### Workflow 配置

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Server

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js (前端构建验证)
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Build Frontend (CI 检查)
        run: |
          cd frontend
          npm config set registry https://registry.npmmirror.com
          npm ci
          npm run build

      - name: Setup Python (后端语法检查)
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Lint Backend (CI 检查)
        run: |
          cd backend
          pip install -r requirements.txt \
            -i https://mirrors.aliyun.com/pypi/simple/ \
            --trusted-host mirrors.aliyun.com
          python -m py_compile app/main.py

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          port: ${{ secrets.SSH_PORT }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/kb-service
            git pull origin main
            docker compose up -d --build --remove-orphans
            docker image prune -f
```

### 优缺点

| 优点 | 缺点 |
|------|------|
| 配置简单，10 分钟搞定 | 服务器需要能被 GitHub Actions 访问（公网 IP 或内网穿透） |
| 服务器即目标，无中间层 | SSH 凭据集中在 GitHub Secrets，泄漏风险 |
| GitHub Actions 2000 分钟/月免费 | 构建在 CI 上再做一次，部署时间较长 |

---

## 方案 B: GitHub Actions + 镜像仓库 + 服务器拉取

将构建和部署彻底分离，CI 只负责产出镜像，服务器只负责拉取运行。

### 架构

```
main 分支 push ──> GitHub Actions
                      │
                      ├─ docker build backend → push to Registry
                      ├─ docker build frontend → push to Registry
                      └─ SSH → 服务器
                                  │
                                  ├─ docker compose pull
                                  └─ docker compose up -d
```

### 镜像仓库选择

| 仓库 | 费用 | 备注 |
|------|------|------|
| GitHub Container Registry (GHCR) | 免费（公开仓库）| 与 GitHub 集成最佳 |
| Docker Hub | 免费（1 个私有仓库）| 国内拉取慢 |
| 阿里云 ACR | 免费（个人版）| 国内拉取快 |

### Workflow 配置 (GHCR)

```yaml
name: Build and Deploy

on:
  push:
    branches:
      - main

env:
  REGISTRY: ghcr.io
  BACKEND_IMAGE: ghcr.io/${{ github.repository_owner }}/kb-backend
  FRONTEND_IMAGE: ghcr.io/${{ github.repository_owner }}/kb-frontend

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and Push Backend
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          push: true
          tags: ${{ env.BACKEND_IMAGE }}:latest,${{ env.BACKEND_IMAGE }}:${{ github.sha }}

      - name: Build and Push Frontend
        uses: docker/build-push-action@v5
        with:
          context: ./frontend
          push: true
          tags: ${{ env.FRONTEND_IMAGE }}:latest,${{ env.FRONTEND_IMAGE }}:${{ github.sha }}

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          port: ${{ secrets.SSH_PORT }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/kb-service
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
```

配套的 `docker-compose.yml`（服务器端）需要改用镜像：

```yaml
services:
  backend:
    image: ghcr.io/wind-zhou5210/kb-backend:latest
    # 不再需要 build: ./backend
    container_name: kb-backend
    volumes:
      - ./data/files:/data/files
      - ./data/db:/data/db
    env_file:
      - .env
    restart: unless-stopped

  frontend:
    image: ghcr.io/wind-zhou5210/kb-frontend:latest
    container_name: kb-frontend
    ports:
      - "8000:80"
    depends_on:
      - backend
    restart: unless-stopped
```

> **注意**：首次部署前，服务器需要先 `docker login ghcr.io` 登录。
> 使用 Personal Access Token（PAT），`read:packages` 权限即可拉取。

### 优缺点

| 优点 | 缺点 |
|------|------|
| 构建和部署分离，CI 不依赖服务器状态 | 需要维护镜像仓库 |
| 服务器部署极快（只拉镜像不构建） | GHCR 拉取国内可能慢（可用阿里云 ACR） |
| 支持回滚（重新拉旧 tag 即可） | 需要两套 compose 文件（本地 dev 用 build，服务器用 image） |

---

## 方案 C: Self-hosted Runner

将 GitHub Actions Runner 直接运行在部署服务器上。

### 架构

```
main 分支 push ──> GitHub Actions → Self-hosted Runner (目标服务器)
                                          │
                                          ├─ git pull
                                          ├─ docker compose up -d --build
                                          └─ docker image prune -f
```

### 安装 Runner

```bash
# 在服务器上执行
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64.tar.gz -L \
  https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64-2.317.0.tar.gz
tar xzf actions-runner-linux-x64.tar.gz
./config.sh --url https://github.com/wind-zhou5210/kb-service --token <TOKEN>
./run.sh
```

### Workflow 配置

```yaml
name: Deploy on Self-hosted Runner

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: self-hosted
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy
        run: |
          cd ${{ github.workspace }}
          docker compose up -d --build --remove-orphans
          docker image prune -f
```

### 优缺点

| 优点 | 缺点 |
|------|------|
| 无需 SSH 配置，Runner 直接在服务器上 | Runner 拥有服务器完整权限，安全隔离差 |
| 构建产物本地缓存，速度最快 | 公开仓库的 Self-hosted Runner 有安全风险（PR 可执行任意代码） |
| 无网络连通性问题 | Runner 进程需要常驻维护 |

---

## 方案 D: Webhook + 轻量部署代理

不依赖 GitHub Actions 的部署执行，而是用 Webhook 触发服务器上的部署脚本。

### 架构

```
main 分支 push ──> GitHub Webhook ──HTTP POST──> 服务器 webhook 服务
                                                        │
                                                        └─ deploy.sh
```

### 推荐工具

| 工具 | 特点 |
|------|------|
| [webhook](https://github.com/adnanh/webhook) | Go 编写，单二进制，配置简单 |
| [webhookd](https://github.com/ncarlier/webhookd) | 类似 CGI，脚本即 handler |
| Node.js 自建 | `http.createServer` 几十行搞定 |

### 配置示例 (adnanh/webhook)

服务器上：

```bash
# 安装
apt install webhook

# hooks.json
cat > /etc/webhook.conf <<'EOF'
[
  {
    "id": "deploy-kb",
    "execute-command": "/opt/kb-service/deploy.sh",
    "command-working-directory": "/opt/kb-service",
    "trigger-rule": {
      "match": { "type": "payload-hmac-sha256", "secret": "YOUR_SECRET" }
    }
  }
]
EOF

# 运行
webhook -hooks /etc/webhook.conf -port 9000
```

GitHub 仓库 `Settings → Webhooks → Add webhook`：
- Payload URL: `http://your-server:9000/hooks/deploy-kb`
- Content type: `application/json`
- Secret: `YOUR_SECRET`

### 优缺点

| 优点 | 缺点 |
|------|------|
| 完全解耦，不用 GitHub Actions | 需要暴露 Webhook 端口到公网 |
| 服务器构建，缓存复用 | 缺少 CI 阶段的构建验证 |
| 极其轻量 | 无日志、无审批流程 |

---

## 方案 E: GitLab CI/CD

如果愿意将代码迁移到 GitLab（或自建 GitLab），CI/CD 是内置功能。

### 核心差异

- GitHub Actions 的 `uses:` 生态 → GitLab CI 用 `include:` 引入模板
- `runs-on: ubuntu-latest` → GitLab Runner tags
- Secrets 管理在 `Settings → CI/CD → Variables`

配置示例 `.gitlab-ci.yml`：

```yaml
stages:
  - build
  - deploy

deploy:
  stage: deploy
  only:
    - main
  script:
    - ssh deploy@server "cd /opt/kb-service && git pull && docker compose up -d --build"
```

| 优点 | 缺点 |
|------|------|
| CI/CD 与代码仓库深度集成 | 需要迁移仓库 |
| 自托管 GitLab Runner 成熟 | GitLab 本身运维成本 |

---

## 方案 F: Jenkins

传统企业级方案，功能最全但最重。

| 优点 | 缺点 |
|------|------|
| 插件生态最丰富 | 需要独立服务器跑 Jenkins Master |
| 可视化 Pipeline + Blue Ocean | Java 应用，内存占用 1G+ |
| 支持复杂的审批/门禁流程 | 对本项目而言过于笨重 |
| 凭据管理完善 | 配置复杂度最高 |

> **结论**：本项目规模不建议 Jenkins，除非公司已有统一 Jenkins 平台。

---

## 方案对比总结

| 维度 | A. SSH | B. Registry | C. Runner | D. Webhook |
|------|--------|-------------|-----------|------------|
| 配置复杂度 | ⭐ | ⭐⭐ | ⭐⭐ | ⭐ |
| 部署速度 | 慢（CI 重复构建）| **快**（拉镜像） | 快 | 快 |
| 回滚能力 | Git revert | **docker tag** | Git revert | Git revert |
| 安全隔离 | 中 | 中 | **差** | 中 |
| 需要公网 | 是 | 是 | 否 | 是 |
| 国内友好 | 中 | 差(GHCR)/**好**(ACR) | 好 | 好 |
| 推荐场景 | 快速上手 | **专业首选** | 实验环境 | 极简需求 |

---

## 推荐路径

```
第一阶段（现在）── 方案 A (SSH)
  │  改动最小，10 分钟上线
  │
第二阶段（稳定后）── 方案 B (Registry)
  │  构建部署分离，专业可靠
  │
第三阶段（规模化）── 方案 B + 多环境 + 审批
      staging → UAT → production
```

对 kb-service 当前状态，**建议直接实施方案 A**，后续需要时升级到方案 B。

---

## 安全建议

1. **最小权限**：部署专用系统用户，仅授权 `/opt/kb-service` 目录
2. **SSH Key 独立**：不要复用个人开发 Key
3. **Secret 轮换**：定期更换 Webhook Secret / SSH Key
4. **`.env` 管理**：不要提交到 Git，服务器上手动创建或通过 CI Secret 注入
5. **Docker 非 root**：[rootless mode](https://docs.docker.com/engine/security/rootless/) 或 `userns-remap`

---

## 参考资料

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [appleboy/ssh-action](https://github.com/appleboy/ssh-action)
- [docker/build-push-action](https://github.com/docker/build-push-action)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
