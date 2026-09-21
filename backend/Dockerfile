FROM python:3.11-slim
WORKDIR /app

# 配置国内 Debian 镜像源（阿里云）加速 apt-get
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# PyPI 源可通过构建参数覆盖：
# - 默认国内源（本地/生产构建加速）
# - CI（GitHub 海外 runner）传官方源，避免跨国访问成为构建瓶颈
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
RUN pip install --no-cache-dir -r requirements.txt \
    -i ${PIP_INDEX_URL} \
    --trusted-host ${PIP_TRUSTED_HOST}

COPY . .

# 数据卷
VOLUME ["/data/files", "/data/db"]

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
