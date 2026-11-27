import bcrypt from 'bcryptjs';
import { closePool, query } from '../db';

/** Sets a new password for an existing platform admin and signs that account out everywhere. Run from GitHub Actions. */
export async function resetAdminPassword(email: string, password: string): Promise<number> {
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  const u = (await query<{ Id: number }>(
    `SELECT TOP 1 u.Id FROM Users u JOIN Companies c ON c.Id=u.CompanyId WHERE u.Email=@e AND u.IsDeleted=0 AND c.IsPlatform=1`,
    { e: email.toLowerCase() },
  ))[0];
  if (!u) throw new Error('No platform admin with this e-mail');
  await query(`UPDATE Users SET PasswordHash=@h WHERE Id=@i`, { h: await bcrypt.hash(password, 12), i: u.Id });
  await query(`DELETE FROM RefreshTokens WHERE UserId=@i`, { i: u.Id });
  return Number(u.Id);
}

if (require.main === module) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.'); process.exit(1); }
  resetAdminPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
    .then((id) => console.log(`Password reset for platform admin (user id ${id}). Sessions revoked.`))
    .catch((e) => { console.error('Reset failed:', e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => closePool());
}
