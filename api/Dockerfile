# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# 仅安装生产依赖
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
  && addgroup -S app && adduser -S app -G app
COPY --from=build /app/dist ./dist
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
