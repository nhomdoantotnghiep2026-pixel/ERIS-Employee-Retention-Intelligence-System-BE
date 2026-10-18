const { Pool } = require('pg');
const { env } = require('./env');

const databasePool = new Pool({
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  ssl: env.database.ssl
});

databasePool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

async function checkDatabaseConnection() {
  const client = await databasePool.connect();

  try {
    const { rows } = await client.query('SELECT NOW() AS database_time');
    return rows[0];
  } finally {
    client.release();
  }
}

async function closeDatabaseConnection() {
  await databasePool.end();
}

module.exports = {
  databasePool,
  checkDatabaseConnection,
  closeDatabaseConnection
};
