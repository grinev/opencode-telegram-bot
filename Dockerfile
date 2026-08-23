# Build stage
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install only native build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy TypeScript config and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build the project
RUN npm run build

# Prune dev dependencies from the final image
RUN npm prune --omit=dev


# Runtime stage
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Install dumb-init and ca-certificates for proper signal handling and HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set production environment
ENV NODE_ENV=production

# Set persistent home for the bot
ENV OPENCODE_TELEGRAM_HOME=/app/data

# Create data directories with correct ownership for node user
RUN mkdir -p /app/data/logs /app/data/run && \
    chown -R node:node /app

# Copy built application and production dependencies from builder
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Run as non-root node user (uid 1000)
USER node

# Single dumb-init entrypoint
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]