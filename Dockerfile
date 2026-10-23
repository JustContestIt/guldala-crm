# Production image of the CRM. Stages:
#   builder — full toolchain; deploy/docker-compose.yml also runs migrations and admin scripts from it
#   runner  — only Next's standalone server, what actually serves the app
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# next build imports db/index.ts, which refuses to load without a URL; nothing connects at build time
RUN DATABASE_URL=postgres://build@localhost/build npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3001
CMD ["node", "server.js"]
