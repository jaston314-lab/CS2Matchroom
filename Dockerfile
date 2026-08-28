# Debian-based (not alpine) so better-sqlite3's native module has prebuilt
# binaries available and doesn't need a musl/compiler workaround.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Ship the full node_modules (including dev deps) from the build stage
# rather than a pruned "standalone" bundle — the Prisma CLI (a dev
# dependency) needs to be available at container start to run
# `prisma migrate deploy` against the mounted SQLite volume. Costs some
# image size; keeps the migration step simple and reliable.
COPY --from=build /app ./

RUN mkdir -p /app/data
VOLUME ["/app/data"]

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
