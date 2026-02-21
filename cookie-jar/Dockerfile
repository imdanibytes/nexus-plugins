# ── Build UI ──
FROM node:20-alpine AS ui-build
RUN npm install -g pnpm@10
WORKDIR /app/ui

COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui/ ./
RUN pnpm build

# ── Runtime ──
FROM node:20-alpine
WORKDIR /app
RUN mkdir -p /app/data

COPY package.json ./
RUN npm install --omit=dev

COPY src/server.js src/store.js ./
COPY --from=ui-build /app/ui/dist ./public/

EXPOSE 80
VOLUME ["/app/data"]
CMD ["node", "server.js"]
