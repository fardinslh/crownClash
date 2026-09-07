export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  nodeEnv: string;
  clientOrigins: string[];
  /** Allows unauthenticated browser/dev guest logins. Must stay false in production. */
  allowGuestAuth: boolean;
  telegramBotToken?: string;
  baleBotToken?: string;
  /** Reject initData older than this to prevent replay of stale login payloads. */
  initDataMaxAgeSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || 'development';

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret && nodeEnv === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }

  const allowGuestAuth =
    env.ALLOW_GUEST_AUTH !== undefined ? env.ALLOW_GUEST_AUTH === 'true' : nodeEnv !== 'production';
  const clientOrigins = (
    env.CLIENT_ORIGINS ||
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port: Number(env.PORT) || 8787,
    databaseUrl,
    jwtSecret: jwtSecret || 'dev-insecure-secret-change-me',
    nodeEnv,
    clientOrigins,
    allowGuestAuth,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    baleBotToken: env.BALE_BOT_TOKEN,
    initDataMaxAgeSeconds: Number(env.INIT_DATA_MAX_AGE_SECONDS) || 86400,
  };
}
