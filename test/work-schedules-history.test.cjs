const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { env } = require('../src/config/env');
const { TOKEN_PURPOSE } = require('../src/modules/auth/auth.constants');
const { authenticate } = require('../src/common/middleware/authenticate');
const { errorHandler } = require('../src/common/middleware/error-handler');
const { AppError } = require('../src/common/errors/app-error');
const { WorkSchedulesRepository } = require('../src/modules/work-schedules/work-schedules.repository');
const { WorkSchedulesService } = require('../src/modules/work-schedules/work-schedules.service');
const { createScheduleAssignmentsRouter } = require('../src/modules/work-schedules/work-schedules.routes');

test('GET history: real JWT, HR authorization, id, existence, empty/history responses and read-only SQL', async () => {
  let historyReads = 0, employeeReads = 0, fail = false;
  const history = [
    { id: 8, employee_id: 7, schedule_id: 2, effective_from: '2027-01-01', effective_to: null, name: 'Current name', start_time: '08:00:00', end_time: '17:00:00', break_start: '12:00:00', break_end: '13:00:00', working_days: [1,2,3,4,5], status: 'ACTIVE' },
    { id: 3, employee_id: 7, schedule_id: 1, effective_from: '2026-01-01', effective_to: '2026-12-31', name: 'Old schedule', start_time: '08:00:00', end_time: '17:00:00', break_start: '12:00:00', break_end: '13:00:00', working_days: [1,2,3,4,5], status: 'INACTIVE' }
  ];
  const repository = new WorkSchedulesRepository({ async query(sql, values) {
    assert.match(sql.trim(), /^SELECT\b/);
    if (sql.includes('FROM users')) return { rows: values[0] === 1 ? [{ role: 'HR', status: 'ACTIVE' }] : values[0] === 2 ? [{ role: 'HR', status: 'INACTIVE' }] : values[0] === 3 ? [{ role: 'ADMIN', status: 'ACTIVE' }] : values[0] === 4 ? [{ role: 'EMPLOYEE', status: 'ACTIVE' }] : [] };
    if (sql.includes('FROM employees')) { employeeReads++; return { rows: [7,8].includes(values[0]) ? [{ id: values[0] }] : [] }; }
    assert.match(sql, /JOIN work_schedules s ON s.id = a.schedule_id/);
    assert.match(sql, /WHERE a.employee_id = \$1/);
    assert.match(sql, /ORDER BY a.effective_from DESC, a.id DESC/);
    assert.match(sql, /a.effective_from::text/); assert.match(sql, /a.effective_to::text/);
    assert(!sql.includes('CURRENT_DATE')); assert(!sql.includes("s.status = 'ACTIVE'"));
    historyReads++;
    if (fail) throw new AppError(503, 'Database unavailable.');
    return { rows: values[0] === 7 ? history : [] };
  } });
  const app = express();
  app.use('/api/employees', createScheduleAssignmentsRouter({ service: new WorkSchedulesService(repository), authenticate }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const token = id => jwt.sign({ sub: String(id), type: TOKEN_PURPOSE.ACCESS }, env.auth.jwtSecret, { expiresIn: 60 });
  const get = (id = '7', actor = 1) => fetch(`http://127.0.0.1:${server.address().port}/api/employees/${id}/schedule-assignments`, { headers: actor ? { Authorization: 'Bearer ' + token(actor) } : {} });
  try {
    assert.equal((await get('7',null)).status,401);
    for (const actor of [2,3,4,99]) assert.equal((await get('7',actor)).status,403);
    assert.equal(employeeReads,0); assert.equal(historyReads,0);
    for (const id of ['0','-1','abc','1.5','2147483648']) assert.equal((await get(id)).status,400);
    assert.equal(employeeReads,0);
    assert.equal((await get('99')).status,404); assert.equal(historyReads,0);
    let response = await get('8'); assert.equal(response.status,200); assert.deepEqual(await response.json(),{data:[]});
    response = await get(); assert.equal(response.status,200); assert.deepEqual(await response.json(),{data:history});
    fail = true; assert.equal((await get()).status,503);
    const paths = require('../src/config/swagger').swaggerSpec.paths;
    assert(paths['/api/employees/{id}/schedule-assignments'].get);
    assert(paths['/api/employees/{id}/schedule-assignments'].post);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
