const assert = require('node:assert/strict');
const test = require('node:test');
const { EmployeesService } = require('../src/modules/employees/employees.service');
const { AuthRepository } = require('../src/modules/auth/auth.repository');

for (const source of ['MANUAL', 'IMPORT']) test(`${source} creates a profile without account configuration or email`, async () => {
  const employee = { email: 'worker@example.test', address: '10 Test Street', addressRefId: 'test-ref' };
  const auditContext = source === 'IMPORT' ? { source, importId: 'test-import', row: 2 } : undefined;
  const service = new EmployeesService({
    employeesRepository: {
      preflightCreate: async () => ({
        actorRole: 'HR', activeDepartment: true, activePosition: true, positionDepartmentId: 1,
        accounts: [{ id: 10, role: 'EMPLOYEE', status: 'ACTIVE' }]
      }),
      createWithAccount: async (record, passwordHash, actorId, context) => {
        assert.equal(passwordHash, null);
        assert.equal(actorId, 2);
        assert.equal(context, auditContext);
        assert.equal(record.distanceFromHomeKm, 4);
        return { employee: { ...record, id: 1, employmentStatus: 'ACTIVE' } };
      }
    },
    distanceService: {
      geocodeFull: async () => [],
      placeByRefId: async () => ({ display: employee.address, lat: 10, lng: 106 }),
      calculate: async () => ({ distanceFromHomeKm: 4 })
    }
  });
  service.prepareBackground = async (_actorId, input) => input;
  const result = await service.createEmployee({ actorId: 2, employee: { ...employee, departmentId: 1 }, auditContext });
  assert.equal(result.employmentStatus, 'ACTIVE');
  assert.equal(result.account, undefined);
  assert.equal(result.emailDelivery, undefined);
});

test('only active Admin provisions an account, and mail failure preserves the result', async () => {
  let provisioned = 0;
  const service = new EmployeesService({
    employeesRepository: {
      findUserRoleById: async id => ({ role: id === 1 ? 'ADMIN' : 'HR' }),
      provisionAccount: async (actorId, employeeId, hash) => {
        assert.equal(actorId, 1);
        assert.equal(employeeId, 9);
        assert.notEqual(hash, 'temporary-password');
        provisioned++;
        return { id: 5, status: 'IN_PROCESS', email: 'worker@example.test' };
      }
    },
    initialPassword: 'temporary-password',
    mailFrom: 'eris@example.test',
    mailTransporter: { sendMail: async () => { throw new Error('SMTP unavailable'); } }
  });
  await assert.rejects(service.provisionEmployeeAccount(2, 9), { statusCode: 403 });
  const result = await service.provisionEmployeeAccount(1, 9);
  assert.equal(result.account.status, 'IN_PROCESS');
  assert.equal(result.emailDelivery, 'FAILED');
  assert.equal(provisioned, 1);
});

test('activating an account linked to an active profile writes only to users', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('FROM users')) return { rows: [{ id: 9, employeeId: 7, status: 'IN_PROCESS' }] };
      if (sql.includes('FROM employees')) return { rows: [{ id: 7, status: 'ACTIVE' }] };
      return { rows: [{ id: 9 }] };
    },
    release() {}
  };
  const auth = new AuthRepository({ connect: async () => client });
  await auth.updatePassword(9, 'hash', 'ACTIVE');
  assert.equal(statements.filter(sql => /UPDATE|INSERT INTO/.test(sql) && !sql.includes('FOR UPDATE')).length, 1);
  assert.ok(statements.some(sql => sql.includes('UPDATE users')));
});

const { EmployeesRepository } = require('../src/modules/employees/employees.repository');
const { JobHistoriesRepository } = require('../src/modules/job-histories/job-histories.repository');
const { EmployeeBackgroundRepository } = require('../src/modules/employees/employee-background.repository');

