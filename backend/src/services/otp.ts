import { config } from '../config';
import { applock, query, withTx } from '../db';
import { HttpError } from '../errors';
import { generateCode, hashCode, safeEqualHex } from '../lib/otp';
import { deliveryConfigured, send } from './notify';

export type OtpPurpose = 'company_register' | 'login' | 'customer_login';

const secret = () => config.jwt.accessSecret;

/** Creates and sends a code. Returns the code only in non-production dev mode. */
export async function requestOtp(phone: string, purpose: OtpPurpose, ip: string | null): Promise<{ devCode?: string }> {
  if (!config.otp.devMode && !deliveryConfigured()) {
    throw new HttpError(503, 'NOTIFY_NOT_CONFIGURED', 'Message delivery is not configured');
  }
  const code = generateCode();
  await withTx(async (tx) => {
    await applock(tx, `otp:${purpose}:${phone}`);
    const recent = await query<{ Secs: number }>(
      `SELECT TOP 1 DATEDIFF(SECOND, CreatedAt, SYSUTCDATETIME()) AS Secs FROM OtpCodes WHERE Phone=@p AND Purpose=@pu ORDER BY CreatedAt DESC`,
      { p: phone, pu: purpose },
      tx,
    );
    if (recent[0] && recent[0].Secs < config.otp.cooldownSeconds) {
      throw new HttpError(429, 'OTP_COOLDOWN', 'Please wait before requesting another code', { retryAfter: config.otp.cooldownSeconds - recent[0].Secs });
    }
    const hourly = await query<{ N: number }>(
      `SELECT COUNT(*) AS N FROM OtpCodes WHERE Phone=@p AND CreatedAt > DATEADD(HOUR,-1,SYSUTCDATETIME())`,
      { p: phone },
      tx,
    );
    if (hourly[0].N >= config.otp.maxPerHour) throw new HttpError(429, 'OTP_LIMIT', 'Too many codes requested; try again later');
    await query(
      `INSERT INTO OtpCodes (Phone, Purpose, CodeHash, ExpiresAt, Ip) VALUES (@p,@pu,@h,DATEADD(SECOND,@ttl,SYSUTCDATETIME()),@ip)`,
      { p: phone, pu: purpose, h: hashCode(secret(), phone, purpose, code), ttl: config.otp.ttlSeconds, ip: ip?.slice(0, 64) ?? null },
      tx,
    );
  });
  await send(phone, 'otp', [code]);
  return config.otp.devMode ? { devCode: code } : {};
}

/** Verifies and consumes a code. Wrong guesses are persisted (own transaction) so attempts cannot be reset by a rollback. */
export async function verifyOtp(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
  const result = await withTx(async (tx) => {
    const rows = await query<{ Id: number; CodeHash: string; Attempts: number }>(
      `SELECT TOP 1 Id, CodeHash, Attempts FROM OtpCodes WITH (UPDLOCK, ROWLOCK)
        WHERE Phone=@p AND Purpose=@pu AND ConsumedAt IS NULL AND ExpiresAt > SYSUTCDATETIME() ORDER BY CreatedAt DESC`,
      { p: phone, pu: purpose },
      tx,
    );
    const row = rows[0];
    if (!row || row.Attempts >= config.otp.maxAttempts) return 'invalid' as const;
    if (!safeEqualHex(row.CodeHash, hashCode(secret(), phone, purpose, code))) {
      await query(`UPDATE OtpCodes SET Attempts = Attempts + 1 WHERE Id=@i`, { i: row.Id }, tx);
      return 'invalid' as const;
    }
    await query(`UPDATE OtpCodes SET ConsumedAt = SYSUTCDATETIME() WHERE Id=@i`, { i: row.Id }, tx);
    return 'ok' as const;
  });
  if (result !== 'ok') throw new HttpError(400, 'OTP_INVALID', 'Invalid or expired code');
}

