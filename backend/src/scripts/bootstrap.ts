import bcrypt from 'bcryptjs';
import { closePool, query, withTx } from '../db';
import { PERMISSIONS, ROLE_DEFS } from '../permissions';

export interface BootstrapInput {
  companyName: string;
  branchName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

/**
 * Creates the first company, branch, permissions, default roles and one administrator.
 * No credentials are hard-coded: the password must be supplied by the operator.
 * Safe to re-run: permissions/roles are upserted and the admin is only created for an empty company.
 */
export async function bootstrap(i: BootstrapInput): Promise<{ companyId: number; adminId: number | null }> {
  if (i.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  return withTx(async (tx) => {
    let company = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM Companies WHERE Name=@n AND IsDeleted=0`, { n: i.companyName }, tx))[0];
    if (!company) {
      company = (await query<{ Id: number }>(`INSERT INTO Companies (Name) OUTPUT INSERTED.Id VALUES (@n)`, { n: i.companyName }, tx))[0];
    }
    const companyId = Number(company.Id);
    const branch = (await query(`SELECT Id FROM Branches WHERE CompanyId=@c AND Name=@n`, { c: companyId, n: i.branchName }, tx))[0];
    if (!branch) await query(`INSERT INTO Branches (CompanyId, Name) VALUES (@c,@n)`, { c: companyId, n: i.branchName }, tx);

    for (const code of PERMISSIONS) {
      await query(`IF NOT EXISTS (SELECT 1 FROM Permissions WHERE Code=@c) INSERT INTO Permissions (Code) VALUES (@c)`, { c: code }, tx);
    }
    for (const [name, perms] of Object.entries(ROLE_DEFS)) {
      await query(`IF NOT EXISTS (SELECT 1 FROM Roles WHERE CompanyId=@c AND Name=@n) INSERT INTO Roles (CompanyId, Name) VALUES (@c,@n)`, { c: companyId, n: name }, tx);
      const role = (await query<{ Id: number }>(`SELECT Id FROM Roles WHERE CompanyId=@c AND Name=@n`, { c: companyId, n: name }, tx))[0];
      for (const p of perms) {
        await query(
          `IF NOT EXISTS (SELECT 1 FROM RolePermissions rp JOIN Permissions p ON p.Id=rp.PermissionId WHERE rp.RoleId=@r AND p.Code=@p)
             INSERT INTO RolePermissions (RoleId, PermissionId) SELECT @r, Id FROM Permissions WHERE Code=@p`,
          { r: role.Id, p },
          tx,
        );
      }
    }

    const existing = await query(`SELECT TOP 1 Id FROM Users WHERE CompanyId=@c AND IsDeleted=0`, { c: companyId }, tx);
    if (existing[0]) return { companyId, adminId: null };
    const hash = await bcrypt.hash(i.adminPassword, 12);
    const admin = (await query<{ Id: number }>(
      `INSERT INTO Users (CompanyId, FullName, Email, PasswordHash) OUTPUT INSERTED.Id VALUES (@c,@n,@e,@p)`,
      { c: companyId, n: i.adminName, e: i.adminEmail.toLowerCase(), p: hash },
      tx,
    ))[0];
    await query(`INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='System Administrator'`, { u: admin.Id, c: companyId }, tx);
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
    .finally(() => closePool());
}
