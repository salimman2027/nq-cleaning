"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapPlatform = bootstrapPlatform;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const tenancy_1 = require("../services/tenancy");
/** Creates the platform operator company and its first Platform Admin. Safe to re-run. */
async function bootstrapPlatform(i) {
    if (i.adminPassword.length < 12)
        throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    return (0, db_1.withTx)(async (tx) => {
        let co = (await (0, db_1.query)(`SELECT TOP 1 Id FROM Companies WHERE IsPlatform=1 AND IsDeleted=0`, {}, tx))[0];
        if (!co)
            co = (await (0, db_1.query)(`INSERT INTO Companies (Name, IsPlatform, Status) OUTPUT INSERTED.Id VALUES (@n, 1, 'approved')`, { n: i.name ?? 'NQ Platform' }, tx))[0];
        const companyId = Number(co.Id);
        await (0, tenancy_1.ensureRoles)(tx, companyId, true);
        const email = i.adminEmail.toLowerCase();
        const exists = await (0, db_1.query)(`SELECT TOP 1 Id, CompanyId, PasswordHash FROM Users WHERE Email=@e AND IsDeleted=0`, { e: email }, tx);
        if (exists[0]) {
            const roleSql = `INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='Platform Admin'`;
            if (Number(exists[0].CompanyId) === companyId)
                return { companyId, adminId: null };
            // The same e-mail was used by the first (pre-marketplace) setup. Move that account to the platform only when the
            // supplied password proves it is the same operator; its old company is left untouched and empty of this user.
            if (!(await bcryptjs_1.default.compare(i.adminPassword, exists[0].PasswordHash))) {
                throw new Error('ADMIN_EMAIL belongs to an existing company user and ADMIN_PASSWORD does not match it. Use the same password, or a different e-mail.');
            }
            await (0, db_1.query)(`DELETE FROM RefreshTokens WHERE UserId=@u`, { u: exists[0].Id }, tx);
            await (0, db_1.query)(`DELETE FROM UserRoles WHERE UserId=@u`, { u: exists[0].Id }, tx);
            await (0, db_1.query)(`UPDATE Users SET CompanyId=@c, BranchId=NULL WHERE Id=@u`, { c: companyId, u: exists[0].Id }, tx);
            await (0, db_1.query)(roleSql, { u: exists[0].Id, c: companyId }, tx);
            return { companyId, adminId: Number(exists[0].Id) };
        }
        const u = (await (0, db_1.query)(`INSERT INTO Users (CompanyId, FullName, Email, PasswordHash) OUTPUT INSERTED.Id VALUES (@c,@n,@e,@p)`, { c: companyId, n: i.adminName ?? 'Platform Admin', e: email, p: await bcryptjs_1.default.hash(i.adminPassword, 12) }, tx))[0];
        await (0, db_1.query)(`INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='Platform Admin'`, { u: u.Id, c: companyId }, tx);
        return { companyId, adminId: Number(u.Id) };
    });
}
if (require.main === module) {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars).');
        process.exit(1);
    }
    bootstrapPlatform({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD })
        .then((r) => console.log(r.adminId ? `Created platform admin (user id ${r.adminId}).` : 'Platform admin already exists; roles refreshed.'))
        .catch((e) => {
        console.error('Bootstrap failed:', e instanceof Error ? e.message : e);
        process.exit(1);
    })
        .finally(() => (0, db_1.closePool)());
}
