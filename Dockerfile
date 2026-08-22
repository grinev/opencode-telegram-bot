FROM node:22-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Use existing node user (uid 1000)
# Create directories for persistent data
RUN mkdir -p /app/data/logs /app/data/run && \
    chown -R node:node /app

# Set persistent home for the bot
ENV OPENCODE_TELEGRAM_HOME=/app/data

USER node

# Single dumb-init entrypoint
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]