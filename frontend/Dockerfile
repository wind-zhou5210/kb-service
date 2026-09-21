FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# npm 源可通过构建参数覆盖：
# - 默认国内镜像（本地/生产构建加速）
# - CI（GitHub 海外 runner）传官方源，避免跨国访问成为构建瓶颈
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry ${NPM_REGISTRY} && npm ci
COPY . .
RUN npm run build

# 用 nginx 托管静态产物，并把 /api 反代到后端
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
