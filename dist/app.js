"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const config_1 = require("./config");
const db_1 = require("./db");
const errors_1 = require("./errors");
const middleware_1 = require("./auth/middleware");
const auth_1 = require("./routes/auth");
const customers_1 = require("./routes/customers");
const services_1 = require("./routes/services");
const technicians_1 = require("./routes/technicians");
const field_1 = require("./routes/field");
const bookings_1 = require("./routes/bookings");
const supervisors_1 = require("./routes/supervisors");
const finance_1 = require("./routes/finance");
const ratings_1 = require("./routes/ratings");
const shop_1 = require("./routes/shop");
const media_1 = require("./routes/media");
const requests_1 = require("./routes/requests");
const dashboard_1 = require("./routes/dashboard");
const users_1 = require("./routes/users");
const branches_1 = require("./routes/branches");
const onboarding_1 = require("./routes/onboarding");
const company_1 = require("./routes/company");
const platform_1 = require("./routes/platform");
const market_1 = require("./routes/market");
const openapi_1 = require("./openapi");
function createApp() {
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('trust proxy', 1); // behind IIS ARR / nginx
    // The default CSP adds "upgrade-insecure-requests", which blanks the page on a host that has no HTTPS certificate yet.
    // HTTPS is enforced by the host (IIS / the hosting panel), not by this header.
    app.use((0, helmet_1.default)({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null, 'img-src': ["'self'", 'data:', 'blob:', 'https:'] } }, hsts: false }));
    app.use((0, cors_1.default)({
        origin: (origin, cb) => {
            if (!origin || config_1.config.corsOrigins.includes(origin) || origin === 'https://localhost' || origin === 'capacitor://localhost')
                return cb(null, true);
            cb(null, false);
        },
    }));
    // Document uploads travel as base64 JSON (5 MB file ≈ 6.7 MB), so this one route gets a larger limit.
    app.use('/api/company/documents', express_1.default.json({ limit: '8mb' }));
    app.use('/api/field', express_1.default.json({ limit: '30mb' }));
    app.use('/api/bookings', express_1.default.json({ limit: '4mb' }));
    app.use('/api/technicians', express_1.default.json({ limit: '4mb' }));
    app.use('/api/media', express_1.default.json({ limit: '4mb' }));
    app.use('/api/market/companies', express_1.default.json({ limit: '4mb' }));
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use((0, express_rate_limit_1.default)({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, skip: () => config_1.config.env === 'test' }));
    const api = express_1.default.Router();
    api.get('/health', (0, errors_1.h)(async (_req, res) => {
        await (0, db_1.query)('SELECT 1 AS ok');
        res.json({ status: 'ok' });
    }));
    api.use('/auth', auth_1.authRouter);
    api.use('/onboarding', onboarding_1.onboardingRouter);
    api.use('/market', market_1.marketRouter);
    api.use('/media', media_1.mediaRouter);
    api.use('/shop', shop_1.shopRouter);
    api.use('/company', middleware_1.authenticate, company_1.companyRouter);
    api.use('/platform', middleware_1.authenticate, platform_1.platformRouter);
    api.use('/customers', middleware_1.authenticate, middleware_1.requireApprovedCompany, customers_1.customersRouter);
    api.use('/services', middleware_1.authenticate, middleware_1.requireApprovedCompany, services_1.servicesRouter);
    api.use('/technicians', middleware_1.authenticate, middleware_1.requireApprovedCompany, technicians_1.techniciansRouter);
    api.use('/field', middleware_1.authenticate, middleware_1.requireApprovedCompany, field_1.fieldRouter);
    api.use('/bookings', middleware_1.authenticate, middleware_1.requireApprovedCompany, bookings_1.bookingsRouter);
    api.use('/supervisors', middleware_1.authenticate, middleware_1.requireApprovedCompany, supervisors_1.supervisorsRouter);
    api.use('/ratings', middleware_1.authenticate, middleware_1.requireApprovedCompany, ratings_1.ratingsRouter);
    api.use('/finance', middleware_1.authenticate, middleware_1.requireApprovedCompany, finance_1.financeRouter);
    api.use('/requests', middleware_1.authenticate, middleware_1.requireApprovedCompany, requests_1.requestsRouter);
    api.use('/dashboard', middleware_1.authenticate, middleware_1.requireApprovedCompany, dashboard_1.dashboardRouter);
    api.use('/users', middleware_1.authenticate, middleware_1.requireApprovedCompany, users_1.usersRouter);
    api.use('/branches', middleware_1.authenticate, middleware_1.requireApprovedCompany, branches_1.branchesRouter);
    api.use((_req, _res, next) => next(new errors_1.HttpError(404, 'NOT_FOUND', 'Route not found')));
    // Docs must be mounted before the API router, whose catch-all 404 would otherwise swallow /api/docs.
    app.use('/api/docs', (0, helmet_1.default)({ contentSecurityPolicy: false }), swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(openapi_1.openapi));
    app.use('/api', api);
    // Single-site deployment (e.g. MonsterASP): serve the built web app from the same origin as the API.
    const webDir = process.env.FRONTEND_DIR ? node_path_1.default.resolve(process.env.FRONTEND_DIR) : node_path_1.default.resolve(__dirname, '..', 'frontend');
    if ((0, node_fs_1.existsSync)(node_path_1.default.join(webDir, 'index.html'))) {
        app.use(express_1.default.static(webDir, { index: false, maxAge: '1h' }));
        app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(node_path_1.default.join(webDir, 'index.html')));
    }
    app.use(errors_1.errorHandler);
    return app;
}
