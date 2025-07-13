# ============== STAGE 1: Builder ==============
FROM node:20-slim AS builder

WORKDIR /app

# 1. Install OpenSSL if needed (Debian-based)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# 2. Copy package files first for better caching
COPY package.json package-lock.json ./
RUN npm ci

# 3. Copy and generate Prisma client
COPY prisma ./prisma/
RUN npx prisma generate --schema=./prisma/schema.prisma

# 4. Copy all source files
COPY . .

# ============== STAGE 2: Runtime ==============
FROM node:20-slim

# 1. Install runtime dependencies
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# 2. Setup non-root user
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m appuser

WORKDIR /app

# 3. Install PM2 globally
RUN npm install -g pm2@latest

# 4. Copy production files from builder
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=user:group /app/.env ./.env
# 5. Set environment
ENV NODE_ENV=production
ENV PORT=3000

# 6. Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:$PORT/health || exit 1

# 7. Drop privileges and start PM2
USER appuser
CMD ["pm2-runtime", "start", "src/server.js", "--name", "api", "-i", "max"]
