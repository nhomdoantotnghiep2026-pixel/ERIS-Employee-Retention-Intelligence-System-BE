const fs = require('node:fs');
const path = require('node:path');
const { databasePool } = require('../src/config/database');
(async () => {
  const client = await databasePool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/20261115-attendance-import.sql'), 'utf8'));
    console.log('Attendance import migration applied; existing attendance and shift codes are unchanged.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => databasePool.end());
