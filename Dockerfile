FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js ./
COPY client/ client/
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY server/ server/
COPY tsconfig.json ./
COPY --from=builder /app/dist /app/dist

RUN mkdir -p /data/notes

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

VOLUME ["/data"]

CMD ["bun", "server/index.ts"]
