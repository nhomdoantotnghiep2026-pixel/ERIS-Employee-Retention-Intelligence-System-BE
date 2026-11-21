const assert = require('node:assert/strict');
const test = require('node:test');
const { EmployeesService } = require('../src/modules/employees/employees.service');
const { AuthRepository } = require('../src/modules/auth/auth.repository');

test('import creates a profile without account configuration or email', async () => {
  const employee = { email: 'worker@example.test', address: '10 Test Street', addressRefId: 'test-ref' };
  const auditContext = { source: 'IMPORT', importId: 'test-import', row: 2 };
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
