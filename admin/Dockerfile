# syntax=docker/dockerfile:1
# TowNow admin dashboard (Next.js standalone). Build context: the repository root
# (the dashboard reuses ../src/services). See deploy/docker-compose.yml.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY admin/package.json admin/package-lock.json ./admin/
RUN cd admin && npm ci --no-audit --no-fund
COPY src/services ./src/services
COPY src/types ./src/types
COPY admin ./admin
# Baked into the browser bundle at build time (public URL of the API).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN cd admin && npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/admin/.next/static ./admin/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3001/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "admin/server.js"]
