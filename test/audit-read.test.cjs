const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { databasePool } = require('../src/config/database');
const { env } = require('../src/config/env');
const { authenticate } = require('../src/common/middleware/authenticate');
const { TOKEN_PURPOSE } = require('../src/modules/auth/auth.constants');
const { AuditReadRepository } = require('../src/modules/audit_logs/audit-read.repository');
const { AuditReadService } = require('../src/modules/audit_logs/audit-read.service');
const { createAuditReadRouter } = require('../src/modules/audit_logs/audit-read.routes');
const { auditReadPaths } = require('../src/modules/audit_logs/audit-read.swagger');

test('Admin audit read: list, details, live permissions, null actor, safe JSON and no mutations', async () => {
  const client = await databasePool.connect(); let server;
  try {
    await client.query(`BEGIN;
      CREATE TEMP TABLE role (LIKE public.role INCLUDING ALL) ON COMMIT DROP;
      CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL) ON COMMIT DROP;
      CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING ALL) ON COMMIT DROP;
      SET LOCAL search_path TO pg_temp;
      INSERT INTO role(id,name) VALUES(1,'ADMIN'),(2,'HR'),(3,'EMPLOYEE');
      INSERT INTO users(id,email,password_hash,full_name,role_id,status) VALUES
        (1,'admin@audit.test','private-account-hash','Admin',1,'ACTIVE'),
        (2,'hr@audit.test','private-account-hash','HR actor',2,'ACTIVE'),
        (3,'employee@audit.test','private-account-hash','Employee',3,'ACTIVE'),
        (4,'inactive@audit.test','private-account-hash','Disabled admin',1,'INACTIVE');
      INSERT INTO audit_logs(id,user_id,entity_type,entity_id,action,old_value,new_value,created_at) VALUES
        (10,2,'employees',35,'UPDATE','{"current_salary":15000000}', '{"current_salary":18000000}', '2026-10-29T08:00:00Z'),
        (11,2,'employees',36,'CREATE',NULL, '{"fullName":"Sample","password_hash":"hidden","children":[{"accessToken":"hidden","institution":"ABC","otp":"hidden"}],"API_KEY":"hidden"}', '2026-10-29T09:00:00Z'),
        (12,NULL,'departments',4,'SOFT_DELETE','{"status":"ACTIVE"}','{"status":"INACTIVE"}', '2026-10-29T09:00:00Z');`);
    const pool = { query: (sql, params) => {
      assert(/^SELECT\b/i.test(sql.trim()), 'Read API must execute SELECT only');
      assert(!/\bpublic\./i.test(sql));
      return client.query(sql, params);
    } };
    const app = express();
    app.use('/api/audit-logs', createAuditReadRouter({ service: new AuditReadService(new AuditReadRepository(pool)), authenticate }));
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const token = id => jwt.sign({ sub: String(id), type: TOKEN_PURPOSE.ACCESS, roleId: 1, status: 'ACTIVE' }, env.auth.jwtSecret, { expiresIn: 60 });
    const adminToken = token(1);
    const get = (path = '', auth = adminToken) => fetch(`http://127.0.0.1:${server.address().port}/api/audit-logs${path}`, { headers: auth ? { Authorization: 'Bearer ' + auth } : {} });
    const listing = await get(); assert.equal(listing.status, 200);
    assert.match(listing.headers.get('cache-control'), /no-store/);
    assert.match(listing.headers.get('vary'), /Authorization/);
    const { data } = await listing.json(); assert.deepEqual(data.map(row => row.id), [12, 11, 10]);
    assert.equal(data[0].actor, null); assert.equal(data[0].userId, null);
    assert.equal(data[1].actor.fullName, 'HR actor');
    for (const row of data) { assert(!Object.hasOwn(row, 'oldValue')); assert(!Object.hasOwn(row, 'newValue')); }
    assert(!JSON.stringify(data).includes('private-account-hash'));
    const detail = (await (await get('/10')).json()).data;
    assert.deepEqual(detail.oldValue, { current_salary: 15000000 }); assert.deepEqual(detail.newValue, { current_salary: 18000000 });
    const creation = (await (await get('/11')).json()).data;
    assert.equal(creation.oldValue, null);
    assert.deepEqual(creation.newValue, { fullName: 'Sample', children: [{ institution: 'ABC' }] });
    assert.equal((await get('/999')).status, 404);
    for (const id of ['0', '-1', 'abc', '1e1', '2147483648']) assert.equal((await get('/' + id)).status, 400);
    for (const id of [2, 3, 4, 999]) {
      assert.equal((await get('', token(id))).status, 403);
      assert.equal((await get('/10', token(id))).status, 403);
    }
    assert.equal((await get('', null)).status, 401); assert.equal((await get('/10', 'invalid')).status, 401);
    await client.query('UPDATE users SET role_id=2 WHERE id=1');
    assert.equal((await get('', adminToken)).status, 403, 'Old token ADMIN claim cannot override database role');
    await client.query('UPDATE users SET role_id=1 WHERE id=1');
    const persisted = (await client.query('SELECT new_value FROM audit_logs WHERE id=11')).rows[0].new_value;
    assert.equal(persisted.password_hash, 'hidden', 'Read-time masking does not mutate audit history');
    assert.equal(Number((await client.query('SELECT count(*) FROM audit_logs')).rows[0].count), 3);
    await client.query('DELETE FROM audit_logs');
    assert.deepEqual((await (await get()).json()).data, []);
    assert(auditReadPaths['/api/audit-logs'].get); assert(auditReadPaths['/api/audit-logs/{id}'].get);
    console.log('PASS real HTTP/JWT + PostgreSQL TEMP: metadata/detail, ordering, null/deleted actor, secret masking, DB permissions, invalid IDs, empty list and read-only SQL.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK'); client.release(); await databasePool.end();
  }
});
