# Build stage
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY server/contracts/package.json server/contracts/
COPY server/core/package.json server/core/
COPY apps/common/package.json apps/common/
COPY apps/web/package.json apps/web/
COPY server/runtime/package.json server/runtime/

RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

COPY server/contracts server/contracts
COPY server/core server/core
COPY apps/common apps/common
COPY apps/web apps/web
COPY server/runtime server/runtime
COPY tsconfig.base.json ./

# Build server-contracts
RUN cd server/contracts && pnpm exec tsc

# Build core
RUN cd server/core && pnpm exec tsc

# Build app-common
RUN cd apps/common && pnpm exec tsc

# Build UI
RUN cd apps/web && pnpm exec vite build

# Build runtime
RUN cd server/runtime && pnpm exec tsc

# Production stage
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY server/contracts/package.json server/contracts/
COPY server/core/package.json server/core/
COPY server/runtime/package.json server/runtime/

RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod

# Copy built code
COPY --from=builder /app/server/contracts/dist server/contracts/dist
COPY --from=builder /app/server/core/dist server/core/dist
COPY --from=builder /app/server/runtime/dist server/runtime/dist
COPY --from=builder /app/apps/web/dist apps/web/dist
COPY scripts/run-web-server.mjs scripts/run-web-server.mjs

# Data directory for SQLite
RUN mkdir -p /data
ENV MONITOR_DB_PATH=/data/monitor.db

EXPOSE 17200

CMD ["node", "scripts/run-web-server.mjs"]
