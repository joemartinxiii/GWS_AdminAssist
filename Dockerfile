# Fixed for Cloud Run: backend-only production dependencies to avoid ESM/CJS conflicts (jsdom, encoding-lite, etc.)
# Frontend is built and its dist/ is copied statically. No frontend deps in runtime image.

FROM node:20-slim AS builder

WORKDIR /app

# Quiet, deterministic npm output: no funding/audit/update chatter or
# deprecation/engine warnings. Real errors still surface and fail the build.
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_LOGLEVEL=error

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install (for build)
RUN npm install

# Copy source
COPY . .

# Production frontend must never embed MSW or mock session flags
ENV VITE_USE_MSW=false
# Build frontend + backend
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_LOGLEVEL=error

# Copy built frontend static files and backend dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/

# Install ONLY backend production dependencies (this avoids pulling frontend's ESM-only deps like jsdom)
RUN cd backend && npm install --omit=dev --legacy-peer-deps

# Non-root user. Omit --system on useradd so it doesn't warn that uid 1001 is
# above SYS_UID_MAX; the explicit uid/gid keep the runtime user deterministic.
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --no-create-home nodejs

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "backend/dist/index.js"]
