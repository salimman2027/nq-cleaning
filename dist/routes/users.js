"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
exports.usersRouter = (0, express_1.Router)();
exports.usersRouter.use((0, middleware_1.requirePerm)('users.manage'));
exports.usersRouter.get('/', (0, errors_1.h)(async (req, res) => {
    const rows = await (0, db_1.query)(`SELECT u.Id, u.FullName, u.Email, u.BranchId, u.IsActive,
              (SELECT STRING_AGG(r.Name, ', ') FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId WHERE ur.UserId=u.Id) AS Roles
         FROM Users u WHERE u.CompanyId=@c AND u.IsDeleted=0 ORDER BY u.FullName`, { c: req.user.companyId });
    res.json({ items: rows });
}));
exports.usersRouter.get('/roles', (0, errors_1.h)(async (req, res) => {
    res.json({ items: await (0, db_1.query)(`SELECT Id, Name FROM Roles WHERE CompanyId=@c ORDER BY Name`, { c: req.user.companyId }) });
}));
exports.usersRouter.post('/', (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({
        fullName: zod_1.z.string().min(2).max(200),
        email: zod_1.z.string().email().max(256),
        password: zod_1.z.string().min(12).max(200),
        branchId: zod_1.z.number().int().positive().nullable().default(null),
        roleIds: zod_1.z.array(zod_1.z.number().int().positive()).min(1).max(5),
    }), req.body);
    const c = req.user.companyId;
    const id = await (0, db_1.withTx)(async (tx) => {
        const roles = await (0, db_1.query)(`SELECT Id FROM Roles WHERE CompanyId=@c AND Id IN (${b.roleIds.map((_, i) => `@r${i}`).join(',')})`, { c, ...Object.fromEntries(b.roleIds.map((r, i) => [`r${i}`, r])) }, tx);
        if (roles.length !== new Set(b.roleIds).size)
            throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown role');
        if (b.branchId) {
            const br = await (0, db_1.query)(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: b.branchId, c }, tx);
            if (!br[0])
                throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
        }
        const hash = await bcryptjs_1.default.hash(b.password, 12);
        const r = await (0, db_1.query)(`INSERT INTO Users (CompanyId, BranchId, FullName, Email, PasswordHash, CreatedBy) OUTPUT INSERTED.Id VALUES (@c,@b,@n,@e,@p,@u)`, { c, b: b.branchId, n: b.fullName, e: b.email.toLowerCase(), p: hash, u: req.user.id }, tx);
        const uid = Number(r[0].Id);
        for (const rid of new Set(b.roleIds))
            await (0, db_1.query)(`INSERT INTO UserRoles (UserId, RoleId) VALUES (@u,@r)`, { u: uid, r: rid }, tx);
        await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','User',@e)`, { c, u: req.user.id, e: String(uid) }, tx);
        return uid;
    });
    res.status(201).json({ id });
}));
exports.usersRouter.patch('/:id/active', (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const { isActive } = (0, errors_1.parse)(zod_1.z.object({ isActive: zod_1.z.boolean() }), req.body);
    if (id === req.user.id && !isActive)
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'You cannot deactivate yourself');
    const r = await (0, db_1.query)(`UPDATE Users SET IsActive=@a, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { a: isActive, u: req.user.id, i: id, c: req.user.companyId });
    if (!r[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'User not found');
    if (!isActive)
        await (0, db_1.query)(`UPDATE RefreshTokens SET RevokedAt=SYSUTCDATETIME() WHERE UserId=@i AND RevokedAt IS NULL`, { i: id });
    res.json({ id, isActive });
}));
