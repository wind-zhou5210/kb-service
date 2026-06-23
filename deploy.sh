#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# kb-service 一键部署脚本
# 用法: ./deploy.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------- 1. 前置检查 ----------
log_info "检查运行环境..."

if ! command -v docker &>/dev/null; then
    log_error "未检测到 Docker，请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检测 docker compose 子命令 (v2) 或 docker-compose (v1)
if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
else
    log_error "未检测到 Docker Compose，请先安装。"
    exit 1
fi
log_info "Docker / Docker Compose 已就绪"

# ---------- 2. 目录准备 ----------
log_info "创建数据目录..."
mkdir -p data/files data/db

# ---------- 3. 生成随机 JWT 密钥 ----------
if [ ! -f .env ]; then
    JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_urlsafe(32))" 2>/dev/null || date +%s | sha256sum | head -c 44)
    log_info "生成随机 JWT 密钥并写入 .env ..."
    cat > .env <<EOF
KB_JWT_SECRET=${JWT_SECRET}
KB_ADMIN_USERNAME=admin
KB_ADMIN_PASSWORD=admin123
KB_STORAGE_DIR=/data/files
KB_DB_PATH=/data/db/kb.sqlite
KB_MAX_UPLOAD_MB=10
EOF
    log_warn "已生成 .env 配置文件，请按需修改 admin 密码。"
else
    log_info ".env 已存在，跳过生成。"
fi

# ---------- 4. 拉取镜像并启动 ----------
log_info "从阿里云 ACR 拉取镜像..."
$COMPOSE_CMD -f docker-compose.prod.yml pull

log_info "启动服务..."
$COMPOSE_CMD -f docker-compose.prod.yml up -d --remove-orphans

# 清理旧镜像
docker image prune -f

# ---------- 5. 完成 ----------
log_info "部署完成！"
echo "  访问地址: http://localhost:8000"
echo "  管理员:   admin / admin123"
echo ""
echo "  常用命令:"
echo "    $COMPOSE_CMD -f docker-compose.prod.yml ps      查看服务状态"
echo "    $COMPOSE_CMD -f docker-compose.prod.yml logs -f  查看实时日志"
echo "    $COMPOSE_CMD -f docker-compose.prod.yml down     停止并移除服务"
