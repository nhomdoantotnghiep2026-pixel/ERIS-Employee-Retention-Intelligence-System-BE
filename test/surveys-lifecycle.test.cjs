const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path")

const root = path.resolve(__dirname, ".."),
  mod = (p) => require(path.join(root, p))

const v = mod("src/modules/surveys/surveys.validation")

test("participant HTTP routes validate IDs, require auth, preserve scope and return private responses", async () => {
  const express = mod("node_modules/express"),
    { AppError } = mod("src/common/errors/app-error"),
    { createSurveysRouter } = mod("src/modules/surveys/surveys.routes"),
    { SurveysController } = mod("src/modules/surveys/surveys.controller"),
    { errorHandler } = mod("src/common/middleware/error-handler")
  const calls = []

  const app = express()
  app.use(express.json())
  app.use(
    "/api/surveys",
    createSurveysRouter({
      authenticate: (req, res, next) => {
        if (!req.headers.authorization)
          return next(new AppError(401, "Login required"))
        req.auth = {
          userId: req.headers.authorization === "Bearer employee" ? 2 : 1,
        }
        next()
      },
      surveysController: new SurveysController({
        getSurveyParticipants: async ({
          actorId: actor,
          surveyId: survey,
          employeeId: employee = null,
        }) => {
          if (actor !== 1) throw new AppError(403, "HR required")
          calls.push([actor, survey, employee])
          return employee
            ? {
                employeeId: employee,
                surveyId: survey,
                answers: [{ questionText: "Question", displayAnswer: "4/5" }],
              }
            : [{ employeeId: 10, responseId: 100, answerCount: 4 }]
        },
      }),
    }),
  )
  app.use(errorHandler)
  const server = app.listen(0, "127.0.0.1")
  await new Promise((resolve) => server.once("listening", resolve))
  try {
    const url =
      "http://127.0.0.1:" +
      server.address().port +
      "/api/surveys/7/participants"
    assert.equal((await fetch(url)).status, 401)
    assert.equal(
      (await fetch(url, { headers: { Authorization: "Bearer employee" } }))
        .status,
      403,
    )
    const list = await fetch(url, { headers: { Authorization: "Bearer hr" } })
    assert.equal(list.status, 200)
    assert.match(list.headers.get("cache-control"), /no-store/)
    assert.deepEqual((await list.json()).data, [
      { employeeId: 10, responseId: 100, answerCount: 4 },
    ])
    const detail = await fetch(url + "/10", {
      headers: { Authorization: "Bearer hr" },
    })
    assert.equal(detail.status, 200)
    assert.equal((await detail.json()).data.employeeId, 10)
    assert.equal(
      (await fetch(url + "/bad", { headers: { Authorization: "Bearer hr" } }))
        .status,
      400,
    )
    assert.equal(
      (
        await fetch(url + "?unexpected=1", {
          headers: { Authorization: "Bearer hr" },
        })
      ).status,
      400,
    )
    assert.deepEqual(calls, [
      [1, 7, null],
      [1, 7, 10],
    ])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("survey input validation remains independent from authored question files", () => {
  const body = { title: "Flexible", categoryIds: [1] }
  assert.deepEqual(v.survey(body).categoryIds, [1])
  assert.throws(
    () => v.survey({ ...body, cycleNumber: 1 }),
    (error) => error.statusCode === 400,
  )

  for (const value of [null, "5", 0, 6, 1.5])
    assert.throws(
      () =>
        v.answers({ answers: [{ questionId: 1, answerValue: value }] }, [
          { id: 1, questionType: "RATING" },
        ]),
      (error) => error.statusCode === 400,
    )

  assert.throws(
    () =>
      v.question({
        questionText: "Fake",
        categoryId: 1,
        questionType: "RATING",
        answerConfig: { ...v.ratingConfig(), templateCode: "FAKE" },
      }),
    (error) => error.statusCode === 400,
  )
})

test(
  "TEMP lifecycle without cycle columns: mixed categories, bank/custom, OTHER-only, score, freeze and history",
  { skip: process.env.RUN_SURVEYS_DB_TESTS !== "1" },
  async () => {
    const { databasePool: p } = mod("src/config/database"),
      { SurveysService } = mod("src/modules/surveys/surveys.service"),
      { SurveysRepository, readCatalog } = mod(
        "src/modules/surveys/surveys.repository",
      )
    const c = await p.connect()
    try {
      await c.query(`CREATE TEMP TABLE role(id int PRIMARY KEY,name text);CREATE TEMP TABLE users(id int PRIMARY KEY,role_id int,status text,employee_id int);CREATE TEMP TABLE employees(id int PRIMARY KEY,employee_code text,full_name text,employment_status text);
 CREATE TEMP TABLE surveys(id serial PRIMARY KEY,title varchar(255),description text,start_date timestamptz,end_date timestamptz,status text DEFAULT 'DRAFT',created_by int,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,updated_at timestamptz DEFAULT CURRENT_TIMESTAMP);
 CREATE TEMP TABLE survey_categories(id int PRIMARY KEY,name text,description text);
 CREATE TEMP TABLE survey_questions(id serial PRIMARY KEY,question_text text,category_id int,question_type public.survey_question_type,survey_id int,answer_config jsonb,display_order int DEFAULT 0,created_at timestamptz DEFAULT CURRENT_TIMESTAMP);
 CREATE TEMP TABLE survey_responses(id serial PRIMARY KEY,survey_id int,employee_id int,submitted_at timestamptz,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(survey_id,employee_id));
 CREATE TEMP TABLE survey_answers(id serial PRIMARY KEY,response_id int,question_id int,answer_value jsonb,comment text,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(response_id,question_id));
 CREATE TEMP TABLE audit_logs(user_id int,entity_type text,entity_id int,action text,old_value jsonb,new_value jsonb);
 INSERT INTO role VALUES(1,'HR'),(2,'EMPLOYEE');INSERT INTO users VALUES(1,1,'ACTIVE',NULL),(2,2,'ACTIVE',10),(3,2,'ACTIVE',11),(4,2,'INACTIVE',12);
 INSERT INTO employees VALUES(10,'TEST10','Test10','ACTIVE'),(11,'TEST11','Test11','ACTIVE'),(12,'TEST12','Test12','ACTIVE');INSERT INTO survey_categories VALUES(1,'COMPENSATION_BENEFITS','Pay'),(2,'WORKING_TIME','Time'),(3,'JOB_FIT','Work'),(9,'OTHER','Other');`)

      const service = new SurveysService({
        surveysRepository: new SurveysRepository({
          connect: async () => ({
            query: (...a) => c.query(...a),
            release() {},
          }),
        }),
      })

      // Test adapters retain the concise lifecycle scenarios while exercising the canonical module.

      const s = {
        categories: () => readCatalog(c),
        questions: (_client, id) => new SurveysRepository(c).findQuestions(id),

        create: (actorId, body) =>
          service.createSurvey({
            actorId,
            survey: v.validateCreateSurveyInput(body),
          }),

        list: (actorId, available = false) =>
          available
            ? service.listAvailableSurveys(actorId)
            : service.listSurveys(actorId),

        detail: (actorId, surveyId) => service.getSurvey({ actorId, surveyId }),

        edit: (actorId, surveyId, body) =>
          service.updateSurvey({
            actorId,
            surveyId,
            survey: v.validateUpdateSurveyInput(body),
          }),

        question: (actorId, surveyId, questionId, body, remove = false) =>
          service.saveQuestion({
            actorId,
            surveyId,
            questionId,
            question: remove ? null : v.validateSurveyQuestionInput(body),
            remove,
          }),

        transition: (actorId, surveyId, close = false) =>
          close
            ? service.closeSurvey({ actorId, surveyId })
            : service.publishSurvey({ actorId, surveyId }),

        submit: (actorId, surveyId, response) =>
          service.submitSurveyResponse({ actorId, surveyId, response }),

        participants: (actorId, surveyId, employeeId = null) =>
          service.getSurveyParticipants({ actorId, surveyId, employeeId }),

        responses: (actorId, surveyId, responseId = null, own = false) =>
          service.getSurveyResponses({ actorId, surveyId, responseId, own }),

        results: (actorId, surveyId) =>
          service.getSurveyResults({ actorId, surveyId }),
      }

      const window = {
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
      }

      const testCatalogRows = []
      for (const category of [
        { id: 1, name: "COMPENSATION_BENEFITS" },
        { id: 2, name: "WORKING_TIME" },
        { id: 3, name: "JOB_FIT" },
        { id: 9, name: "OTHER" },
      ]) {
        for (let index = 1; index <= 4; index++)
          testCatalogRows.push({
            categoryId: category.id,
            questionText: `Default ${category.name} ${index}?`,
            questionType: "RATING",
            displayOrder: index,
            answerConfig: {
              erisCatalog: {
                source: "ERIS_SURVEY_CATALOG",
                kind: "SATISFACTION",
                code: `TEST_${category.name}_${index}`,
                version: 1,
              },
              answerConfig: v.ratingConfig(),
            },
          })

        for (let index = 1; index <= 10; index++)
          testCatalogRows.push({
            categoryId: category.id,
            questionText: `Bank ${category.name} ${index}?`,
            questionType:
              index === 1
                ? "MULTIPLE_CHOICE"
                : index === 7
                  ? "SINGLE_CHOICE"
                  : "TEXT",
            displayOrder: index,
            answerConfig: {
              erisCatalog: {
                source: "ERIS_SURVEY_CATALOG",
                kind: "BANK",
                code: `TEST_BANK_${category.name}_${index}`,
                version: 1,
              },
              answerConfig:
                index === 1 || index === 7
                  ? {
                      options: [
                        { code: "A", label: "Option A" },
                        { code: "B", label: "Option B" },
                      ],
                    }
                  : null,
            },
          })
      }

      for (const row of testCatalogRows)
        await c.query(
          "INSERT INTO survey_questions(survey_id,category_id,question_text,question_type,answer_config,display_order) VALUES(NULL,$1,$2,$3,$4::jsonb,$5)",
          [
            row.categoryId,
            row.questionText,
            row.questionType,
            JSON.stringify(row.answerConfig),
            row.displayOrder,
          ],
        )

      const cats = await s.categories(c)
      assert.equal(cats.length, 4)
      assert.ok(
        cats.every(
          (c) =>
            c.defaultQuestions.length === 4 && c.questionBank.length === 10,
        ),
      )

      const selectedBank = cats[0].questionBank[0]
      const bankRequest = {
        questionText: selectedBank.questionText,
        categoryId: 1,
        questionType: selectedBank.questionType,
        answerConfig: selectedBank.answerConfig,
      }

      const body = {
        title: "Flexible",
        categoryIds: [1, 2, 9],
        questions: [
          bankRequest,
          {
            questionText: "My own question",
            categoryId: 9,
            questionType: "TEXT",
          },
        ],
        ...window,
      }

      await assert.rejects(
        s.create(1, { ...body, categoryIds: [999] }),
        (e) => e.statusCode === 400,
      )

      await assert.rejects(
        s.create(1, { ...body, categoryIds: [1, 1] }),
        (e) => e.statusCode === 400,
      )

      await assert.rejects(
        s.create(1, { ...body, categoryIds: [1] }),
        (e) => e.statusCode === 400,
      )

      await assert.rejects(
        s.create(1, { ...body, questions: [...body.questions, bankRequest] }),
        (e) => e.statusCode === 400,
      )

      const survey = await s.create(1, body),
        id = survey.id
      assert.equal(survey.cycleNumber, undefined)
      assert.equal((await s.list(1)).length, 1)
      let qs = await s.questions(c, id)
      assert.equal(qs.length, 14)
      assert.equal(qs.filter((q) => q.isSatisfactionCore).length, 12)

      await assert.rejects(
        s.question(1, id, qs[0].id, null, true),
        (e) => e.statusCode === 409,
      )

      await assert.rejects(
        s.question(1, id, null, {
          questionText: "Unselected",
          categoryId: 3,
          questionType: "TEXT",
        }),
        (e) => e.statusCode === 400,
      )

      const custom = await s.question(1, id, null, {
        questionText: "Frequency",
        categoryId: 2,
        questionType: "RATING",
        answerConfig: {
          min: 1,
          max: 5,
          labels: ["Never", "Rarely", "Sometimes", "Often", "Always"],
        },
      })

      const other = await s.create(1, {
        title: "Only OTHER",
        categoryIds: [9],
        ...window,
      })
      assert.equal((await s.questions(c, other.id)).length, 4)
      await s.transition(1, other.id)

      await s.transition(1, id)
      qs = await s.questions(c, id)

      await assert.rejects(
        s.question(1, id, custom.id, null, true),
        (e) => e.statusCode === 409,
      )
      await assert.rejects(
        s.edit(1, id, { title: "Changed" }),
        (e) => e.statusCode === 409,
      )

      await assert.rejects(
        s.submit(2, id, { answers: [] }),
        (e) => e.statusCode === 400,
      )

      const answers = qs.map((q) => ({
        questionId: q.id,
        answerValue:
          q.questionType === "TEXT"
            ? "Need support"
            : q.questionType === "MULTIPLE_CHOICE"
              ? { selectedCodes: [q.answerConfig.options[0].code] }
              : q.isSatisfactionCore
                ? q.categoryId === 1
                  ? 1
                  : q.categoryId === 2
                    ? 5
                    : 3
                : 5,
      }))

      await c.query(
        "ALTER TABLE pg_temp.audit_logs ADD CONSTRAINT fail_submit CHECK(entity_type<>'survey_responses') NOT VALID",
      )
      await assert.rejects(s.submit(2, id, { answers }))
      assert.equal(
        (await c.query("SELECT count(*)::int n FROM pg_temp.survey_answers"))
          .rows[0].n,
        0,
      )
      await c.query(
        "ALTER TABLE pg_temp.audit_logs DROP CONSTRAINT fail_submit",
      )

      const result = await s.submit(2, id, { answers })
      assert.equal(result.satisfactionScore, 3)

      const participants = await s.participants(1, id)
      assert.equal(participants.length, 1)
      assert.equal(participants[0].employeeId, 10)
      assert.equal(participants[0].answerCount, qs.length)
      assert.equal(participants[0].answers, undefined)

      const employeeResponse = await s.participants(1, id, 10)
      assert.equal(employeeResponse.surveyId, id)
      assert.equal(employeeResponse.answers.length, qs.length)
      assert.ok(
        employeeResponse.answers.every(
          (a) => a.questionText && a.questionType && a.categoryName,
        ),
      )

      const choice = employeeResponse.answers.find(
        (a) => a.questionType === "MULTIPLE_CHOICE",
      )
      assert.deepEqual(choice.selectedOptions, [
        {
          code: selectedBank.answerConfig.options[0].code,
          label: selectedBank.answerConfig.options[0].label,
        },
      ])
      assert.equal(
        choice.displayAnswer,
        selectedBank.answerConfig.options[0].label,
      )

      const rating = employeeResponse.answers.find((a) => a.isSatisfactionCore)
      assert.ok(rating.displayAnswer.startsWith("1/5"))
      assert.equal(
        employeeResponse.answers.find((a) => a.questionType === "TEXT")
          .displayAnswer,
        "Need support",
      )

      const detail = await s.detail(1, id)
      assert.equal(detail.participantCount, 1)
      assert.equal(detail.invitedCount, 2)

      await assert.rejects(
        s.participants(1, id, 11),
        (e) => e.statusCode === 404,
      )
      await assert.rejects(
        s.participants(1, other.id, 10),
        (e) => e.statusCode === 404,
      )
      await assert.rejects(s.participants(2, id), (e) => e.statusCode === 403)
      await assert.rejects(
        s.participants(1, 99999),
        (e) => e.statusCode === 404,
      )

      assert.equal(
        (await s.responses(1, id, result.responseId)).answers.length,
        qs.length,
      )

      await assert.rejects(
        s.submit(2, id, { answers }),
        (e) => e.statusCode === 409,
      )

      const { periodSatisfaction } = mod(
          "src/modules/surveys/surveys.repository",
        ),
        cutoff = (await c.query("SELECT clock_timestamp() AS now")).rows[0].now

      assert.equal(await periodSatisfaction(c, 10, cutoff, "2000-01-01"), 3)

      assert.equal(await periodSatisfaction(c, 11, cutoff, "2000-01-01"), null)

      const report = await s.results(1, id)
      assert.equal(report.categoryScores.length, 3)
      assert.equal(
        report.categoryScores.find((c) => c.categoryId === 9).satisfactionScore,
        3,
      )
      assert.equal(
        report.questions.find((q) => q.id === custom.id).averageScore,
        5,
      )
      assert.equal(report.completionRate, 50)

      await s.transition(1, id, true)
      await assert.rejects(
        s.submit(3, id, { answers }),
        (e) => e.statusCode === 409,
      )
      assert.equal((await s.responses(2, id, null, true)).satisfactionScore, 3)

      // Previously stored V1 snapshots remain publishable when the current catalog is V2.

      const legacy = (
        await c.query(
          "INSERT INTO surveys(title,start_date,end_date,status) VALUES('V1',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 day','DRAFT') RETURNING id",
        )
      ).rows[0]

      await c.query(
        "INSERT INTO survey_questions(survey_id,question_text,category_id,question_type,answer_config) VALUES($1,'Original V1 wording',1,'RATING',$2)",
        [legacy.id, { ...v.ratingConfig(), templateCode: "ERIS_PAY_V1" }],
      )
      await s.transition(1, legacy.id)

      console.log(
        "PASS TEMP only: no schema migration and no public business writes.",
      )
    } finally {
      await c.query("ROLLBACK")
      await c.query("DISCARD TEMP")
      c.release()
      await p.end()
    }
  },
)
