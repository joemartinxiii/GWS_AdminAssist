import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/request.middleware';
import { validateEnvironment } from './utils/env.validation';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import driveRoutes from './routes/drive.routes';
import gmailRoutes from './routes/gmail.routes';
import calendarRoutes from './routes/calendar.routes';
import groupsRoutes from './routes/groups.routes';
import auditRoutes from './routes/audit.routes';
import path from 'path';

console.log('🚀 Starting Google Workspace Admin Assist...');
console.log('Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  hasJWT: !!process.env.JWT_SECRET?.trim(),
  hasProjectId: !!process.env.GCP_PROJECT_ID?.trim(),
  hasWorkspaceDomain: !!process.env.WORKSPACE_DOMAIN?.trim(),
  hasClientId: !!process.env.GOOGLE_CLIENT_ID?.trim(),
});

// Load environment variables
dotenv.config();

// Validate environment before starting
validateEnvironment();

const app = express();
// Cloud Run sets PORT (8080). Bind explicitly to all interfaces — required for the platform health check.
const port = Number(process.env.PORT) || 8080;

// Middleware
// Cloud Run sits behind a proxy/load balancer; trust the first hop so rate limiting keys by real client IP.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || true, // Allow any origin if not specified (for initial deployment)
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // allow normal dashboard bursts across multiple tabs/pages
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const mutationSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: 'Too many sensitive operations, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Keep read paths responsive; protect only mutating operations.
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
});

app.use('/api/', generalLimiter);
app.use('/api/drive', mutationSensitiveLimiter);
app.use('/api/gmail', mutationSensitiveLimiter);
app.use('/api/groups', mutationSensitiveLimiter);

// Request logging
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    security: {
      jwtConfigured: !!process.env.JWT_SECRET,
      gcpConfigured: !!process.env.GCP_PROJECT_ID,
      corsOrigin: process.env.CORS_ORIGIN,
      allowedDomains: process.env.GWS_ALLOWED_DOMAINS?.split(',').map(d => d.trim()) || [process.env.WORKSPACE_DOMAIN]
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/audit', auditRoutes);

// Serve static files in production (controlled by SERVE_FRONTEND env var - default true for single-container deploys)
if (process.env.NODE_ENV === 'production' && process.env.SERVE_FRONTEND !== 'false') {
  // Professional deployment: backend/dist/index.js serves frontend from ../../frontend/dist
  const staticPath = path.join(__dirname, '../../frontend/dist');
  console.log('Serving static files from:', staticPath);
  app.use(express.static(staticPath));

  // Serve React app for all non-API routes (SPA routing)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server (0.0.0.0: required for Docker/Cloud Run so probes can reach the process)
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
