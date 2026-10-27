# syntax=docker/dockerfile:1
#
# BeadPatternGen · 生产镜像（多阶段：Node 构建 → nginx 静态托管）
#
# 构建（在仓库根目录）：
#   docker build -f deploy/Dockerfile -t bead-pattern-gen:0.2.0 .
#
# 默认会下载约 386 MB 的四个分割模型并打进镜像（镜像约 500 MB）。
# 想要瘦镜像：--build-arg DOWNLOAD_MODELS=false，运行时把模型目录挂载到
#   /var/www/bead/models
# 注意：不下载模型时“主体识别/抠图”会报模型下载失败，其余功能正常。

FROM node:22-alpine AS build
WORKDIR /app

# 与 pnpm-lock.yaml（lockfileVersion 9）兼容。
RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG DOWNLOAD_MODELS=true
RUN if [ "$DOWNLOAD_MODELS" = "true" ]; then pnpm models:download; fi \
 && pnpm build

FROM nginx:stable-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /var/www/bead

EXPOSE 80

# wget 由 BusyBox 提供；失败时容器标记为 unhealthy。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
