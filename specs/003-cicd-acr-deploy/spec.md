# kb-service CI/CD 自动化部署 需求规范

Version: 1.0
Created: 2026-06-23
Status: Draft

## 1. 概述

### 1.1 背景

kb-service 当前部署依赖手动执行 `docker compose up -d --build`，存在以下问题：

- 每次部署需手动登录服务器执行命令，流程繁琐
- 构建在服务器本地进行，消耗服务器资源且速度受限于服务器性能
- 缺乏版本化镜像管理，无法快速回滚
- 缺少代码合并前的自动化校验环节

### 1.2 目标

实现「代码合并到 main → 自动构建镜像 → 推送阿里云 ACR → 服务器拉取部署」全流程自动化，达成：

- **部署零人工介入**：合并即部署，无需手动操作服务器
- **构建部署分离**：CI 负责构建，服务器只负责运行
- **版本可追溯**：每次部署对应唯一的 Git commit，支持一键回滚

### 1.3 范围

**MVP（本次实现）**：

| 功能 | 说明 |
|------|------|
| 自动触发 | push to main 时触发 CI/CD |
| 前端构建校验 | `npm ci && npm run build` 确保可编译 |
| 后端语法校验 | `python -m py_compile` 检查语法 |
| 镜像构建推送 | Docker 构建前后端镜像，推送到阿里云 ACR |
| 服务器部署 | SSH 触发服务器 `docker compose pull && up -d` |
| 版本 Tag | `latest` + Git SHA 双 tag 策略 |
| 旧镜像清理 | 部署后执行 `docker image prune -f` |

**P2（后续迭代 TODO）**：

| 功能 | 说明 |
|------|------|
| 多环境支持 | staging → production 分环境部署 |
| CLI 自动发布 | Tag 时自动 `npm publish` |
| 失败通知 | 企业微信/钉钉/邮件通知 |
| 自动化测试 | 接入 pytest/vitest |

### 1.4 成功指标

- 从 push 到部署完成全流程 ≤ 10 分钟
- 部署成功率 ≥ 95%
- 回滚操作可在 2 分钟内完成

---

## 2. 用户分析

### 2.1 目标用户

| 角色 | 场景 | 诉求 |
|------|------|------|
| 后端/前端开发者 | 合并 PR 后希望自动上线 | 减少重复操作，避免遗漏 |
| 项目维护者 | 需要知道哪次部署对应哪个版本 | 可追溯、可回滚 |

### 2.2 用户故事

**作为** kb-service 开发者
**我想要** 合并 PR 到 main 后代码自动部署到服务器
**以便于** 我不用手动登录服务器操作，专注于写代码

**作为** 项目维护者
**我想要** 每次部署有明确的版本标识
**以便于** 出问题时能快速定位并回滚到上一个可用版本

### 2.3 用户旅程

```
开发者完成功能 → 提交 PR → Code Review → 合并到 main
                                              │
                                              ▼（自动触发）
                                    GitHub Actions 启动
                                              │
                                    ├─ 前端构建验证 (~2min)
                                    ├─ 后端语法检查 (~30s)
                                    ├─ Docker 构建后端镜像 (~3min)
                                    ├─ Docker 构建前端镜像 (~2min)
                                    ├─ 推送到 ACR (~1min)
                                    └─ SSH 服务器拉取部署 (~1min)
                                              │
                                              ▼
                                    部署完成 ✅
                                    访问 http://服务器IP:8000 验证
```

---

## 3. 功能需求

### 3.1 核心功能

| 编号 | 功能点 | 描述 | 优先级 | 验收标准 |
|------|--------|------|--------|----------|
| F1 | 自动触发 | main 分支收到 push 后自动启动 CI/CD | P0 | 合并 PR 后 Actions 自动执行 |
| F2 | 前端构建校验 | 在 CI 中执行 `npm ci && npm run build` | P1 | 前端编译失败时 CI 标红，中止部署 |
| F3 | 后端语法校验 | 在 CI 中执行 Python 语法检查 | P1 | 语法错误时 CI 标红，中止部署 |
| F4 | 镜像构建推送 | Docker 构建前后端镜像，推送到 ACR | P0 | ACR 中出现 `latest` + `SHA` 双 tag |
| F5 | 服务器部署 | SSH 到服务器执行 `pull && up -d` | P0 | 服务更新且正常运行 |
| F6 | 旧镜像清理 | 部署后清理无用的 dangling 镜像 | P2 | `docker image prune -f` 执行 |

### 3.2 功能详细说明

#### F1：自动触发

- **触发条件**：向 `main` 分支执行 `git push`
- **排除场景**：非 main 分支的 push 不触发、PR 的 `pull_request` 事件不触发部署（仅构建校验）

#### F4：镜像构建推送

- **仓库地址**：`registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant`
- **Tag 策略**：

