const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { WorkSchedulesRepository } = require('../src/modules/work-schedules/work-schedules.repository');
const { WorkSchedulesService } = require('../src/modules/work-schedules/work-schedules.service');
const { createWorkSchedulesRouter } = require('../src/modules/work-schedules/work-schedules.routes');
const { errorHandler } = require('../src/common/middleware/error-handler');
const { AppError } = require('../src/common/errors/app-error');

const original = () => ({ id: 1, name: 'Office', start_time: '08:00:00', end_time: '17:00:00', break_start: '12:00:00', break_end: '13:00:00', working_days: [1,2,3,4,5], is_default: false, status: 'ACTIVE' });

test('PATCH permissions, partial updates, history restrictions, validation and rollback', async () => {
  let schedule = original(), assigned = false, before, auditFailure = false, audits = [], released = 0;
  const commands = [];
  const client = { release() { released++; }, async query(sql, params) {
    commands.push(sql);
    if (sql === 'BEGIN') { before = structuredClone(schedule); return { rows: [] }; }
    if (sql === 'ROLLBACK') { schedule = before; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('FOR UPDATE')) return { rows: schedule && params[0] === 1 ? [structuredClone(schedule)] : [] };
    if (sql.includes('SELECT EXISTS')) return { rows: [{ assigned }] };
    if (sql.startsWith('UPDATE')) {
      const assignments = sql.split(' SET ')[1].split('WHERE')[0].trim().split(', ');
      for (let i = 0; i < assignments.length; i++) schedule[assignments[i].split(' = ')[0]] = params[i];
      return { rows: [structuredClone(schedule)] };
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      if (auditFailure) throw new AppError(503, 'Audit unavailable');
      audits.push(params); return { rows: [] };
    }
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    throw new Error('Unexpected query: ' + sql);
  } };
  const repository = new WorkSchedulesRepository({ connect: async () => client, query: async (sql, [id]) => {
    assert(sql.includes('FROM users'));
    return { rows: id === 1 ? [{ role: 'HR', status: 'ACTIVE' }] : id === 2 ? [{ role: 'HR', status: 'INACTIVE' }] : id === 3 ? [{ role: 'ADMIN', status: 'ACTIVE' }] : [] };
  } });
  const app = express(); app.use(express.json());
  app.use('/api/work-schedules', createWorkSchedulesRouter({ service: new WorkSchedulesService(repository), authenticate(req, res, next) {
    if (!req.get('actor')) return next(new AppError(401, 'Authentication required'));
    req.auth = { userId: Number(req.get('actor')) }; next();
  } })); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const patch = (body, id = '1', actor = 1) => fetch(`http://127.0.0.1:${server.address().port}/api/work-schedules/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(actor ? { actor: String(actor) } : {}) }, body: JSON.stringify(body)
  });
  try {
    assert.equal((await patch({ name: 'New' }, '1', null)).status, 401);
    for (const actor of [2,3,4]) assert.equal((await patch({ name: 'New' }, '1', actor)).status, 403);
    for (const id of ['0','-1','abc','1.5','2147483648']) assert.equal((await patch({ name: 'New' }, id)).status, 400);
    assert.equal((await patch({ name: 'New' }, '99')).status, 404);
    for (const body of [{}, [], null, { id: 2 }, { is_default: true }, { endsNextDay: true }, { name: '' }, { name: 'a'.repeat(151) }, { start_time: '22:00' }, { break_end: '17:00' }, { working_days: [] }, { working_days: [8] }, { status: null }]) {
      assert.equal((await patch(body)).status, 400, JSON.stringify(body));
      assert.deepEqual(schedule, original());
    }
    let response = await patch({ start_time: '09:00', working_days: [6,7], status: 'INACTIVE' });
    assert.equal(response.status, 200);
    let data = (await response.json()).data;
    assert.equal(data.start_time, '09:00'); assert.equal(data.break_start, '12:00:00');
    assert.deepEqual(data.working_days, [6,7]); assert.equal(data.status, 'INACTIVE'); assert.equal(data.is_default, false);
    assert.equal(audits.length, 1); assert.equal(audits[0][0], 1); assert.equal(audits[0][3], 'UPDATE');
    assert.equal(JSON.parse(audits[0][4]).start_time, '08:00:00');
    for (const mode of ['assigned','default']) {
      schedule = original(); assigned = mode === 'assigned'; schedule.is_default = mode === 'default';
      for (const body of [{ start_time: '09:00' }, { status: 'INACTIVE' }, { working_days: [1] }, { name: 'Renamed', end_time: '18:00' }]) assert.equal((await patch(body)).status, 409);
      response = await patch({ name: ' Renamed ' }); assert.equal(response.status, 200);
      data = (await response.json()).data; assert.equal(data.name, 'Renamed'); assert.equal(data.start_time, '08:00:00');
    }
    schedule = original(); assigned = false; auditFailure = true;
    assert.equal((await patch({ name: 'Rollback' })).status, 503);
    assert.deepEqual(schedule, original());
    assert(commands.some(sql => sql.includes('FOR UPDATE'))); assert(commands.includes('ROLLBACK')); assert(released > 0);
    const paths = require('../src/modules/work-schedules/work-schedules.swagger').workSchedulesPaths;
    assert(paths['/api/work-schedules/{id}'].patch); assert(paths['/api/work-schedules'].get); assert(paths['/api/work-schedules'].post);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
