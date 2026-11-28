"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAdminPassword = resetAdminPassword;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
/** Sets a new password for an existing platform admin and signs that account out everywhere. Run from GitHub Actions. */
async function resetAdminPassword(email, password) {
    if (password.length < 12)
        throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    const u = (await (0, db_1.query)(`SELECT TOP 1 u.Id FROM Users u JOIN Companies c ON c.Id=u.CompanyId WHERE u.Email=@e AND u.IsDeleted=0 AND c.IsPlatform=1`, { e: email.toLowerCase() }))[0];
    if (!u)
        throw new Error('No platform admin with this e-mail');
    await (0, db_1.query)(`UPDATE Users SET PasswordHash=@h WHERE Id=@i`, { h: await bcryptjs_1.default.hash(password, 12), i: u.Id });
    await (0, db_1.query)(`DELETE FROM RefreshTokens WHERE UserId=@i`, { i: u.Id });
    return Number(u.Id);
}
if (require.main === module) {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.');
        process.exit(1);
    }
    resetAdminPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
        .then((id) => console.log(`Password reset for platform admin (user id ${id}). Sessions revoked.`))
        .catch((e) => { console.error('Reset failed:', e instanceof Error ? e.message : e); process.exit(1); })
        .finally(() => (0, db_1.closePool)());
}
