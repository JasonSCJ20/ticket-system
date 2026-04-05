FROM node:20-slim

# dumb-init handles PID 1 signal forwarding and zombie reaping.
RUN apt-get update -qq && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for layer caching.
COPY package.json package-lock.json* ./

# Production dependencies only.
RUN npm ci --omit=dev --ignore-scripts

# Copy source.
COPY src/ ./src/

# Non-root user for defence-in-depth.
RUN groupadd --gid 1001 nodejs && useradd --uid 1001 --gid nodejs --shell /bin/sh --no-create-home nodejs
USER nodejs

EXPOSE 8001

# dumb-init as PID 1 so SIGTERM propagates correctly to node.
CMD ["dumb-init", "node", "src/app.js"]
