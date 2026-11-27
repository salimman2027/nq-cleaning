import bcrypt from 'bcryptjs';
import { closePool, query, withTx } from '../db';
import { ensureRoles } from '../services/tenancy';

/** Creates the platform operator company and its first Platform Admin. Safe to re-run. */
export async function bootstrapPlatform(i: { name?: string; adminName?: string; adminEmail: string; adminPassword: string }) {
  if (i.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  return withTx(async (tx) => {
    let co = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM Companies WHERE IsPlatform=1 AND IsDeleted=0`, {}, tx))[0];
    if (!co) co = (await query<{ Id: number }>(`INSERT INTO Companies (Name, IsPlatform, Status) OUTPUT INSERTED.Id VALUES (@n, 1, 'approved')`, { n: i.name ?? 'NQ Platform' }, tx))[0];
    const companyId = Number(co.Id);
    await ensureRoles(tx, companyId, true);
    const email = i.adminEmail.toLowerCase();
    const exists = await query(`SELECT TOP 1 Id FROM Users WHERE Email=@e AND IsDeleted=0`, { e: email }, tx);
    if (exists[0]) {
      const same = await query(`SELECT 1 AS x FROM Users WHERE Id=@i AND CompanyId=@c`, { i: exists[0].Id, c: companyId }, tx);
      if (!same[0]) throw new Error('ADMIN_EMAIL is already used by a company user. Use a different e-mail for the platform admin.');
      return { companyId, adminId: null };
    }
    const u = (await query<{ Id: number }>(
      `INSERT INTO Users (CompanyId, FullName, Email, PasswordHash) OUTPUT INSERTED.Id VALUES (@c,@n,@e,@p)`,
      { c: companyId, n: i.adminName ?? 'Platform Admin', e: email, p: await bcrypt.hash(i.adminPassword, 12) },
      tx,
    ))[0];
    await query(`INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='Platform Admin'`, { u: u.Id, c: companyId }, tx);
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
    .finally(() => closePool());
}
