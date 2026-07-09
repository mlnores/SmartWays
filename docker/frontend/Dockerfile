FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/frontend/entrypoint.sh /docker-entrypoint.d/40-smartways-config.sh
RUN chmod +x /docker-entrypoint.d/40-smartways-config.sh
COPY --from=build /app/dist/frontend/browser/ /usr/share/nginx/html/

EXPOSE 80
