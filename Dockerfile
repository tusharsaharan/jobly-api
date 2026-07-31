# ==============================================================================
# Multi-stage Production Dockerfile for Jobly API
# Non-root user, minimal attack surface, healthcheck enabled
# ==============================================================================

# Build stage
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Runner stage
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# The interview sandbox and LSP gateway run inside this Linux container, never
# on the web server host. Standard libraries (STL, Java, Python and Node) are
# available; arbitrary network package installation remains intentionally off.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential clangd libboost-all-dev python3 openjdk-17-jdk-headless \
  && npm install -g typescript typescript-language-server pyright tsx \
  && rm -rf /var/lib/apt/lists/*

# Security: run as non-root user node
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "src/server.js"]
