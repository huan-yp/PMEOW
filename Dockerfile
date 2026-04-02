# Build stage
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

COPY packages/core packages/core
COPY packages/ui packages/ui
COPY packages/web packages/web
COPY tsconfig.base.json ./

# Build core
RUN cd packages/core && pnpm exec tsc

# Build UI
RUN cd packages/ui && pnpm exec vite build

# Build web (copies UI dist into web dist/public)
RUN cd packages/web && pnpm exec tsc && cp -r ../ui/dist ./dist/public

# Production stage
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/

RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod

# Copy built code
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/web/dist packages/web/dist

# Data directory for SQLite
RUN mkdir -p /data
ENV MONITOR_DB_PATH=/data/monitor.db

EXPOSE 17200

CMD ["node", "packages/web/dist/server.js"]
