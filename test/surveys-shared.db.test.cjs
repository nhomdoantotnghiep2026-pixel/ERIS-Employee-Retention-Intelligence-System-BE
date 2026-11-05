const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { databasePool } = require('../src/config/database');
const { SurveysRepository } = require('../src/modules/surveys/surveys.repository');
const { SurveysService } = require('../src/modules/surveys/surveys.service');
const { SurveysController } = require('../src/modules/surveys/surveys.controller');
const { createSurveysRouter } = require('../src/modules/surveys/surveys.routes');

test('shared survey lifecycle: all 12 endpoints and SQL constraints in temporary tables', async () => {
  const client = await databasePool.connect();
  let server;
  try {
    await client.query(`SET search_path TO pg_temp;
      CREATE TEMP TABLE role(id integer PRIMARY KEY, name text);
      CREATE TEMP TABLE users(id integer PRIMARY KEY, role_id integer, status text, employee_id integer, full_name text);
      CREATE TEMP TABLE employees(id integer PRIMARY KEY, employee_code text, full_name text, employment_status text, hire_date date);
      CREATE TEMP TABLE audit_logs(user_id integer, entity_type text, entity_id bigint, action text, old_value jsonb, new_value jsonb);
      INSERT INTO role VALUES (1,'HR'),(2,'EMPLOYEE'),(3,'ADMIN');
      INSERT INTO users VALUES (1,1,'ACTIVE',NULL,'HR'),(2,2,'ACTIVE',11,'Employee'),(3,2,'ACTIVE',12,'New hire'),(4,1,'ACTIVE',13,'HR employee'),(5,3,'ACTIVE',NULL,'Admin');
      INSERT INTO employees VALUES (11,'E11','Employee','ACTIVE',CURRENT_DATE-INTERVAL '1 year'),
        (12,'E12','New hire','ACTIVE',CURRENT_DATE),(13,'E13','HR employee','ACTIVE',CURRENT_DATE-INTERVAL '1 year');`);
    const sql = fs.readFileSync(path.join(__dirname, '../../TalentGuard_PostgreSQL_Fixed.sql'), 'utf8');
    for (const table of ['surveys', 'survey_questions', 'survey_responses', 'survey_answers']) {
      const definition = sql.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`));
      assert(definition, `SQL contains ${table}`);
      await client.query(definition[0].replace('CREATE TABLE', 'CREATE TEMP TABLE'));
    }
    for (const statement of sql.match(/CREATE UNIQUE INDEX uq_survey_(?:response_employee|answer_question)[\s\S]*?;/g)) {
      await client.query(statement);
    }
    const triggers = sql.slice(sql.indexOf('-- Shared questions are immutable'), sql.indexOf('-- Optional starter roles.'))
      .replace(/CREATE FUNCTION (\w+)/g, 'CREATE FUNCTION pg_temp.$1')
      .replace(/EXECUTE FUNCTION (\w+)/g, 'EXECUTE FUNCTION pg_temp.$1');
    await client.query(triggers);
    await client.query(sql.match(/INSERT INTO survey_questions \(question_text, display_order\) VALUES[\s\S]*?;/)[0]);
    const repository = new SurveysRepository({ query: (...args) => client.query(...args),
      connect: async () => ({ query: (...args) => client.query(...args), release() {} }) });
    const app = express();
    app.use(express.json());
    app.use('/api/surveys', createSurveysRouter({
      surveysController: new SurveysController(new SurveysService({ surveysRepository: repository })),
      authenticate(req, _res, next) { req.auth = { userId: Number(req.headers['x-test-actor'] || 1) }; next(); }
    }));
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const request = async (method, route, body, actor = 1) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/surveys${route}`, {
        method, headers: { 'content-type': 'application/json', 'x-test-actor': String(actor) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, ...(await response.json()) };
    };
    const dates = { startDate: new Date(Date.now() - 60000).toISOString(), endDate: new Date(Date.now() + 3600000).toISOString() };
    const created = await request('POST', '', { title: 'Shared survey', ...dates });
    assert.equal(created.status, 201, JSON.stringify(created));
    const id = created.data.id;
    assert.equal(created.data.questions.length, 12);
    assert.match(created.data.questions[0].questionText, /Tôi/);
    assert.equal((await request('POST', '', { title: 'Other survey' })).status, 201);
    assert.equal((await repository.findQuestions()).length, 12, 'Creating another survey never duplicates questions');
    assert.equal((await request('GET', '')).data.length, 2);
    assert.equal((await request('GET', `/${id}`)).status, 200, 'HR without employee profile views drafts');
    assert.equal((await request('PATCH', `/${id}`, { description: 'Updated' })).data.description, 'Updated');
    assert.equal((await request('PATCH', `/${id}`, { title: null })).status, 400);
    assert.equal((await request('POST', `/${id}/publish`)).status, 200);
    assert.equal((await request('PATCH', `/${id}`, { title: 'Forbidden' })).status, 409);
    assert.equal((await request('GET', '/available', undefined, 2)).data.length, 1);
    assert.equal((await request('GET', '/available', undefined, 4)).status, 200, 'HR employee can participate');
    assert.equal((await request('GET', '/available', undefined, 3)).status, 403, 'New hire cannot participate');
    assert.equal((await request('GET', '/available', undefined, 5)).status, 403);
    assert.equal((await request('GET', `/${id}`, undefined, 2)).data.questions.length, 12);
    const answers = created.data.questions.map((question, index) => ({ questionId: question.id, score: index ? 4 : 5 }));
    assert.equal((await request('POST', `/${id}/responses`, { answers: answers.slice(1) }, 2)).status, 400);
    assert.equal((await request('POST', `/${id}/responses`, { answers: answers.map(a => ({ ...a, score: 4.5 })) }, 2)).status, 400);
    assert.equal((await request('POST', `/${id}/responses`, { answers: answers.map(a => ({ ...a, score: 6 })) }, 2)).status, 400);
    assert.equal((await request('POST', `/${id}/responses`, { answers: [answers[0], ...answers.slice(0, 11)] }, 2)).status, 400);
    const submitted = await request('POST', `/${id}/responses`, { answers }, 2);
    assert.equal(submitted.status, 201, JSON.stringify(submitted));
    assert.equal(submitted.data.satisfactionScore, 4.0833);
    assert.equal((await request('POST', `/${id}/responses`, { answers }, 2)).status, 409);
    assert.equal((await request('GET', '/available', undefined, 2)).data.length, 0);
    assert.equal((await request('GET', `/${id}/my-response`, undefined, 2)).data.response.satisfactionScore, 4.0833);
    assert.equal((await request('GET', `/${id}/my-response`, undefined, 4)).status, 404);
    const results = await request('GET', `/${id}/results`);
    assert.equal(results.data.questions[0].scoreDistribution[5], 1);
    assert.equal(results.data.responseCount, 1);
    assert.equal((await request('GET', `/${id}/results`, undefined, 2)).status, 403);
    assert.equal((await request('GET', `/${id}/responses`)).data.responseCount, 1);
    assert.equal((await request('GET', `/${id}/responses/${submitted.data.responseId}`)).data.response.answers.length, 12);
    assert.equal((await request('GET', `/2/responses/${submitted.data.responseId}`)).status, 404);
    assert.equal((await request('POST', `/${id}/close`)).data.status, 'CLOSED');
    assert.equal((await request('POST', `/${id}/close`)).status, 200);
    assert.equal((await request('POST', `/${id}/responses`, { answers }, 4)).status, 409);
    assert.equal((await request('GET', `/${id}/my-response`, undefined, 2)).status, 200);
    await assert.rejects(client.query("UPDATE survey_questions SET question_text='Changed' WHERE id=1"), /cannot change/);
    await assert.rejects(client.query('DELETE FROM survey_answers WHERE response_id=$1 AND question_id=$2',
      [submitted.data.responseId, answers[0].questionId]), /must answer all/);
    assert.equal(Number((await client.query('SELECT COUNT(*) FROM audit_logs')).rows[0].count), 5);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    client.release(true);
    await databasePool.end();
  }
});
