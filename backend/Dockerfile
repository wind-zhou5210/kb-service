FROM python:3.11-slim
WORKDIR /app

# 说明：原 apt-get update/install 步骤已移除——
# 1) install 未指定任何包名，实际不安装系统依赖；
# 2) 其 Debian 源被改指国内镜像，在 GitHub 海外 runner 上属跨国慢链路，
#    是构建耗时的主要来源之一。
# 若后续确需系统依赖，请显式列出包名，并通过 ARG 控制源（CI 用官方源）。

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
