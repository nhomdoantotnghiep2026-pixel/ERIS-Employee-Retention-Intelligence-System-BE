const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getPort(value, variableName) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${variableName} must be a valid port number.`);
  }

  return port;
}

function getPositiveInteger(value, variableName) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsedValue;
}

function getBoolean(value, variableName) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${variableName} must be either true or false.`);
}

const pgSslMode = (process.env.PGSSLMODE || 'disable').toLowerCase();

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: getPort(process.env.PORT || '3000', 'PORT'),
  database: {
    host: getRequiredEnv('PGHOST'),
    port: getPort(process.env.PGPORT || '5432', 'PGPORT'),
    name: getRequiredEnv('PGDATABASE'),
    user: getRequiredEnv('PGUSER'),
    password: getRequiredEnv('PGPASSWORD'),
    ssl: pgSslMode === 'require' ? { rejectUnauthorized: false } : false
  },
  auth: {
    jwtSecret: getRequiredEnv('JWT_SECRET'),
    accessTokenTtlSeconds: getPositiveInteger(getRequiredEnv('ACCESS_TOKEN_TTL_SECONDS'), 'ACCESS_TOKEN_TTL_SECONDS'),
    refreshTokenTtlSeconds: getPositiveInteger(getRequiredEnv('REFRESH_TOKEN_TTL_SECONDS'), 'REFRESH_TOKEN_TTL_SECONDS'),
    passwordChangeTokenTtlSeconds: getPositiveInteger(getRequiredEnv('PASSWORD_CHANGE_TOKEN_TTL_SECONDS'), 'PASSWORD_CHANGE_TOKEN_TTL_SECONDS'),
    passwordResetOtpTtlSeconds: getPositiveInteger(getRequiredEnv('PASSWORD_RESET_OTP_TTL_SECONDS'), 'PASSWORD_RESET_OTP_TTL_SECONDS'),
    otpMaxAttempts: getPositiveInteger(getRequiredEnv('PASSWORD_RESET_OTP_MAX_ATTEMPTS'), 'PASSWORD_RESET_OTP_MAX_ATTEMPTS'),
    cookieSecure: getBoolean(getRequiredEnv('AUTH_COOKIE_SECURE'), 'AUTH_COOKIE_SECURE'),
    cookieSameSite: getRequiredEnv('AUTH_COOKIE_SAME_SITE').toLowerCase()
  },
  redis: {
    url: getRequiredEnv('REDIS_URL')
  },
  mail: {
    host: getRequiredEnv('SMTP_HOST'),
    port: getPort(getRequiredEnv('SMTP_PORT'), 'SMTP_PORT'),
    secure: getBoolean(getRequiredEnv('SMTP_SECURE'), 'SMTP_SECURE'),
    user: getRequiredEnv('SMTP_USER'),
    password: getRequiredEnv('SMTP_PASSWORD'),
    from: getRequiredEnv('SMTP_FROM')
  }
});

module.exports = { env };
