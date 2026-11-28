"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
exports.loadPerms = loadPerms;
exports.issueRefresh = issueRefresh;
exports.createSession = createSession;
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const phone_1 = require("../lib/phone");
const otp_1 = require("../lib/otp");
const otp_2 = require("../services/otp");
exports.authRouter = (0, express_1.Router)();
const sha256 = (s) => (0, node_crypto_1.createHash)('sha256').update(s).digest('hex');
// Used to keep response time similar when the e-mail does not exist.
const DUMMY_HASH = bcryptjs_1.default.hashSync('not-a-real-password', 10);
async function loadPerms(userId, tx) {
    const rows = await (0, db_1.query)(`SELECT DISTINCT p.Code FROM UserRoles ur
     JOIN RolePermissions rp ON rp.RoleId = ur.RoleId
     JOIN Permissions p ON p.Id = rp.PermissionId
     WHERE ur.UserId = @uid`, { uid: userId }, tx);
    return rows.map((r) => r.Code);
}
async function issueRefresh(userId, tx) {
    const token = (0, node_crypto_1.randomBytes)(48).toString('base64url');
    const rows = await (0, db_1.query)(`INSERT INTO RefreshTokens (UserId, TokenHash, ExpiresAt)
     OUTPUT INSERTED.Id VALUES (@u, @h, DATEADD(DAY, @d, SYSUTCDATETIME()))`, { u: userId, h: sha256(token), d: config_1.config.jwt.refreshDays }, tx);
    return { token, id: Number(rows[0].Id) };
}
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});
exports.authRouter.post('/login', loginLimiter, (0, errors_1.h)(async (req, res) => {
    const raw = (0, errors_1.parse)(zod_1.z.object({ email: zod_1.z.string().trim().min(3).max(256), password: zod_1.z.string().min(1).max(200) }), req.body);
    // Field supervisors sign in with their mobile number (stored as <mobile>@field.local).
    const login = raw.email.toLowerCase();
    const body = { password: raw.password, email: /^05\d{8}$/.test(login) ? `${login}@field.local` : login };
    if (!body.email.includes('@'))
        throw new errors_1.HttpError(401, 'BAD_CREDENTIALS', 'Incorrect e-mail or password');
    const users = await (0, db_1.query)(`SELECT Id, CompanyId, BranchId, FullName, PasswordHash FROM Users
       WHERE Email = @e AND IsActive = 1 AND IsDeleted = 0`, { e: body.email.toLowerCase() });
    let matched;
    if (users.length === 0) {
        await bcryptjs_1.default.compare(body.password, DUMMY_HASH);
    }
    for (const u of users) {
        if (await bcryptjs_1.default.compare(body.password, u.PasswordHash)) {
            matched = u;
            break;
        }
    }
    if (!matched)
        throw new errors_1.HttpError(401, 'BAD_CREDENTIALS', 'Incorrect e-mail or password');
    const perms = await loadPerms(matched.Id);
    const user = { id: matched.Id, companyId: matched.CompanyId, branchId: matched.BranchId, perms };
    const refresh = await (0, db_1.withTx)((tx) => issueRefresh(user.id, tx));
    await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'login','User',@e)`, {
        c: user.companyId, u: user.id, e: String(user.id),
    });
    res.json({
        accessToken: (0, middleware_1.signAccess)(user),
        refreshToken: refresh.token,
        user: { id: user.id, name: matched.FullName, companyId: user.companyId, branchId: user.branchId, perms },
    });
}));
exports.authRouter.post('/refresh', (0, errors_1.h)(async (req, res) => {
    const { refreshToken } = (0, errors_1.parse)(zod_1.z.object({ refreshToken: zod_1.z.string().min(20).max(200) }), req.body);
    const out = await (0, db_1.withTx)(async (tx) => {
        const rows = await (0, db_1.query)(`SELECT Id, UserId, ExpiresAt, RevokedAt FROM RefreshTokens WITH (UPDLOCK) WHERE TokenHash = @h`, { h: sha256(refreshToken) }, tx);
        const row = rows[0];
        if (!row)
            throw new errors_1.HttpError(401, 'INVALID_REFRESH', 'Invalid refresh token');
        if (row.RevokedAt) {
            // A rotated token was presented again: assume theft and revoke every session of that user.
            await (0, db_1.query)(`UPDATE RefreshTokens SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @u AND RevokedAt IS NULL`, { u: row.UserId }, tx);
            return { reuse: true };
        }
        if (row.ExpiresAt.getTime() < Date.now())
            throw new errors_1.HttpError(401, 'INVALID_REFRESH', 'Refresh token expired');
        const users = await (0, db_1.query)(`SELECT Id, CompanyId, BranchId FROM Users WHERE Id = @u AND IsActive = 1 AND IsDeleted = 0`, { u: row.UserId }, tx);
        if (!users[0])
            throw new errors_1.HttpError(401, 'INVALID_REFRESH', 'User is inactive');
        const next = await issueRefresh(row.UserId, tx);
        await (0, db_1.query)(`UPDATE RefreshTokens SET RevokedAt = SYSUTCDATETIME(), ReplacedBy = @n WHERE Id = @i`, { n: next.id, i: row.Id }, tx);
        const perms = await loadPerms(row.UserId, tx);
        const user = { id: users[0].Id, companyId: users[0].CompanyId, branchId: users[0].BranchId, perms };
        return { reuse: false, accessToken: (0, middleware_1.signAccess)(user), refreshToken: next.token };
    });
    if (out.reuse)
        throw new errors_1.HttpError(401, 'REFRESH_REUSE', 'Refresh token was already used; sign in again');
    res.json({ accessToken: out.accessToken, refreshToken: out.refreshToken });
}));
exports.authRouter.post('/logout', (0, errors_1.h)(async (req, res) => {
    const { refreshToken } = (0, errors_1.parse)(zod_1.z.object({ refreshToken: zod_1.z.string().min(20).max(200) }), req.body);
    await (0, db_1.query)(`UPDATE RefreshTokens SET RevokedAt = SYSUTCDATETIME() WHERE TokenHash = @h AND RevokedAt IS NULL`, { h: sha256(refreshToken) });
    res.status(204).end();
}));
exports.authRouter.get('/me', middleware_1.authenticate, (0, errors_1.h)(async (req, res) => {
    const u = req.user;
    const rows = await (0, db_1.query)(`SELECT u.Id, u.FullName, u.Email, u.BranchId, c.Name AS CompanyName, c.Status AS CompanyStatus, c.IsPlatform
         FROM Users u JOIN Companies c ON c.Id = u.CompanyId WHERE u.Id = @i AND u.CompanyId = @c`, { i: u.id, c: u.companyId });
    res.json({ ...rows[0], perms: u.perms });
}));
/** Opens a session (access + refresh token) for an already-verified user. */
async function createSession(userId) {
    const rows = await (0, db_1.query)(`SELECT Id, CompanyId, BranchId, FullName FROM Users WHERE Id=@u AND IsActive=1 AND IsDeleted=0`, { u: userId });
    const u = rows[0];
    if (!u)
        throw new errors_1.HttpError(401, 'BAD_CREDENTIALS', 'Account not available');
    const perms = await loadPerms(u.Id);
    const user = { id: u.Id, companyId: u.CompanyId, branchId: u.BranchId, perms };
    const refresh = await (0, db_1.withTx)((tx) => issueRefresh(user.id, tx));
    return {
        accessToken: (0, middleware_1.signAccess)(user),
        refreshToken: refresh.token,
        user: { id: user.id, name: u.FullName, companyId: user.companyId, branchId: user.branchId, perms },
    };
}
const otpLimiter = (0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
const phoneSchema = zod_1.z.string().min(9).max(20).transform(phone_1.normalizeMobile).refine(otp_1.isSaudiMobile, 'Invalid mobile number');
/** Always answers 200 so the endpoint cannot be used to discover which numbers have accounts. */
exports.authRouter.post('/otp/request', otpLimiter, (0, errors_1.h)(async (req, res) => {
    if (!config_1.config.otp.required)
        throw new errors_1.HttpError(404, 'OTP_DISABLED', 'Phone sign-in is not enabled');
    const { phone } = (0, errors_1.parse)(zod_1.z.object({ phone: phoneSchema }), req.body);
    const u = await (0, db_1.query)(`SELECT TOP 1 Id FROM Users WHERE Phone=@p AND IsActive=1 AND IsDeleted=0`, { p: phone });
    let devCode;
    if (u[0]) {
        try {
            devCode = (await (0, otp_2.requestOtp)(phone, 'login', req.ip ?? null)).devCode;
        }
        catch (e) {
            if (!(e instanceof errors_1.HttpError && e.status === 429))
                throw e; // do not reveal that the number has an account
        }
    }
    res.json({ sent: true, ...(devCode ? { devCode } : {}) });
}));
exports.authRouter.post('/otp/verify', otpLimiter, (0, errors_1.h)(async (req, res) => {
    if (!config_1.config.otp.required)
        throw new errors_1.HttpError(404, 'OTP_DISABLED', 'Phone sign-in is not enabled');
    const b = (0, errors_1.parse)(zod_1.z.object({ phone: phoneSchema, code: zod_1.z.string().regex(/^\d{6}$/) }), req.body);
    await (0, otp_2.verifyOtp)(b.phone, 'login', b.code);
    const u = (await (0, db_1.query)(`SELECT TOP 1 Id FROM Users WHERE Phone=@p AND IsActive=1 AND IsDeleted=0`, { p: b.phone }))[0];
    if (!u)
        throw new errors_1.HttpError(400, 'OTP_INVALID', 'Invalid or expired code');
    res.json(await createSession(u.Id));
}));
