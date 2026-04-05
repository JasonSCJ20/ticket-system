# ── Stage 1: build ───────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts
# Install all deps (including devDeps) needed for the build.
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Stage 2: serve ───────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Copy compiled React app into nginx's default web root.
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config: serve index.html for any unmatched path (SPA fallback).
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
# nginx starts automatically via the base image CMD.
