const {
  checkDatabaseConnection,
  closeDatabaseConnection
} = require('../src/config/database');

async function main() {
  try {
    const { database_time: databaseTime } = await checkDatabaseConnection();
    console.log(`PostgreSQL connected successfully. Database time: ${databaseTime.toISOString()}`);
  } catch (error) {
    console.error(`PostgreSQL connection failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabaseConnection();
  }
}

main();
