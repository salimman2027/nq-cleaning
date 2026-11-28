"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onboardingRouter = void 0;
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
const otp_1 = require("../lib/otp");
const phone_1 = require("../lib/phone");
const company_1 = require("../lib/company");
const otp_2 = require("../services/otp");
const tenancy_1 = require("../services/tenancy");
const auth_1 = require("./auth");
exports.onboardingRouter = (0, express_1.Router)();
const limiter = (0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
const phoneSchema = zod_1.z.string().min(9).max(20).transform(phone_1.normalizeMobile).refine(otp_1.isSaudiMobile, 'Invalid mobile number');
async function assertFree(phone, email) {
    const p = await (0, db_1.query)(`SELECT TOP 1 1 AS x FROM Users WHERE Phone=@p AND IsDeleted=0 UNION ALL SELECT TOP 1 1 FROM Companies WHERE Phone=@p AND IsDeleted=0`, { p: phone });
    if (p.length)
        throw new errors_1.HttpError(409, 'PHONE_TAKEN', 'This mobile number is already registered');
    if (email) {
        const e = await (0, db_1.query)(`SELECT TOP 1 1 AS x FROM Users WHERE Email=@e AND IsDeleted=0`, { e: email });
        if (e.length)
            throw new errors_1.HttpError(409, 'EMAIL_TAKEN', 'This e-mail is already registered');
    }
}
exports.onboardingRouter.post('/otp/request', limiter, (0, errors_1.h)(async (req, res) => {
    const { phone } = (0, errors_1.parse)(zod_1.z.object({ phone: phoneSchema }), req.body);
    await assertFree(phone);
    if (!config_1.config.otp.required)
        return void res.json({ sent: false, required: false });
    const out = await (0, otp_2.requestOtp)(phone, 'company_register', req.ip ?? null);
    res.json({ sent: true, ...out });
}));
exports.onboardingRouter.post('/register', limiter, (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({
        phone: phoneSchema,
        code: zod_1.z.string().regex(/^\d{6}$/).optional(),
        companyName: zod_1.z.string().trim().min(2).max(200),
        ownerName: zod_1.z.string().trim().min(2).max(200),
        email: zod_1.z.string().email().max(256).transform((s) => s.toLowerCase()),
        password: zod_1.z.string().min(10).max(200),
        sectorCodes: zod_1.z.array(zod_1.z.string().max(40)).min(1).max(3),
    }), req.body);
    await assertFree(b.phone, b.email);
    const sectors = await (0, db_1.query)(`SELECT Id FROM Sectors WHERE IsActive=1 AND Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))`, { codes: b.sectorCodes.join(',') });
    if (sectors.length !== new Set(b.sectorCodes).size)
        throw new errors_1.HttpError(400, 'UNKNOWN_SECTOR', 'Unknown sector');
    if (config_1.config.otp.required) {
        if (!b.code)
            throw new errors_1.HttpError(400, 'OTP_INVALID', 'Verification code is required');
        await (0, otp_2.verifyOtp)(b.phone, 'company_register', b.code);
    }
    const hash = await bcryptjs_1.default.hash(b.password, 12);
    const ownerId = await (0, db_1.withTx)(async (tx) => {
        const co = (await (0, db_1.query)(`INSERT INTO Companies (Name, Slug, Phone, Status) OUTPUT INSERTED.Id VALUES (@n, @s, @p, 'draft')`, { n: b.companyName, s: (0, company_1.newSlug)((0, node_crypto_1.randomBytes)(4).toString('hex')), p: b.phone }, tx))[0];
        const companyId = Number(co.Id);
        await (0, db_1.query)(`INSERT INTO Branches (CompanyId, Name) VALUES (@c, N'Main')`, { c: companyId }, tx);
        await (0, tenancy_1.ensureRoles)(tx, companyId);
        for (const s of sectors)
            await (0, db_1.query)(`INSERT INTO CompanySectors (CompanyId, SectorId) VALUES (@c,@s)`, { c: companyId, s: s.Id }, tx);
        const u = (await (0, db_1.query)(`INSERT INTO Users (CompanyId, FullName, Email, PasswordHash, Phone) OUTPUT INSERTED.Id VALUES (@c,@n,@e,@h,@p)`, { c: companyId, n: b.ownerName, e: b.email, h: hash, p: b.phone }, tx))[0];
        await (0, db_1.query)(`INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='Company Owner'`, { u: u.Id, c: companyId }, tx);
        await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'company.register','Company',@e)`, { c: companyId, u: u.Id, e: String(companyId) }, tx);
        return Number(u.Id);
    });
    res.status(201).json(await (0, auth_1.createSession)(ownerId));
}));
