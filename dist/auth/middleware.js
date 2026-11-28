"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateCompanyStatus = void 0;
exports.signAccess = signAccess;
exports.authenticate = authenticate;
exports.requirePerm = requirePerm;
exports.branchScope = branchScope;
exports.requireApprovedCompany = requireApprovedCompany;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
function signAccess(u) {
    const payload = { sub: u.id, cid: u.companyId, bid: u.branchId, perms: u.perms };
    return jsonwebtoken_1.default.sign(payload, config_1.config.jwt.accessSecret, {
        algorithm: 'HS256',
        expiresIn: config_1.config.jwt.accessTtl,
    });
}
function authenticate(req, _res, next) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token)
        return next(new errors_1.HttpError(401, 'UNAUTHENTICATED', 'Missing access token'));
    try {
        const p = jsonwebtoken_1.default.verify(token, config_1.config.jwt.accessSecret, { algorithms: ['HS256'] });
        req.user = { id: p.sub, companyId: p.cid, branchId: p.bid, perms: p.perms };
        next();
    }
    catch {
        next(new errors_1.HttpError(401, 'INVALID_TOKEN', 'Invalid or expired access token'));
    }
}
/** Enforced on the server for every route; hiding buttons in the UI is never relied on. */
function requirePerm(...codes) {
    return (req, _res, next) => {
        const u = req.user;
        if (!u)
            return next(new errors_1.HttpError(401, 'UNAUTHENTICATED', 'Not signed in'));
        const missing = codes.filter((c) => !u.perms.includes(c));
        if (missing.length)
            return next(new errors_1.HttpError(403, 'FORBIDDEN', 'Insufficient permissions', { missing }));
        next();
    };
}
/** Branch the user is restricted to, or null when they may see every branch. */
function branchScope(u) {
    return u.perms.includes('branches.all') ? null : u.branchId;
}
const statusCache = new Map();
const invalidateCompanyStatus = (companyId) => void statusCache.delete(companyId);
exports.invalidateCompanyStatus = invalidateCompanyStatus;
/** Tenant APIs are only usable once the platform has approved the company (platform staff pass). */
async function requireApprovedCompany(req, _res, next) {
    try {
        const cid = req.user.companyId;
        let e = statusCache.get(cid);
        if (!e || Date.now() - e.at > 15_000) {
            const r = await (0, db_1.query)(`SELECT Status, IsPlatform FROM Companies WHERE Id=@c AND IsDeleted=0`, { c: cid });
            e = { status: r[0]?.Status ?? 'missing', platform: !!r[0]?.IsPlatform, at: Date.now() };
            statusCache.set(cid, e);
        }
        if (e.platform || e.status === 'approved')
            return next();
        next(new errors_1.HttpError(403, 'COMPANY_NOT_APPROVED', 'Company is not approved', { status: e.status }));
    }
    catch (err) {
        next(err);
    }
}
