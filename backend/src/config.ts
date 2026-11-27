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
  appUrl: (process.env.APP_URL ?? '').replace(/\/$/, ''),
  otp: {
    /** PHONE_VERIFICATION=0 turns the SMS/WhatsApp code requirement off (company sign-up and phone login). On by default. */
    get required(): boolean {
      return process.env.PHONE_VERIFICATION !== '0';
    },
    ttlSeconds: 300,
    cooldownSeconds: 60,
    maxPerHour: 5,
    maxAttempts: 5,
    /** Returns the code in the API response. Never honoured in production. */
    get devMode(): boolean {
      return process.env.OTP_DEV_MODE === '1' && (process.env.NODE_ENV ?? 'development') !== 'production';
    },
  },
  extract: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  },
  notify: {
    provider: process.env.NOTIFY_PROVIDER ?? 'dev', // 'dev' | 'whatsapp'
    whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
    whatsappPhoneId: process.env.WHATSAPP_PHONE_ID ?? '',
    whatsappLang: process.env.WHATSAPP_LANG ?? 'ar',
    otpTemplate: process.env.WHATSAPP_OTP_TEMPLATE ?? 'nq_otp',
    approvedTemplate: process.env.WHATSAPP_APPROVED_TEMPLATE ?? 'nq_company_approved',
    rejectedTemplate: process.env.WHATSAPP_REJECTED_TEMPLATE ?? 'nq_company_rejected',
    orderConfirmedTemplate: process.env.WHATSAPP_ORDER_CONFIRMED_TEMPLATE ?? 'faz3tak_order_confirmed',
  },
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
