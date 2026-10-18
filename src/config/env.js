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
  }
});

module.exports = { env };
