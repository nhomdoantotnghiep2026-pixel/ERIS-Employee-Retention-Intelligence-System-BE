const test = require('node:test');
const assert = require('node:assert/strict');
const { SurveysService } = require('../src/modules/surveys/surveys.service');
const { SurveysRepository } = require('../src/modules/surveys/surveys.repository');

test('history uses authenticated employee identity and accepts closed submitted surveys', async () => {
  const rows = [{ id: 26, title: 'Survey', status: 'CLOSED', submittedAt: '2026-11-24' }];
  const repository = {
    withTransaction: fn => fn(repository),
    findActorById: async id => { assert.equal(id, 49); return { role: 'EMPLOYEE', employeeId: 55 }; },
    findActiveEmployeeById: async id => { assert.equal(id, 55); return {}; },
    findSubmittedSurveys: async id => { assert.equal(id, 55); return rows; },
  };
  assert.deepEqual(await new SurveysService({ surveysRepository: repository }).listMySurveyHistory(49), rows);
});

test('history rejects non-employee actors and inactive employee profiles', async () => {
  for (const role of ['HR', 'ADMIN', 'EMPLOYEE']) {
    const repository = {
      withTransaction: fn => fn(repository),
      findActorById: async () => ({ role, employeeId: 55 }),
      findActiveEmployeeById: async () => null,
      findSubmittedSurveys: () => assert.fail('unauthorized query'),
    };
    await assert.rejects(new SurveysService({ surveysRepository: repository }).listMySurveyHistory(49), e => e.statusCode === 403);
  }
});

test('history repository filters by employee and submission without excluding closed surveys', async () => {
  const repository = new SurveysRepository({ query: async (sql, params) => {
    assert.deepEqual(params, [55]);
    assert.match(sql, /r.employee_id=\$1/);
    assert.match(sql, /r.submitted_at IS NOT NULL/);
    assert.doesNotMatch(sql, /status\s*=\s*'ACTIVE'/);
    return { rows: [] };
  } });
  assert.deepEqual(await repository.findSubmittedSurveys(55), []);
});
