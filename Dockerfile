# Fixed for Cloud Run: backend-only production dependencies to avoid ESM/CJS conflicts (jsdom, encoding-lite, etc.)
# Frontend is built and its dist/ is copied statically. No frontend deps in runtime image.

FROM node:18-slim AS builder

WORKDIR /app

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
FROM node:18-slim

WORKDIR /app

# Copy built frontend static files and backend dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/

# Install ONLY backend production dependencies (this avoids pulling frontend's ESM-only deps like jsdom)
RUN cd backend && npm install --omit=dev --legacy-peer-deps

# Non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --no-create-home nodejs

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "backend/dist/index.js"]
