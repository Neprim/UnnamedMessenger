function parseIntEnv(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

module.exports = {
  app: {
    port: parseIntEnv('PORT', 3000),
    isProduction: process.env.NODE_ENV === 'production',
    publicUrl: process.env.URL || '',
    corsOrigin: process.env.CORS_ORIGIN || process.env.URL || '',
    devFrontendOrigin: process.env.DEV_FRONTEND_ORIGIN || 'http://localhost:5173',
    bodyParserLimit: process.env.BODY_PARSER_LIMIT || '100mb'
  },
  ssl: {
    keyPath: process.env.SSL_KEY_PATH || 'ssl/server.key',
    certPath: process.env.SSL_CERT_PATH || 'ssl/server.crt'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  },
  cookie: {
    name: 'token',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: false
  },
  limits: {
    maxMessageLength: parseIntEnv('MAX_MESSAGE_LENGTH', 8000),
    maxUsernameLength: parseIntEnv('MAX_USERNAME_LENGTH', 30),
    maxAccountsPerIp: parseIntEnv('MAX_ACCOUNTS_PER_IP', 3),
    defaultFileQuotaBytes: parseIntEnv('DEFAULT_FILE_QUOTA_BYTES', 100 * 1024 * 1024),
    maxUploadBytes: parseIntEnv('MAX_UPLOAD_BYTES', 100 * 1024 * 1024),
    maxPlaceholderBytes: parseIntEnv('MAX_PLACEHOLDER_BYTES', 10 * 1024),
    avatarMaxBytes: parseIntEnv('AVATAR_MAX_BYTES', 5 * 1024 * 1024),
    avatarMinSize: parseIntEnv('AVATAR_MIN_SIZE', 128),
    avatarMaxSize: parseIntEnv('AVATAR_MAX_SIZE', 2048),
    avatarMaxRatio: parseIntEnv('AVATAR_MAX_RATIO', 4),
    avatarStorageSize: parseIntEnv('AVATAR_STORAGE_SIZE', 256)
  }
};
