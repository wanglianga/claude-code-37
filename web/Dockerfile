# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- 运行阶段：nginx 静态托管 ----------
FROM nginx:1.27-alpine
# nginx unprivileged：使用 8080 端口并以非 root 的 nginx 用户运行
RUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf \
  && sed -i 's#^pid .*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
  && chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