| 镜像 | 标签格式 | 示例 |
|------|---------|------|
| 后端 | `backend-latest` | `backend-latest` |
| 后端 | `backend-<git_sha>` | `backend-a3f2b1c7` |
| 前端 | `frontend-latest` | `frontend-latest` |
| 前端 | `frontend-<git_sha>` | `frontend-a3f2b1c7` |

#### F5：服务器部署

- **服务器路径**：`/root/kb-service`
- **部署命令**：`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d --remove-orphans`
- **.env 管理**：服务器上手动创建，CI 流程不触达
- **首次部署**：需手动在服务器执行 `docker login` 登录 ACR、创建 `data/` 目录、创建 `.env` 文件

---

## 4. 数据需求

### 4.1 GitHub Secrets 配置

| Secret 名 | 值来源 | 用途 |
|-----------|--------|------|
| `ACR_USERNAME` | 阿里云账号 | 登录 ACR 推送镜像 |
| `ACR_PASSWORD` | ACR 固定密码 | 登录 ACR 推送镜像 |
| `SSH_HOST` | 服务器 IP | SSH 登录目标 |
| `SSH_PORT` | 22 | SSH 端口 |
| `SSH_USER` | root | SSH 登录用户 |
| `SSH_KEY` | `~/.ssh/github_actions` | SSH 私钥认证 |

### 4.2 服务器端文件

| 路径 | 文件 | 说明 |
|------|------|------|
| `/root/kb-service/` | `docker-compose.prod.yml` | 生产 compose 文件（用 `image:`） |
| `/root/kb-service/` | `.env` | 环境变量（手动创建，不入 Git） |
| `/root/kb-service/data/` | `files/`、`db/` | 数据持久化目录 |

---

## 5. 非功能需求

### 5.1 性能要求

- CI/CD 全流程 10 分钟内完成
- 服务器部署阶段（pull + up）≤ 2 分钟
- 服务重启期间停机时间 ≤ 10 秒（Docker Compose 滚动更新）

### 5.2 安全要求

- SSH 私钥通过 GitHub Secrets 加密存储，不在 YAML 中明文出现
- ACR 密码通过 GitHub Secrets 加密存储
- Secrets 值在日志中自动脱敏（GitHub 内置机制）
- 服务器 `.env` 不提交到 Git 仓库
- 镜像仓库为私有（阿里云 ACR 个人版默认私有）

### 5.3 可靠性要求

- 构建失败时**不执行**部署步骤（镜像未推送成功不重启服务）
- 部署失败时服务器保持运行旧版本容器（Docker Compose 机制保证）

---

## 6. 边缘情况与异常处理

| 场景 | 处理方式 |
|------|----------|
| 前端构建失败 | CI 标红，中止后续步骤（镜像不推送、不部署） |
| 后端语法检查失败 | CI 标红，中止后续步骤 |
| ACR 推送失败（网络/鉴权） | CI 标红，中止部署 |
| SSH 连接服务器失败 | CI 标红，镜像已推送但部署未执行，可手动补部署 |
| 服务器磁盘空间不足 | `docker image prune -f` 清理旧镜像；如仍不足，CI 标红 |
| 首次部署（服务器无 docker-compose.prod.yml） | 需人工初始化：git clone + docker login + 创建 .env |
| 同时多人合并到 main | GitHub 自动排队，后一个会取消前一个（默认行为） |

---

## 7. 验收标准

### 7.1 功能验收

- [ ] 往 main 分支 push 代码后，GitHub Actions 自动触发
- [ ] 前端构建校验通过（`npm run build` 成功）
- [ ] 后端语法校验通过（`py_compile` 成功）
- [ ] ACR 中出现 `backend-latest`、`frontend-latest` 及对应 SHA tag
- [ ] 服务器容器更新为最新镜像
- [ ] 服务 `http://服务器IP:8000` 正常访问
- [ ] 构建/推送任一失败时，不执行服务器部署

### 7.2 回滚验收

- [ ] 修改 `docker-compose.prod.yml` 中 tag 为旧 SHA，执行 `pull && up -d`，服务回退到旧版本
- [ ] 数据（SQLite 数据库、上传文件）在回滚前后保持一致

---

## 8. 附录

### 8.1 关键信息速查

| 项目 | 值 |
|------|-----|
| 代码仓库 | `https://github.com/wind-zhou5210/kb-service` |
| ACR 仓库 | `registry.cn-hangzhou.aliyuncs.com/wind-zhou/brilliant` |
| 服务器部署路径 | `/root/kb-service` |
| 服务器 compose 文件 | `docker-compose.prod.yml` |
| 后端端口 | 8000（容器内部，不对外暴露） |
| 前端端口 | 80（容器内部）→ 8000（宿主机） |

### 8.2 镜像 Tag 速查

| 组件 | latest tag | SHA tag 示例 |
|------|-----------|-------------|
| 后端 | `backend-latest` | `backend-a3f2b1c7` |
| 前端 | `frontend-latest` | `frontend-a3f2b1c7` |

### 8.3 修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| 1.0 | 2026-06-23 | wb_zhouzheng | 初稿 |
