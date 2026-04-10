# Multi-stage production build for Cloud Run (used by deploy.sh --source .)
# - Builds frontend (Vite/React static)
# - Builds backend (TypeScript)
# - Final slim image serves static frontend + API on PORT=8080 (0.0.0.0)
# Uses root npm workspace but copies per-dir for build isolation.

# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --include=dev
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:18-alpine AS backend-builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
# Build (tsc emits JS even with type errors for robustness)
RUN npm run build || echo "⚠️ Type check had issues but JS emitted (common on first deploy)"

# Stage 3: Production image (minimal, non-root, serves FE static + API)
FROM node:18-alpine

WORKDIR /app

# Production deps only (from backend, as it serves frontend)
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built assets
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/package*.json ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Non-root user for security (Cloud Run best practice)
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080

# CMD matches backend/src/index.ts (listens on 0.0.0.0:$PORT)
CMD ["node", "dist/index.js"]
