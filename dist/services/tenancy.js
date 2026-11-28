"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePermissions = ensurePermissions;
exports.ensureRoles = ensureRoles;
const db_1 = require("../db");
const permissions_1 = require("../permissions");
async function ensurePermissions(tx) {
    for (const code of permissions_1.PERMISSIONS) {
        await (0, db_1.query)(`IF NOT EXISTS (SELECT 1 FROM Permissions WHERE Code=@c) INSERT INTO Permissions (Code) VALUES (@c)`, { c: code }, tx);
    }
}
/** Upserts roles and their permissions for one company. Tenant companies get ROLE_DEFS, the platform gets PLATFORM_ROLE_DEFS. */
async function ensureRoles(tx, companyId, platform = false) {
    await ensurePermissions(tx);
    for (const [name, perms] of Object.entries(platform ? permissions_1.PLATFORM_ROLE_DEFS : permissions_1.ROLE_DEFS)) {
        await (0, db_1.query)(`IF NOT EXISTS (SELECT 1 FROM Roles WHERE CompanyId=@c AND Name=@n) INSERT INTO Roles (CompanyId, Name) VALUES (@c,@n)`, { c: companyId, n: name }, tx);
        const role = (await (0, db_1.query)(`SELECT Id FROM Roles WHERE CompanyId=@c AND Name=@n`, { c: companyId, n: name }, tx))[0];
        for (const p of perms) {
            await (0, db_1.query)(`IF NOT EXISTS (SELECT 1 FROM RolePermissions rp JOIN Permissions p ON p.Id=rp.PermissionId WHERE rp.RoleId=@r AND p.Code=@p)
           INSERT INTO RolePermissions (RoleId, PermissionId) SELECT @r, Id FROM Permissions WHERE Code=@p`, { r: role.Id, p }, tx);
        }
    }
}
