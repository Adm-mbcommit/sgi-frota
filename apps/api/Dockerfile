# Build a partir da raiz do repositório:  docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @sgi/core && npm run build -w @sgi/api \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY legacy/snapshot.json legacy/snapshot.json
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3333/health || exit 1
# aplica migrações pendentes e sobe a API
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && node apps/api/dist/server.js"]
