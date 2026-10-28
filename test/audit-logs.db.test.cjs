const assert = require('node:assert/strict');
const test = require('node:test');
const { databasePool } = require('../src/config/database');
const { EmployeesRepository } = require('../src/modules/employees/employees.repository');
const { DepartmentsRepository } = require('../src/modules/departments/departments.repository');
const { PositionsRepository } = require('../src/modules/positions/positions.repository');
const { EducationRepository } = require('../src/modules/employee-education/education.repository');
const { WorkExperiencesRepository } = require('../src/modules/work-experiences/work-experiences.repository');
const { WorkExperiencesService } = require('../src/modules/work-experiences/work-experiences.service');
const { SurveysRepository } = require('../src/modules/surveys/surveys.repository');
const { SurveysService } = require('../src/modules/surveys/surveys.service');
const { processEmployeeRows } = require('../src/modules/employees/employees.import');

test('Audit nghiệp vụ trên PostgreSQL TEMP: đủ nhóm, diff/no-op, quyền, rollback, import', async () => {
  const client = await databasePool.connect();
  const tables = ['role', 'users', 'departments', 'positions', 'employees', 'employee_educations', 'employee_work_experiences', 'employee_job_histories', 'surveys', 'survey_questions', 'survey_responses', 'survey_answers', 'audit_logs'];
  let failAudit = false;
  try {
    // Only temporary schema objects. All application SQL is forced to pg_temp.
    for (const table of tables) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
      const { rows } = await client.query("SELECT is_identity FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id'", [table]);
      if (rows[0]?.is_identity !== 'YES') {
        await client.query(`CREATE TEMP SEQUENCE ${table}_audit_fixture_seq`);
        await client.query(`ALTER TABLE pg_temp.${table} ALTER COLUMN id SET DEFAULT nextval('pg_temp.${table}_audit_fixture_seq')`);
      }
    }
    await client.query('SET search_path TO pg_temp');
    const query = async (sql, params) => {
      const rewritten = sql.replace(/public\.(employees|employee_educations|employee_work_experiences|employee_job_histories)\b/g, 'pg_temp.$1');
      if (/\bpublic\./i.test(rewritten)) throw new Error('Public application access blocked by test');
      if (failAudit && /INSERT INTO audit_logs/.test(rewritten)) return client.query('SELECT 1/0');
      return client.query(rewritten, params);
    };
    const txClient = { query, release() {} };
    const pool = { query, connect: async () => txClient };
    const one = async (sql, params) => (await query(sql, params)).rows[0];
    const count = async () => Number((await one('SELECT count(*) AS count FROM audit_logs')).count);
    const last = async () => one('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1');
    const hrRole = await one("INSERT INTO role(name) VALUES ('HR') RETURNING id");
    await query("INSERT INTO role(name) VALUES ('EMPLOYEE')");
    const hr = await one("INSERT INTO users(email,password_hash,role_id,status) VALUES ('hr@audit.test','fixture-secret',$1,'ACTIVE') RETURNING id", [hrRole.id]);
    const departments = new DepartmentsRepository(pool), positions = new PositionsRepository(pool), employees = new EmployeesRepository(pool);
    const dept = await departments.create({ name: 'Audit IT', description: 'Initial' }, hr.id);
    assert.equal((await last()).user_id, hr.id);
    assert.equal((await last()).entity_type, 'departments');
    await departments.update(dept.id, { name: 'Audit IT changed' }, hr.id);
    assert.deepEqual((await last()).old_value, { name: 'Audit IT' });
    const unchanged = await count();
    await departments.update(dept.id, { name: 'Audit IT changed' }, hr.id);
    assert.equal(await count(), unchanged, 'No log for no-op update');
    const position = await positions.create({ name: 'Developer', jobLevel: 1, description: 'Entry' }, hr.id);
    await query('UPDATE positions SET department_id=$1 WHERE id=$2', [dept.id, position.id]);
    await positions.update(position.id, { description: 'Changed' }, hr.id);
    assert.equal((await last()).new_value.description, 'Changed');
    const employeeInput = {
      fullName: 'Audit employee', email: 'employee@audit.test', phone: '0901234501', dateOfBirth: '1990-01-01', gender: 'MALE',
      address: 'Test address', distanceFromHomeKm: 5, departmentId: dept.id, positionId: position.id,
      hireDate: '2020-01-01', employmentType: 'FULL_TIME', currentSalary: 15000000,
      educations: [{ educationLevel: 2, institution: 'Test University', fieldOfStudy: 'IT', graduationYear: 2012 }],
      workExperiences: [{ companyName: 'Prior company', positionTitle: 'Developer', startDate: '2013-01-01', endDate: '2019-01-01' }]
    };
    const startCreate = await count();
    const created = await employees.createWithAccount(employeeInput, 'password-never-logged', hr.id);
    assert.equal(await count(), startCreate + 1, 'One parent CREATE includes children');
    const creationLog = await last();
    assert.equal(creationLog.new_value.educations.length, 1);
    assert.equal(creationLog.new_value.workExperiences[0].status, 'IN_PROCESS');
    assert.equal(creationLog.new_value._context.source, 'MANUAL');
    assert(!JSON.stringify(creationLog).includes('password-never-logged'));
    await query("UPDATE employees SET employment_status='ACTIVE' WHERE id=$1", [created.employee.id]);
    await query("UPDATE users SET status='ACTIVE' WHERE employee_id=$1", [created.employee.id]);
    await employees.updateAuthorized(hr.id, created.employee.id, { currentSalary: 18000000 });
    assert.equal((await last()).old_value.current_salary, 15000000);
    assert.equal((await last()).new_value.current_salary, 18000000);
    const promotion = await positions.create({ name: 'Senior developer', jobLevel: 4, description: '' }, hr.id);
    await query('UPDATE positions SET department_id=$1 WHERE id=$2', [dept.id, promotion.id]);
    const changed = await employees.updateAuthorized(hr.id, created.employee.id, { positionId: promotion.id });
    assert(changed.jobHistory);
    assert.equal((await last()).new_value.position_id, promotion.id);
    const education = new EducationRepository(pool);
    const degree = await education.withHrEmployee(hr.id, created.employee.id, true, repo => repo.create(created.employee.id, { educationLevel: 3, institution: 'Test University', fieldOfStudy: 'IT', graduationYear: 2015 }));
    assert.equal((await last()).entity_type, 'employee_educations');
    await education.withHrEmployee(hr.id, created.employee.id, true, repo => repo.update(created.employee.id, degree.id, { fieldOfStudy: 'Computer Science' }));
    assert.equal((await last()).new_value.field_of_study, 'Computer Science');
    await education.withHrEmployee(hr.id, created.employee.id, true, repo => repo.delete(created.employee.id, degree.id));
    assert.equal((await last()).action, 'SOFT_DELETE');
    const work = new WorkExperiencesService(new WorkExperiencesRepository(pool));
    const experience = await work.create(hr.id, created.employee.id, { companyName: 'Other company', positionTitle: 'Developer', startDate: '2015-01', endDate: '2019-01' });
    assert.equal((await last()).entity_type, 'employee_work_experiences');
    await work.delete(hr.id, created.employee.id, experience.data.id);
    assert.equal((await last()).new_value.status, 'INACTIVE');
    const beforeForbidden = await count();
    await query('UPDATE users SET employee_id=NULL WHERE id=$1', [created.account.id]);
    await query('UPDATE users SET employee_id=$1 WHERE id=$2', [created.employee.id, hr.id]);
    await assert.rejects(() => work.create(hr.id, created.employee.id, { companyName: 'Self', positionTitle: 'X', startDate: '2015-01' }), e => e.statusCode === 403);
    assert.equal(await count(), beforeForbidden);
    await query('UPDATE users SET employee_id=NULL WHERE id=$1', [hr.id]);
    await query('UPDATE users SET employee_id=$1 WHERE id=$2', [created.employee.id, created.account.id]);
    const surveys = new SurveysService({ surveysRepository: new SurveysRepository(pool) });
    const survey = await surveys.createSurvey({ actorId: hr.id, survey: { title: 'Audit survey', description: 'Fixture', startDate: '2026-01-01T00:00:00Z', endDate: '2099-01-01T00:00:00Z' } });
    assert.equal((await last()).new_value.questions.length, survey.questions.length);
    await surveys.publishSurvey({ actorId: hr.id, surveyId: survey.id });
    assert.equal((await last()).action, 'PUBLISH');
    assert.equal((await last()).old_value.status, 'DRAFT');
    assert.equal((await last()).new_value.status, 'ACTIVE');
    const beforeFailure = await count();
    failAudit = true;
    await assert.rejects(() => employees.updateAuthorized(hr.id, created.employee.id, { currentSalary: 20000000 }));
    failAudit = false;
    assert.equal(Number((await one('SELECT current_salary FROM employees WHERE id=$1', [created.employee.id])).current_salary), 18000000);
    assert.equal(await count(), beforeFailure);
    failAudit = true;
    await assert.rejects(() => departments.create({ name: 'Must rollback', description: '' }, hr.id));
    await assert.rejects(() => employees.createWithAccount({ ...employeeInput, email: 'rollback@audit.test', phone: '0901234502' }, 'no-log-secret', hr.id));
    failAudit = false;
    assert.equal((await one("SELECT count(*)::integer AS count FROM employees WHERE email='rollback@audit.test'")).count, 0);
    assert.equal((await one("SELECT count(*)::integer AS count FROM departments WHERE name='Must rollback'")).count, 0);
    await employees.deactivate(created.employee.id, hr.id);
    assert.equal((await last()).new_value.employment_status, 'INACTIVE');
    await positions.deactivate(promotion.id, hr.id);
    await departments.deactivate(dept.id, hr.id);
    assert.equal((await last()).new_value.status, 'INACTIVE');
    await query("UPDATE departments SET status='ACTIVE' WHERE id=$1", [dept.id]);
    await query("UPDATE positions SET status='ACTIVE' WHERE id=$1", [position.id]);
    const imported = await employees.createWithAccount({ ...employeeInput, email: 'import@audit.test', phone: '0901234503' }, 'import-secret', hr.id, { source: 'IMPORT', importId: 'batch-test', row: 2 });
    assert.equal((await last()).new_value._context.importId, 'batch-test');
    await employees.recordImportAudit(hr.id, { importId: 'batch-test', total: 2, created: 1, failed: 1, rows: [{ row: 2, status: 'CREATED', employeeId: imported.employee.id }, { row: 3, status: 'FAILED' }] });
    assert.equal((await last()).new_value.created, 1);
    const contexts = [];
    const processed = await processEmployeeRows([{ row: 2, input: {} }, { row: 3, status: 'FAILED' }], { createEmployee: async data => { contexts.push(data.auditContext); return { id: 99 }; } }, hr.id, 1, 'batch-worker');
    assert.equal(processed[0].status, 'CREATED');
    assert.deepEqual(contexts[0], { source: 'IMPORT', importId: 'batch-worker', row: 2 });
    assert.equal((await one("SELECT count(*)::integer AS count FROM audit_logs WHERE entity_type IN ('users','attendance','survey_answers','survey_responses')")).count, 0);
    console.log('All audited groups verified using isolated temporary tables; no public business/audit rows changed.');
  } finally {
    await client.query('ROLLBACK');
    await client.query('DISCARD TEMP');
    client.release();
    await databasePool.end();
  }
});

