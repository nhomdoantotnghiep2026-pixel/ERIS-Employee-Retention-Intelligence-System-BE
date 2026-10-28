const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { databasePool } = require('../src/config/database');
const { SurveysRepository } = require('../src/modules/surveys/surveys.repository');
const { SurveysService } = require('../src/modules/surveys/surveys.service');
const { SurveysController } = require('../src/modules/surveys/surveys.controller');
const { createSurveysRouter } = require('../src/modules/surveys/surveys.routes');

test('GET survey responses: participants with nested answers, submitted only and HR authorization', async () => {
  const client = await databasePool.connect();
  let server;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE role(id integer, name text) ON COMMIT DROP;
      CREATE TEMP TABLE users(id integer, role_id integer, status text) ON COMMIT DROP;
      CREATE TEMP TABLE employees(id integer, employee_code text, full_name text, employment_status text) ON COMMIT DROP;
      CREATE TEMP TABLE surveys(id integer, title text, description text, status text, start_date timestamptz, end_date timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE survey_responses(id integer, survey_id integer, employee_id integer, submitted_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE survey_questions(id integer, survey_id integer, question_text text, dimension_code text, required boolean, display_order integer) ON COMMIT DROP;
      CREATE TEMP TABLE survey_answers(id integer, response_id integer, question_id integer, score integer, comment text) ON COMMIT DROP;
      SET LOCAL search_path TO pg_temp;
      INSERT INTO role VALUES (1,'HR'),(2,'EMPLOYEE'),(3,'ADMIN');
      INSERT INTO users VALUES (1,1,'ACTIVE'),(2,2,'ACTIVE'),(3,1,'INACTIVE'),(4,3,'ACTIVE');
      INSERT INTO employees VALUES (11,'EMP011','Employee A','ACTIVE'),(12,'EMP012','Employee B','INACTIVE'),(13,'EMP013','Draft only','ACTIVE');
      INSERT INTO surveys VALUES (1,'Target survey','Test','ACTIVE',now(),now()),(2,'Other survey','Other','ACTIVE',now(),now()),(3,'Empty survey','Empty','DRAFT',now(),now());
      INSERT INTO survey_questions VALUES (1,1,'Question 1','JS01',true,1),(2,1,'Optional question','JS02',false,2),(3,2,'Other question','JS01',true,1);
      INSERT INTO survey_responses VALUES (10,1,11,'2026-10-29T08:00:00Z'),(20,1,12,'2026-10-29T09:00:00Z'),(30,1,13,null),(40,2,11,now());
      INSERT INTO survey_answers VALUES (1,10,1,4,'ổn đấy'),(2,10,2,3,null),(3,20,1,2,'Cần cải thiện'),(4,30,1,1,'draft hidden'),(5,40,3,1,'other survey hidden');`);
    const repository = new SurveysRepository({ query: (sql, args) => {
      assert(!/\bpublic\./i.test(sql));
      return client.query(sql, args);
    } });
    const app = express();
    app.use('/api/surveys', createSurveysRouter({ surveysController: new SurveysController(new SurveysService({ surveysRepository: repository })),
      authenticate: (req, res, next) => {
        if (!req.headers['x-test-actor']) return res.status(401).json({ message: 'Missing token' });
        req.auth = { userId: Number(req.headers['x-test-actor']) }; next();
      } }));
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const get = (id, actor = 1) => fetch(`http://127.0.0.1:${server.address().port}/api/surveys/${id}/responses`, { headers: actor ? { 'x-test-actor': String(actor) } : {} });
    const response = await get(1);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const { data } = await response.json();
    assert.equal(data.survey.title, 'Target survey');
    assert.equal(data.responseCount, 2);
    assert.equal(data.participants.length, 2);
    assert.equal(data.participants[0].employee.id, 12, 'Inactive employee historical response remains visible');
    assert.equal(data.participants[0].answers[1].score, null, 'Unanswered optional question included');
    assert.equal(data.participants[1].answers[0].comment, 'ổn đấy');
    assert.equal(data.participants[1].answers[0].score, 4);
    assert.equal(data.participants[1].answers[1].comment, null);
    assert(!JSON.stringify(data).includes('draft hidden'));
    assert(!JSON.stringify(data).includes('other survey hidden'));
    const empty = (await (await get(3)).json()).data;
    assert.equal(empty.responseCount, 0); assert.deepEqual(empty.participants, []);
    assert.equal((await get(999)).status, 404);
    for (const actor of [2, 3, 4]) assert.equal((await get(1, actor)).status, 403);
    assert.equal((await get(1, null)).status, 401);
    for (const id of ['0', '-1', 'abc', '1e0', '2147483648']) assert.equal((await get(id)).status, 400);
    console.log('PASS HTTP + PostgreSQL TEMP: nested answers, nulls, ordering, draft exclusion, survey isolation, empty survey, HR permissions and ID limits.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK'); client.release(); await databasePool.end();
  }
});
