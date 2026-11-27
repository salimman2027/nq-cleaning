import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { query } from './db';
import { errorHandler, h, HttpError } from './errors';
import { authenticate, requireApprovedCompany } from './auth/middleware';
import { authRouter } from './routes/auth';
import { customersRouter } from './routes/customers';
import { servicesRouter } from './routes/services';
import { techniciansRouter } from './routes/technicians';
import { bookingsRouter } from './routes/bookings';
import { supervisorsRouter } from './routes/supervisors';
import { financeRouter } from './routes/finance';
import { ratingsRouter } from './routes/ratings';
import { shopRouter } from './routes/shop';
import { mediaRouter } from './routes/media';
import { requestsRouter } from './routes/requests';
import { dashboardRouter } from './routes/dashboard';
import { usersRouter } from './routes/users';
import { branchesRouter } from './routes/branches';
import { onboardingRouter } from './routes/onboarding';
import { companyRouter } from './routes/company';
import { platformRouter } from './routes/platform';
import { marketRouter } from './routes/market';
import { openapi } from './openapi';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind IIS ARR / nginx
  // The default CSP adds "upgrade-insecure-requests", which blanks the page on a host that has no HTTPS certificate yet.
  // HTTPS is enforced by the host (IIS / the hosting panel), not by this header.
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null, 'img-src': ["'self'", 'data:', 'blob:', 'https:'] } }, hsts: false }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.corsOrigins.includes(origin) || origin === 'https://localhost' || origin === 'capacitor://localhost') return cb(null, true);
        cb(null, false);
      },
    }),
  );
  // Document uploads travel as base64 JSON (5 MB file ≈ 6.7 MB), so this one route gets a larger limit.
  app.use('/api/company/documents', express.json({ limit: '8mb' }));
  app.use('/api/media', express.json({ limit: '4mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, skip: () => config.env === 'test' }));

  const api = express.Router();
  api.get('/health', h(async (_req, res) => {
    await query('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  }));
  api.use('/auth', authRouter);
  api.use('/onboarding', onboardingRouter);
  api.use('/market', marketRouter);
  api.use('/media', mediaRouter);
  api.use('/shop', shopRouter);
  api.use('/company', authenticate, companyRouter);
  api.use('/platform', authenticate, platformRouter);
  api.use('/customers', authenticate, requireApprovedCompany, customersRouter);
  api.use('/services', authenticate, requireApprovedCompany, servicesRouter);
  api.use('/technicians', authenticate, requireApprovedCompany, techniciansRouter);
  api.use('/bookings', authenticate, requireApprovedCompany, bookingsRouter);
  api.use('/supervisors', authenticate, requireApprovedCompany, supervisorsRouter);
  api.use('/ratings', authenticate, requireApprovedCompany, ratingsRouter);
  api.use('/finance', authenticate, requireApprovedCompany, financeRouter);
  api.use('/requests', authenticate, requireApprovedCompany, requestsRouter);
  api.use('/dashboard', authenticate, requireApprovedCompany, dashboardRouter);
  api.use('/users', authenticate, requireApprovedCompany, usersRouter);
  api.use('/branches', authenticate, requireApprovedCompany, branchesRouter);
  api.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')));

  // Docs must be mounted before the API router, whose catch-all 404 would otherwise swallow /api/docs.
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openapi));
  app.use('/api', api);
  // Single-site deployment (e.g. MonsterASP): serve the built web app from the same origin as the API.
  const webDir = process.env.FRONTEND_DIR ? path.resolve(process.env.FRONTEND_DIR) : path.resolve(__dirname, '..', 'frontend');
  if (existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
