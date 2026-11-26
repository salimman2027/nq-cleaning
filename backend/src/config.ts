import 'dotenv/config';

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable ${key}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  travelBufferMinutes: Number(process.env.TRAVEL_BUFFER_MINUTES ?? 30),
  db: {
    server: process.env.DB_SERVER ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 1433),
    database: process.env.DB_NAME ?? 'NQCleaning',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    encrypt: (process.env.DB_ENCRYPT ?? 'true') === 'true',
    trustServerCertificate: (process.env.DB_TRUST_SERVER_CERT ?? 'false') === 'true',
  },
  jwt: {
    get accessSecret(): string {
      const s = need('JWT_ACCESS_SECRET');
      if (s.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
      return s;
    },
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshDays: Number(process.env.JWT_REFRESH_DAYS ?? 7),
  },
};
