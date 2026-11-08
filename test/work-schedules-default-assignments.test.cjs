const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkSchedulesRepository } = require('../src/modules/work-schedules/work-schedules.repository');
const { WorkSchedulesService } = require('../src/modules/work-schedules/work-schedules.service');
const { validateAssignmentInput } = require('../src/modules/work-schedules/work-schedules.validation');
const schedule = (id, is_default = false, status = 'ACTIVE') => ({ id, name: 'Schedule', is_default, status });

test('assignment input validates real dates, bounds, null and allowed fields', () => {
  const valid = { schedule_id: 1, effective_from: '2026-12-01' };
  assert.equal(validateAssignmentInput(valid).effective_to, null);
  assert.equal(validateAssignmentInput({ ...valid, effective_to: '2026-12-01' }).effective_to, '2026-12-01');
  for (const input of [null, [], {}, { ...valid, schedule_id: '1' }, { ...valid, schedule_id: 2147483648 }, { ...valid, effective_from: '2026-02-29' }, { ...valid, effective_from: '2026-04-31' }, { ...valid, effective_to: '2026-11-30' }, { ...valid, effective_to: '' }, { ...valid, reason: 'extra' }]) assert.throws(() => validateAssignmentInput(input), e => e.statusCode === 400);
});

function fixture() {
  const state = { schedules: [schedule(1, true), schedule(2)], assignments: [], employee: true, auditFailure: false, logs: [], sql: [], released: 0 };
  let before;
  const client = { release() { state.released++; }, async query(sql, params = []) {
    state.sql.push(sql);
    if (sql === 'BEGIN') { before = structuredClone({ schedules: state.schedules, assignments: state.assignments, logs: state.logs }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, before); return { rows: [] }; }
    if (sql === 'COMMIT' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('OR is_default')) return { rows: structuredClone(state.schedules.filter(s => s.id === params[0] || s.is_default)) };
    if (sql.startsWith('UPDATE work_schedules')) {
      const row = state.schedules.find(s => s.id === params[0]); row.is_default = sql.includes('TRUE'); return { rows: [structuredClone(row)] };
    }
    if (sql.includes('FROM work_schedules') && sql.includes('FOR SHARE')) return { rows: state.schedules.filter(s => s.id === params[0]) };
    if (sql.includes('FROM employees')) return { rows: state.employee ? [{ id: params[0] }] : [] };
    if (sql.includes('SELECT id FROM employee_schedule_assignments')) {
      assert(sql.includes('effective_from <= $3::date')); assert(sql.includes('effective_to >= $2::date'));
      return { rows: state.assignments.filter(a => a.employee_id === params[0] && (params[2] === null || a.effective_from <= params[2]) && (a.effective_to === null || a.effective_to >= params[1])) };
    }
    if (sql.startsWith('INSERT INTO employee_schedule_assignments')) {
      const row = { id: state.assignments.length + 1, employee_id: params[0], schedule_id: params[1], effective_from: params[2], effective_to: params[3] };
      state.assignments.push(row); return { rows: [structuredClone(row)] };
    }
    if (sql.startsWith('INSERT INTO audit_logs')) { if (state.auditFailure) throw new Error('audit failed'); state.logs.push(params); return { rows: [] }; }
    throw new Error('Unexpected SQL: ' + sql);
  } };
  const repository = new WorkSchedulesRepository({ connect: async () => client });
  return { state, repository };
}

test('default scheduling fails closed when no pending-command store is configured',async()=>{
 const {repository}=fixture();await assert.rejects(()=>repository.setDefault(2,7),{statusCode:503});
});

test('assignments enforce inclusive overlaps, open ends, existence, active schedules and atomic audit', async () => {
  const { state, repository } = fixture();
  const input = { schedule_id: 2, effective_from: '2026-12-01', effective_to: '2026-12-31' };
  const first = await repository.assign(4,input,7); assert.equal(first.employee_id,4); assert.equal(state.logs.length,1);
  for (const dates of [input, { ...input, effective_from: '2026-12-31', effective_to: null }, { ...input, effective_from: '2026-11-01', effective_to: '2026-12-01' }, { ...input, effective_from: '2026-11-01', effective_to: null }]) await assert.rejects(repository.assign(4,dates,7), e => e.statusCode === 409);
  await repository.assign(4,{ ...input, effective_from: '2027-01-01', effective_to: null },7);
  await assert.rejects(repository.assign(4,{ ...input, effective_from: '2028-01-01', effective_to: null },7), e => e.statusCode === 409);
  assert.equal(state.assignments.length,2);
  await assert.rejects(repository.assign(4,{ ...input, schedule_id: 99 },7), e => e.statusCode === 404);
  state.employee = false; await assert.rejects(repository.assign(9,input,7), e => e.statusCode === 404); state.employee = true;
  state.schedules[1].status = 'INACTIVE'; await assert.rejects(repository.assign(9,input,7), e => e.statusCode === 409); state.schedules[1].status = 'ACTIVE';
  state.auditFailure = true; await assert.rejects(repository.assign(9,input,7), /audit failed/); assert.equal(state.assignments.length,2);
  assert(state.sql.some(sql => sql.includes('FROM employees') && sql.includes('FOR UPDATE')));
  assert(state.sql.some(sql => sql.includes('FROM work_schedules') && sql.includes('FOR SHARE')));
});

test('service rejects unauthorized actors and validates ids and no-body endpoint', async () => {
  for (const actor of [null, { role: 'ADMIN', status: 'ACTIVE' }, { role: 'HR', status: 'INACTIVE' }]) {
    const service = new WorkSchedulesService({ findActor: async () => actor });
    await assert.rejects(service.setDefault(1,'1'), e => e.statusCode === 403);
    await assert.rejects(service.assign(1,'1',{}), e => e.statusCode === 403);
  }
  const service = new WorkSchedulesService({ findActor: async () => ({ role: 'HR', status: 'ACTIVE' }), setDefault: async id => ({ id }), assign: async (employee_id, body) => ({ employee_id, ...body }) });
  assert.deepEqual(await service.setDefault(1,'2'),{ id: 2 });
  await assert.rejects(service.setDefault(1,'0'),e=>e.statusCode===400);
  await assert.rejects(service.setDefault(1,'1',{ effective_from: '2026-12-01' }),e=>e.statusCode===400);
  await assert.rejects(service.assign(1,'abc',{}),e=>e.statusCode===400);
  assert.equal((await service.assign(1,'5',{schedule_id:1,effective_from:'2026-12-01'})).employee_id,5);
});
