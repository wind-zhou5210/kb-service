FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# 配置 npm 淘宝镜像源加速安装
RUN npm config set registry https://registry.npmmirror.com
RUN npm ci
COPY . .
RUN npm run build

# 用 nginx 托管静态产物，并把 /api 反代到后端
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
