# ============================================================
# NowenReader Docker Image
# 傻瓜式一键部署，无需任何配置
# ============================================================

# --- Stage 1: Install dependencies ---
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
# 完整安装（不跳过 postinstall），确保原生模块正确构建
RUN npm ci
# npm 在 Alpine (musl) 下经常漏装 optional 的平台特定原生绑定，手动补装
RUN npm install \
    lightningcss-linux-x64-musl \
    @tailwindcss/oxide-linux-x64-musl \
    @img/sharp-linuxmusl-x64 \
    @libsql/linux-x64-musl

# --- Stage 2: Build the app ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 设置数据库路径到持久化目录
ENV DATABASE_URL="file:/data/nowen-reader.db"
ENV NEXT_TELEMETRY_DISABLED=1

# Prisma generate + db push + Next.js build (all in npm run build)
RUN npm run build

# --- Stage 3: Production image ---
FROM node:20-alpine AS runner
WORKDIR /app

# 安装运行时依赖：7zip（用于解压 .7z/.cb7）、su-exec（用于降权运行）
# unrar 不需要系统包，项目使用 node-unrar-js (WASM 实现)
RUN apk add --no-cache p7zip tini su-exec

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制 standalone 输出
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/generated ./src/generated

# 复制轻量数据库初始化脚本（替代 prisma CLI）
COPY db-init.mjs ./db-init.mjs

# 复制 libsql 数据库驱动
COPY --from=builder /app/node_modules/@libsql ./node_modules/@libsql

# 复制 7zip-bin 和 node-unrar-js 的原生模块
COPY --from=builder /app/node_modules/7zip-bin ./node_modules/7zip-bin
COPY --from=builder /app/node_modules/node-7z ./node_modules/node-7z
COPY --from=builder /app/node_modules/node-unrar-js ./node_modules/node-unrar-js

# 复制 sharp 原生模块
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img

# 复制其他运行时依赖（standalone 可能未自动包含的）
COPY --from=builder /app/node_modules/adm-zip ./node_modules/adm-zip
COPY --from=builder /app/node_modules/node-stream-zip ./node_modules/node-stream-zip
COPY --from=builder /app/node_modules/xml2js ./node_modules/xml2js
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/node_modules/pdf-lib ./node_modules/pdf-lib
COPY --from=builder /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
COPY --from=builder /app/node_modules/uuid ./node_modules/uuid
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv

# 复制 entrypoint 脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 创建数据目录和缓存目录
RUN mkdir -p /data /app/comics /app/.cache && \
    chown -R nextjs:nodejs /app /data

# 持久化卷
VOLUME ["/data", "/app/comics"]

# 暴露端口
EXPOSE 3000

# 以 root 启动 entrypoint，由脚本内部处理权限后降权运行
ENTRYPOINT ["tini", "--"]
CMD ["/docker-entrypoint.sh"]
