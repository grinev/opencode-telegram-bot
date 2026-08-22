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

# Copy settings template for reference (startup creates settings.json if missing)
COPY settings.json.template /app/settings.json.template
RUN chown node:node /app/settings.json.template

USER node

# Single dumb-init entrypoint
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]