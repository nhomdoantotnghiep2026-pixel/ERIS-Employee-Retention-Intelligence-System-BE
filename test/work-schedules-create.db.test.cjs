const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { databasePool } = require('../src/config/database');
const { env } = require('../src/config/env');
const { authenticate } = require('../src/common/middleware/authenticate');
const { TOKEN_PURPOSE } = require('../src/modules/auth/auth.constants');
const { errorHandler } = require('../src/common/middleware/error-handler');
const { WorkSchedulesRepository } = require('../src/modules/work-schedules/work-schedules.repository');
const { WorkSchedulesService } = require('../src/modules/work-schedules/work-schedules.service');
const { createWorkSchedulesRouter } = require('../src/modules/work-schedules/work-schedules.routes');

test('create schedule: authentication, HR permission, validation, defaults and atomic audit', async () => {
  let client, server;
  try {
    client = await databasePool.connect();
    await client.query(`BEGIN;
      CREATE TEMP TABLE role (id integer, name text) ON COMMIT DROP;
      CREATE TEMP TABLE users (id integer, role_id integer, status text) ON COMMIT DROP;
      CREATE TEMP TABLE work_schedules (LIKE public.work_schedules INCLUDING ALL) ON COMMIT DROP;
      CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING ALL) ON COMMIT DROP;
      SET LOCAL search_path TO pg_temp;
      INSERT INTO role VALUES (1,'HR'),(2,'ADMIN'),(3,'EMPLOYEE');
      INSERT INTO users VALUES (1,1,'ACTIVE'),(2,2,'ACTIVE'),(3,3,'ACTIVE'),(4,1,'INACTIVE');`);
    // Repository transactions become savepoints inside this isolated test transaction.
    const pool = { query: (...args) => client.query(...args), connect: async () => ({
      query: (sql, params) => client.query(sql === 'BEGIN' ? 'SAVEPOINT creation' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT creation' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT creation' : sql, params), release() {}
    }) };
    const app = express(); app.use(express.json());
    app.use('/api/work-schedules', createWorkSchedulesRouter({ service: new WorkSchedulesService(new WorkSchedulesRepository(pool)), authenticate }));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const input = { name: 'Office', start_time: '08:00', end_time: '17:00', break_start: '12:00', break_end: '13:00' };
    const post = (body, id = 1) => fetch(`http://127.0.0.1:${server.address().port}/api/work-schedules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: 'Bearer ' + jwt.sign({ sub: String(id), type: TOKEN_PURPOSE.ACCESS }, env.auth.jwtSecret, { expiresIn: 60 }) } : {}) }, body: JSON.stringify(body)
    });
    assert.equal((await post(input, null)).status, 401);
    for (const id of [2,3,4,99]) assert.equal((await post(input,id)).status, 403);
    for (const body of [null, [], {}, { ...input, endsNextDay: true }, { ...input, is_default: true }, { ...input, id: 9 }, { ...input, start_time: '22:00' }, { ...input, break_end: '12:00' }, { ...input, start_time: '25:00' }, { ...input, working_days: [] }, { ...input, working_days: [0] }, { ...input, working_days: [1.5] }, { ...input, status: null }]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    const response = await post(input); assert.equal(response.status,201);
    const { data } = await response.json();
    assert.equal(data.is_default,false); assert.equal(data.status,'ACTIVE');
    assert.deepEqual(data.working_days,[1,2,3,4,5]); assert.equal(data.start_time,'08:00:00');
    assert.equal((await post(input)).status,201, 'duplicate names are allowed');
    const custom = await post({ ...input, status: 'INACTIVE', working_days: [6,7] });
    assert.equal(custom.status,201); assert.deepEqual((await custom.json()).data.working_days,[6,7]);
    const audit = await client.query("SELECT * FROM audit_logs WHERE entity_type='work_schedules' ORDER BY id");
    assert.equal(audit.rows.length,3); assert.equal(audit.rows[0].user_id,1);
    assert.equal(audit.rows[0].new_value.id,data.id);
    await client.query(`ALTER TABLE audit_logs ADD CONSTRAINT reject_schedule_audit CHECK (entity_type <> 'work_schedules') NOT VALID`);
    assert.equal((await post(input)).status, 500);
    assert.equal((await client.query('SELECT count(*)::integer AS count FROM work_schedules')).rows[0].count, 3, 'audit failure rolls back schedule creation');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (client) { await client.query('ROLLBACK'); client.release(); }
    await databasePool.end();
  }
});
