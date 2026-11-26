import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { query } from './db';
import { errorHandler, h, HttpError } from './errors';
import { authenticate } from './auth/middleware';
import { authRouter } from './routes/auth';
import { customersRouter } from './routes/customers';
import { servicesRouter } from './routes/services';
import { techniciansRouter } from './routes/technicians';
import { bookingsRouter } from './routes/bookings';
import { dashboardRouter } from './routes/dashboard';
import { usersRouter } from './routes/users';
import { branchesRouter } from './routes/branches';
import { openapi } from './openapi';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind IIS ARR / nginx
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, skip: () => config.env === 'test' }));

  const api = express.Router();
  api.get('/health', h(async (_req, res) => {
    await query('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  }));
  api.use('/auth', authRouter);
  api.use('/customers', authenticate, customersRouter);
  api.use('/services', authenticate, servicesRouter);
  api.use('/technicians', authenticate, techniciansRouter);
  api.use('/bookings', authenticate, bookingsRouter);
  api.use('/dashboard', authenticate, dashboardRouter);
  api.use('/users', authenticate, usersRouter);
  api.use('/branches', authenticate, branchesRouter);
  api.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')));

  app.use('/api', api);
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openapi));
  app.use(errorHandler);
  return app;
}
