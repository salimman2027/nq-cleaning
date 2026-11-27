import type sql from 'mssql';
import { query } from '../db';
import { PERMISSIONS, PLATFORM_ROLE_DEFS, ROLE_DEFS } from '../permissions';

export async function ensurePermissions(tx: sql.Transaction): Promise<void> {
  for (const code of PERMISSIONS) {
    await query(`IF NOT EXISTS (SELECT 1 FROM Permissions WHERE Code=@c) INSERT INTO Permissions (Code) VALUES (@c)`, { c: code }, tx);
  }
}

/** Upserts roles and their permissions for one company. Tenant companies get ROLE_DEFS, the platform gets PLATFORM_ROLE_DEFS. */
export async function ensureRoles(tx: sql.Transaction, companyId: number, platform = false): Promise<void> {
  await ensurePermissions(tx);
  for (const [name, perms] of Object.entries(platform ? PLATFORM_ROLE_DEFS : ROLE_DEFS)) {
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
}
