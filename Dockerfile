# syntax=docker/dockerfile:1
FROM node:22.19.0-bookworm-slim AS build
WORKDIR /app
# Only manifests first: source-only changes reuse the dependency layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY apps/bots/package.json apps/bots/package.json
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
COPY apps/client/ apps/client/
RUN npm run build:deploy
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22.19.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 \
    DATABASE_BACKEND=sqlite DB_URL=sqlite:/app/data/heist.db \
    DEBUG_ENDPOINTS=false MAX_PLAYERS=60
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/client/dist ./apps/client/dist
COPY maps/art-world.json ./maps/art-world.json
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
