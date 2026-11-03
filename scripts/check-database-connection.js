const { checkDatabaseConnection, closeDatabaseConnection } = require('../src/config/database');
checkDatabaseConnection()
  .then(result => console.log('PostgreSQL connected:', result.database_time))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(closeDatabaseConnection);
