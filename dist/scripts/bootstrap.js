"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrap = bootstrap;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const tenancy_1 = require("../services/tenancy");
/**
 * Creates the first company, branch, permissions, default roles and one administrator.
 * No credentials are hard-coded: the password must be supplied by the operator.
 * Safe to re-run: permissions/roles are upserted and the admin is only created for an empty company.
 */
async function bootstrap(i) {
    if (i.adminPassword.length < 12)
        throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    return (0, db_1.withTx)(async (tx) => {
        let company = (await (0, db_1.query)(`SELECT TOP 1 Id FROM Companies WHERE Name=@n AND IsDeleted=0`, { n: i.companyName }, tx))[0];
        if (!company) {
            company = (await (0, db_1.query)(`INSERT INTO Companies (Name) OUTPUT INSERTED.Id VALUES (@n)`, { n: i.companyName }, tx))[0];
        }
        const companyId = Number(company.Id);
        const branch = (await (0, db_1.query)(`SELECT Id FROM Branches WHERE CompanyId=@c AND Name=@n`, { c: companyId, n: i.branchName }, tx))[0];
        if (!branch)
            await (0, db_1.query)(`INSERT INTO Branches (CompanyId, Name) VALUES (@c,@n)`, { c: companyId, n: i.branchName }, tx);
        await (0, tenancy_1.ensureRoles)(tx, companyId);
        const existing = await (0, db_1.query)(`SELECT TOP 1 Id FROM Users WHERE CompanyId=@c AND IsDeleted=0`, { c: companyId }, tx);
        if (existing[0])
            return { companyId, adminId: null };
        const hash = await bcryptjs_1.default.hash(i.adminPassword, 12);
        const admin = (await (0, db_1.query)(`INSERT INTO Users (CompanyId, FullName, Email, PasswordHash) OUTPUT INSERTED.Id VALUES (@c,@n,@e,@p)`, { c: companyId, n: i.adminName, e: i.adminEmail.toLowerCase(), p: hash }, tx))[0];
        await (0, db_1.query)(`INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='System Administrator'`, { u: admin.Id, c: companyId }, tx);
        return { companyId, adminId: Number(admin.Id) };
    });
}
if (require.main === module) {
    const env = process.env;
    if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
        console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars) before running bootstrap.');
        process.exit(1);
    }
    bootstrap({
        companyName: env.COMPANY_NAME ?? 'NQ Cleaning',
        branchName: env.BRANCH_NAME ?? 'Main Branch',
        adminName: env.ADMIN_NAME ?? 'Administrator',
        adminEmail: env.ADMIN_EMAIL,
        adminPassword: env.ADMIN_PASSWORD,
    })
        .then((r) => console.log(r.adminId ? `Created administrator (user id ${r.adminId}).` : 'Company already has users; roles and permissions refreshed.'))
        .catch((e) => {
        console.error('Bootstrap failed:', e instanceof Error ? e.message : e);
        process.exit(1);
    })
        .finally(() => (0, db_1.closePool)());
}