test('profile transaction stores ACTIVE profile, education and HIRE without writing users', async t => {
  const queries = [];
  const client = { release() {}, async query(sql) { queries.push(sql); return { rows: [] }; } };
  const proto = EmployeesRepository.prototype;
  t.mock.method(proto, 'findUserRoleById', async () => ({ role: 'HR' }));
  t.mock.method(proto, 'findByEmail', async () => null);
  t.mock.method(proto, 'resolveImportedJob', async e => e);
  t.mock.method(proto, 'resolveImportedSchedule', async e => e);
  t.mock.method(proto, 'findActiveDepartmentById', async () => ({ id: 1 }));
  t.mock.method(proto, 'findActivePositionById', async () => ({ id: 2 }));
  t.mock.method(proto, 'assertPositionDepartment', async () => {});
  t.mock.method(proto, 'create', async (e, status) => { assert.equal(status, 'ACTIVE'); return { ...e, id: 7, employmentStatus: status }; });
  t.mock.method(JobHistoriesRepository.prototype, 'insert', async (id, h, type) => {
    assert.equal(id, 7); assert.equal(type, 'HIRE'); assert.equal(h.startDate, '2026-01-01'); return { id: 8 };
  });
  t.mock.method(EmployeeBackgroundRepository.prototype, 'create', async (id, e, status) => {
    assert.equal(id, 7); assert.equal(status, 'ACTIVE'); return { educations: [] };
  });
  const repo = new EmployeesRepository({ connect: async () => client });
  const result = await repo.createWithAccount({ email: 'worker@example.test', departmentId: 1, positionId: 2, hireDate: '2026-01-01' }, null, 2);
  assert.equal(result.account, undefined);
  assert.equal(queries.some(sql => /(?:INSERT INTO|UPDATE) users/.test(sql)), false);
  assert.equal(queries.at(-1), 'COMMIT');
});

test('candidate query matches normalized email or employee link without filtering account status', async () => {
  const repo = new EmployeesRepository({ async query(sql) {
    assert.match(sql, /u.employee_id=e.id OR lower\(btrim\(u.email\)\)=lower\(btrim\(e.email\)\)/);
    assert.doesNotMatch(sql, /u.status/);
    return { rows: [{ id: 7, email: 'worker@example.test' }] };
  } });
  assert.equal((await repo.listAccountCandidates()).length, 1);
});

for (const status of ['IN_PROCESS', 'ACTIVE', 'INACTIVE']) test(`existing ${status} account prevents duplicate provisioning`, async () => {
  const statements = [];
  const client = { release() {}, async query(sql, params) {
    statements.push(sql);
    if (sql.includes("r.name='ADMIN'")) return { rows: [{ id: 1 }] };
    if (sql.includes('FROM employees')) return { rows: [{ id: 7, email: ' Worker@Example.Test ', full_name: 'Worker' }] };
    if (sql.includes('SELECT id FROM users WHERE')) {
      assert.deepEqual(params, [7, 'worker@example.test']);
      assert.doesNotMatch(sql, /status/);
      return { rows: [{ id: 9, status, employee_id: null }] };
    }
    return { rows: [] };
  } };
  await assert.rejects(new EmployeesRepository({ connect: async () => client }).provisionAccount(1, 7, 'hash'), { statusCode: 409 });
  assert.equal(statements.some(sql => sql.includes('INSERT INTO users')), false);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('new account is IN_PROCESS, linked and committed before invitation is sent', async () => {
  const events = [];
  const client = { release() {}, async query(sql, params) {
    events.push(sql);
    if (sql.includes("r.name='ADMIN'")) return { rows: [{ id: 1 }] };
    if (sql.includes('FROM employees')) return { rows: [{ id: 7, email: ' Worker@Example.Test ', full_name: 'Worker' }] };
    if (sql.includes("FROM role WHERE name='EMPLOYEE'")) return { rows: [{ id: 3 }] };
    if (sql.includes('INSERT INTO users')) {
      assert.match(sql, /'IN_PROCESS'/);
      assert.equal(params[0], 'worker@example.test'); assert.equal(params[3], 7);
      return { rows: [{ id: 9, email: params[0], employeeId: 7, status: 'IN_PROCESS' }] };
    }
    return { rows: [] };
  } };
  const repo = new EmployeesRepository({ connect: async () => client });
  repo.findUserRoleById = async () => ({ role: 'ADMIN' });
  const service = new EmployeesService({ employeesRepository: repo, initialPassword: 'temporary-password', mailFrom: 'eris@example.test',
    mailTransporter: { async sendMail(mail) {
      assert.equal(events.at(-1), 'COMMIT'); assert.equal(mail.to, 'worker@example.test');
      assert.match(mail.text, /OTP/); events.push('MAIL'); return { accepted: [mail.to] };
    } } });
  const result = await service.provisionEmployeeAccount(1, 7);
  assert.equal(result.account.status, 'IN_PROCESS'); assert.equal(result.emailDelivery, 'SENT');
  assert.equal(events.at(-1), 'MAIL');
});
