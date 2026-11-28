const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOwnContactInput } = require('../src/modules/employees/employees.validation');
const { EmployeesService } = require('../src/modules/employees/employees.service');
const { EmployeesRepository } = require('../src/modules/employees/employees.repository');

test('contact whitelist rejects employment fields, empty values and malformed phones', () => {
  assert.deepEqual(validateOwnContactInput({ phone: '+84 912 345 678' }), { phone: '0912345678' });
  for (const input of [{}, null, [], { email: 'a@b.com' }, { employeeId: 99 }, { currentSalary: 100 }, { workScheduleId: 1 }, { phone: '' }, { address: '' }, { phone: 'abc' }, { address: 'a'.repeat(2001) }, { addressRefId: 'ref' }]) {
    assert.throws(() => validateOwnContactInput(input), e => e.statusCode === 400);
  }
});

function fixture(actor = { role: 'EMPLOYEE', status: 'ACTIVE', employeeId: 55 }, status = 'ACTIVE') {
  let saved;
  const repository = {
    findHrTarget: async () => actor,
    findById: async () => ({ id: 55, employmentStatus: status, distanceFromHomeKm: 10 }),
    updateOwnContactAuthorized: async (...args) => { saved = args; return { id: 55, phone: args[2].phone, distanceFromHomeKm: 10 }; },
  };
  return { service: new EmployeesService({ employeesRepository: repository }), saved: () => saved };
}

test('contact update targets the authenticated linked employee and normalizes phone', async () => {
  const f = fixture();
  await f.service.updateMyContact(49, { phone: '+84 912 345 678' });
  assert.deepEqual(f.saved(), [49, 55, { phone: '0912345678' }]);
});

test('contact service rejects wrong roles, inactive accounts, unlinked and inactive profiles', async () => {
  for (const actor of [{ role: 'HR', status: 'ACTIVE', employeeId: 55 }, { role: 'EMPLOYEE', status: 'IN_PROCESS', employeeId: 55 }, { role: 'EMPLOYEE', status: 'ACTIVE', employeeId: null }]) {
    const f = fixture(actor);
    await assert.rejects(f.service.updateMyContact(49, { phone: '0912345678' }), e => e.statusCode === 403);
    assert.equal(f.saved(), undefined);
  }
  const f = fixture(undefined, 'INACTIVE');
  await assert.rejects(f.service.updateMyContact(49, { phone: '0912345678' }), e => e.statusCode === 409);
});

test('address resolution failure does not persist a partial contact update', async () => {
  const f = fixture();
  await assert.rejects(f.service.updateMyContact(49, { phone: '0912345678', address: 'Unknown address' }));
  assert.equal(f.saved(), undefined);
});

test('repository rechecks ownership inside transaction before updating', async () => {
  const repository = new EmployeesRepository({});
  repository.withTransaction = fn => fn({ findHrTarget: async () => ({ role: 'EMPLOYEE', status: 'ACTIVE', employeeId: 99 }) });
  await assert.rejects(repository.updateOwnContactAuthorized(49, 55, { phone: '0912345678' }), e => e.statusCode === 403);
  await assert.rejects(repository.updateOwnContactAuthorized(49, 55, { currentSalary: 1 }), e => e.statusCode === 400);
});

test('contact persistence and audit share one transaction; audit failure rolls back', async () => {
  for (const failAudit of [false, true]) {
    const calls = [];
    let snapshots = 0;
    const client = { release() {}, async query(sql, params) {
      calls.push(sql);
      if (sql.startsWith('SELECT u.id')) return { rows: [{ role: 'EMPLOYEE', status: 'ACTIVE', employeeId: 55 }] };
      if (sql.startsWith('SELECT to_jsonb')) return { rows: [{ data: { id: 55, employment_status: 'ACTIVE', address: ++snapshots === 1 ? 'Old' : 'New' } }] };
      if (sql.startsWith('WITH updated_employee')) return { rows: [{ id: 55, address: 'New' }] };
      if (sql.startsWith('INSERT INTO audit_logs')) {
        assert.equal(params[0], 49);
        assert.deepEqual(JSON.parse(params[5]), { address: 'New' });
        if (failAudit) throw Error('audit failed');
      }
      return { rows: [] };
    } };
    const repository = new EmployeesRepository({ connect: async () => client });
    const result = repository.updateOwnContactAuthorized(49, 55, { address: 'New' });
    if (failAudit) await assert.rejects(result, /audit failed/);
    else assert.equal((await result).address, 'New');
    assert.equal(calls.at(-1), failAudit ? 'ROLLBACK' : 'COMMIT');
    assert.ok(calls.some(sql => sql.startsWith('INSERT INTO audit_logs')));
  }
});
