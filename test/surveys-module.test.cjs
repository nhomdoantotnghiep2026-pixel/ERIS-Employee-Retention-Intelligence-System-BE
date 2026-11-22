const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express")

const { SurveysService } = require("../src/modules/surveys/surveys.service")

const {
  SurveysController,
} = require("../src/modules/surveys/surveys.controller")

const { createSurveysRouter } = require("../src/modules/surveys/surveys.routes")

const {
  SurveysRepository,
} = require("../src/modules/surveys/surveys.repository")

const v = require("../src/modules/surveys/surveys.validation")

const templates = (category) =>
  Array.from({ length: 4 }, (_, index) => ({
    templateCode: `TEST_${category.name}_${index + 1}`,
    questionText: `Default ${category.name} ${index + 1}?`,
    categoryId: category.id,
    questionType: "RATING",
    answerConfig: v.ratingConfig(),
  }))

const bank = (category) =>
  Array.from({ length: 10 }, (_, index) => ({
    bankCode: `TEST_BANK_${category.name}_${index + 1}`,
    questionText: `Bank ${category.name} ${index + 1}?`,
    categoryId: category.id,
    questionType:
      index === 0
        ? "MULTIPLE_CHOICE"
        : index === 1
          ? "SINGLE_CHOICE"
          : "TEXT",
    answerConfig:
      index < 2
        ? {
            options: [
              { code: "A", label: "Option A" },
              { code: "B", label: "Option B" },
            ],
          }
        : null,
  }))

function fixture() {
  let state = {
    surveys: [],

    questions: [],

    responses: [],

    answers: [],

    audits: [],

    next: 1,
  }

  const actors = {
    1: { id: 1, role: "HR" },

    2: { id: 2, role: "EMPLOYEE", employeeId: 10 },

    3: { id: 3, role: "EMPLOYEE", employeeId: 11 },

    4: { id: 4, role: "ADMIN" },
  }

  const categories = [
    { id: 1, name: "COMPENSATION_BENEFITS", description: "Pay" },

    { id: 9, name: "OTHER", description: "Other" },
  ].map((c) => ({
    ...c,

    defaultQuestions: templates(c),

    questionBank: bank(c),
  }))

  const repository = {
    failAudit: false,

    async withTransaction(fn) {
      const before = structuredClone(state)

      try {
        return await fn(this)
      } catch (error) {
        state = before

        throw error
      }
    },

    async findActorById(id) {
      return actors[id] || null
    },

    async findActiveEmployeeById(id) {
      return [10, 11, 12].includes(id) ? { id } : null
    },

    async findCategoryCatalog() {
      return structuredClone(categories)
    },

    async findById(id) {
      return structuredClone(state.surveys.find((s) => s.id === id) || null)
    },

    async findAll() {
      return structuredClone(state.surveys)
    },

    async create(input, actorId) {
      const row = {
        ...input,

        id: state.next++,

        status: "DRAFT",

        createdBy: actorId,
      }

      delete row.categoryIds

      delete row.questions

      state.surveys.push(row)

      return { id: row.id }
    },

    async update(id, survey) {
      Object.assign(
        state.surveys.find((s) => s.id === id),

        survey,
      )
    },

    async updateStatus(id, status) {
      state.surveys.find((s) => s.id === id).status = status
    },

    async findQuestions(id) {
      return structuredClone(state.questions.filter((q) => q.surveyId === id))
    },

    async findQuestionById(id, qid) {
      return structuredClone(
        state.questions.find((q) => q.surveyId === id && q.id === qid) || null,
      )
    },

    async saveQuestion(id, q, qid) {
      const row = {
        ...structuredClone(q),

        id: qid || state.next++,

        surveyId: id,

        isRequired: true,

        isSatisfactionCore: Boolean(q.answerConfig?.templateCode),
      }

      if (qid) state.questions = state.questions.filter((x) => x.id !== qid)

      state.questions.push(row)

      return structuredClone(row)
    },

    async deleteQuestion(id) {
      state.questions = state.questions.filter((q) => q.id !== id)
    },

    async audit(actorId, id, action, before, after) {
      if (this.failAudit) throw Error("audit failed")

      state.audits.push({ actorId, id, action, before, after })
    },

    async auditResponse(actorId, id, data) {
      if (this.failAudit) throw Error("audit failed")

      state.audits.push({ actorId, id, action: "SUBMIT", data })
    },

    async inviteActiveEmployees(id) {
      for (const employeeId of [10, 11])
        state.responses.push({
          responseId: state.next++,

          employeeId,

          surveyId: id,

          submittedAt: null,

          employeeCode: "EMP" + employeeId,

          fullName: "Test " + employeeId,
        })
    },

    async findResponseCounts(id) {
      const rows = state.responses.filter((r) => r.surveyId === id)

      return {
        invitedCount: rows.length,

        participantCount: rows.filter((r) => r.submittedAt).length,
      }
    },

    async findAssignedResponse(id, eid) {
      const r = state.responses.find(
        (r) => r.surveyId === id && r.employeeId === eid,
      )

      return r ? { id: r.responseId, submittedAt: r.submittedAt } : null
    },

    async replaceAnswers(id, answers) {
      state.answers = state.answers.filter((a) => a.responseId !== id)

      for (const a of answers) state.answers.push({ ...a, responseId: id })
    },

    async markResponseSubmitted(id) {
      const r = state.responses.find((r) => r.responseId === id)

      return (r.submittedAt = new Date().toISOString())
    },

    async findResponses(id, { employeeId, responseId, submittedOnly }) {
      return structuredClone(
        state.responses

          .filter(
            (r) =>
              r.surveyId === id &&
              (!employeeId || r.employeeId === employeeId) &&
              (!responseId || r.responseId === responseId) &&
              (!submittedOnly || r.submittedAt),
          )

          .map(({ surveyId, ...r }) => r),
      )
    },

    async findAnswers(id, ids) {
      return structuredClone(
        state.answers

          .filter((a) => ids.includes(a.responseId))

          .map((a) => {
            const q = state.questions.find((q) => q.id === a.questionId)

            return {
              ...q,

              ...a,

              questionId: q.id,

              categoryName: categories.find((c) => c.id === q.categoryId).name,
            }
          }),
      )
    },

    async findResultResponses(id) {
      return state.responses

        .filter((r) => r.surveyId === id)

        .map((r) => ({ id: r.responseId, submitted_at: r.submittedAt }))
    },

    async findSubmittedAnswers(id) {
      const ids = state.responses

        .filter((r) => r.surveyId === id && r.submittedAt)

        .map((r) => r.responseId)

      return structuredClone(
        state.answers.filter((a) => ids.includes(a.responseId)),
      )
    },
  }

  return {
    repository,

    service: new SurveysService({ surveysRepository: repository }),

    state: () => state,

    actors,

    categories,
  }
}

const input = (overrides = {}) =>
  v.validateCreateSurveyInput({
    title: "Test survey",

    categoryIds: [1],

    startDate: new Date(Date.now() - 86400000).toISOString(),

    endDate: new Date(Date.now() + 86400000).toISOString(),

    ...overrides,
  })

const bodyFor = (qs) => ({
  answers: qs.map((q, i) => ({
    questionId: q.id,

    answerValue:
      q.questionType === "TEXT"
        ? "Need support"
        : q.questionType === "MULTIPLE_CHOICE" ||
            q.questionType === "SINGLE_CHOICE"
          ? { selectedCodes: [q.answerConfig.options[0].code] }
          : [1, 3, 4, 5][i % 4],
  })),
})

test("create draft keeps selected topics, bank/custom questions and default IDs; invalid creates roll back", async () => {
  const f = fixture(),
    s = f.service

  const custom = {
    questionText: "My note",

    categoryId: 9,

    questionType: "TEXT",
  }

  const survey = await s.createSurvey({
    actorId: 1,

    survey: input({ categoryIds: [1, 9], questions: [custom] }),
  })

  const qs = await f.repository.findQuestions(survey.id)

  assert.equal(qs.length, 9)

  assert.equal(qs.filter((q) => q.isSatisfactionCore).length, 8)

  assert.equal(f.state().audits[0].action, "CREATE")

  const before = f.state().surveys.length

  for (const fields of [
    { categoryIds: [999] },

    { questions: [custom] },

    {
      questions: [
        { questionText: "Same", categoryId: 1, questionType: "TEXT" },

        { questionText: "Same", categoryId: 1, questionType: "TEXT" },
      ],
    },

    {
      questions: Array.from({ length: 200 }, (_, i) => ({
        questionText: "Question " + i,

        categoryId: 1,

        questionType: "TEXT",
      })),
    },
  ])
    await assert.rejects(
      s.createSurvey({ actorId: 1, survey: input(fields) }),

      (e) => e.statusCode === 400,
    )

  assert.equal(f.state().surveys.length, before)
})

test("question edits are draft-only, scoped, limited to selected topics and protect satisfaction defaults", async () => {
  const f = fixture(),
    s = f.service,
    survey = await s.createSurvey({ actorId: 1, survey: input() })

  const core = (await f.repository.findQuestions(survey.id))[0]

  await assert.rejects(
    s.saveQuestion({
      actorId: 1,

      surveyId: survey.id,

      questionId: core.id,

      remove: true,
    }),

    (e) => e.statusCode === 409,
  )

  await assert.rejects(
    s.saveQuestion({
      actorId: 1,

      surveyId: survey.id,

      questionId: 999,

      remove: true,
    }),

    (e) => e.statusCode === 404,
  )

  await assert.rejects(
    s.saveQuestion({
      actorId: 1,

      surveyId: survey.id,

      question: v.question({
        questionText: "Other",

        categoryId: 9,

        questionType: "TEXT",
      }),
    }),

    (e) => e.statusCode === 400,
  )

  const custom = await s.saveQuestion({
    actorId: 1,

    surveyId: survey.id,

    question: v.question({
      questionText: "My question",

      categoryId: 1,

      questionType: "TEXT",
    }),
  })

  await s.saveQuestion({
    actorId: 1,

    surveyId: survey.id,

    questionId: custom.id,

    question: v.question({
      questionText: "Edited",

      categoryId: 1,

      questionType: "TEXT",
    }),
  })

  assert.equal(
    (await f.repository.findQuestionById(survey.id, custom.id)).questionText,

    "Edited",
  )

  await s.saveQuestion({
    actorId: 1,

    surveyId: survey.id,

    questionId: custom.id,

    remove: true,
  })

  assert.equal(await f.repository.findQuestionById(survey.id, custom.id), null)

  await s.publishSurvey({ actorId: 1, surveyId: survey.id })

  await assert.rejects(
    s.updateSurvey({
      actorId: 1,

      surveyId: survey.id,

      survey: { title: "Changed" },
    }),

    (e) => e.statusCode === 409,
  )

  await assert.rejects(
    s.saveQuestion({
      actorId: 1,

      surveyId: survey.id,

      question: v.question({
        questionText: "Late",

        categoryId: 1,

        questionType: "TEXT",
      }),
    }),

    (e) => e.statusCode === 409,
  )
})

test("publish freezes existing wording and invitees; validates window, categories and default scale", async () => {
  const f = fixture(),
    s = f.service,
    survey = await s.createSurvey({ actorId: 1, survey: input() })

  const original = f.state().questions[0].questionText

  f.categories[0].defaultQuestions[0].questionText = "Library edited later"

  await s.publishSurvey({ actorId: 1, surveyId: survey.id })

  assert.equal(f.state().questions[0].questionText, original)

  assert.equal(f.state().responses.length, 2)

  f.actors[5] = { id: 5, role: "EMPLOYEE", employeeId: 12 }

  await assert.rejects(
    s.submitSurveyResponse({
      actorId: 5,

      surveyId: survey.id,

      response: bodyFor(await f.repository.findQuestions(survey.id)),
    }),

    (e) => e.statusCode === 403,
  )

  const expired = await s.createSurvey({
    actorId: 1,

    survey: input({
      startDate: "2020-01-01T00:00:00Z",

      endDate: "2020-02-01T00:00:00Z",
    }),
  })

  await assert.rejects(
    s.publishSurvey({ actorId: 1, surveyId: expired.id }),

    (e) => e.statusCode === 400,
  )

  const invalid = await s.createSurvey({ actorId: 1, survey: input() })

  f

    .state()

    .questions.find((q) => q.surveyId === invalid.id).answerConfig.max = 10

  await assert.rejects(
    s.publishSurvey({ actorId: 1, surveyId: invalid.id }),

    (e) => e.statusCode === 409,
  )
})

test("mixed answer types, one submission, own response, participants, report and closing preserve lifecycle", async () => {
  const f = fixture(),
    s = f.service,
    choices = bank({ id: 1, name: "COMPENSATION_BENEFITS" })

      .filter((q) =>
        ["MULTIPLE_CHOICE", "SINGLE_CHOICE", "TEXT"].includes(q.questionType),
      )

      .slice(0, 2)

  const survey = await s.createSurvey({
    actorId: 1,

    survey: input({
      questions: choices.map(
        ({ questionText, categoryId, questionType, answerConfig }) => ({
          questionText,

          categoryId,

          questionType,

          answerConfig,
        }),
      ),
    }),
  })

  await s.publishSurvey({ actorId: 1, surveyId: survey.id })

  const qs = await f.repository.findQuestions(survey.id),
    response = bodyFor(qs)

  assert.equal(
    (await s.getSurveyResults({ actorId: 1, surveyId: survey.id })).questions[0]
      .averageScore,

    null,
  )

  await assert.rejects(
    s.submitSurveyResponse({
      actorId: 2,

      surveyId: survey.id,

      response: { answers: [] },
    }),

    (e) => e.statusCode === 400,
  )

  const invalid = structuredClone(response)

  invalid.answers[0].answerValue = 6

  await assert.rejects(
    s.submitSurveyResponse({
      actorId: 2,

      surveyId: survey.id,

      response: invalid,
    }),

    (e) => e.statusCode === 400,
  )

  f.repository.failAudit = true

  await assert.rejects(
    s.submitSurveyResponse({ actorId: 2, surveyId: survey.id, response }),

    /audit failed/,
  )

  assert.equal(f.state().answers.length, 0)

  assert.equal(f.state().responses[0].submittedAt, null)

  f.repository.failAudit = false

  const result = await s.submitSurveyResponse({
    actorId: 2,

    surveyId: survey.id,

    response,
  })

  assert.equal(result.satisfactionScore, 3.25)

  await assert.rejects(
    s.submitSurveyResponse({ actorId: 2, surveyId: survey.id, response }),

    (e) => e.statusCode === 409,
  )

  const participants = await s.getSurveyParticipants({
    actorId: 1,

    surveyId: survey.id,
  })

  assert.equal(participants.length, 1)

  assert.equal(participants[0].answerCount, qs.length)

  assert.equal(participants[0].answers, undefined)

  const detail = await s.getSurveyParticipants({
    actorId: 1,

    surveyId: survey.id,

    employeeId: 10,
  })

  assert.equal(detail.satisfactionScore, 3.25)

  assert.match(detail.answers[0].displayAnswer, /1\/5/)

  assert.equal(detail.answers[4].selectedOptions.length, 1)

  assert.equal(
    (await s.getSurveyResponses({ actorId: 2, surveyId: survey.id, own: true }))
      .employeeId,

    10,
  )

  await assert.rejects(
    s.getSurveyResponses({ actorId: 3, surveyId: survey.id, own: true }),

    (e) => e.statusCode === 404,
  )

  const results = await s.getSurveyResults({ actorId: 1, surveyId: survey.id })

  assert.equal(results.completionRate, 50)

  assert.equal(results.categoryScores[0].satisfactionScore, 3.25)

  await s.closeSurvey({ actorId: 1, surveyId: survey.id })

  await s.closeSurvey({ actorId: 1, surveyId: survey.id })

  await assert.rejects(
    s.submitSurveyResponse({ actorId: 3, surveyId: survey.id, response }),

    (e) => e.statusCode === 409,
  )
})

test("authorization is checked within the transaction and inactive/missing actors cannot use survey data", async () => {
  const f = fixture(),
    s = f.service

  for (const actorId of [2, 4, 999])
    await assert.rejects(s.listSurveys(actorId), (e) => e.statusCode === 403)

  f.actors[2].employeeId = 999

  await assert.rejects(s.listAvailableSurveys(2), (e) => e.statusCode === 403)

  await assert.rejects(
    s.getSurvey({ actorId: 1, surveyId: 999 }),

    (e) => e.statusCode === 404,
  )

  f.repository.failAudit = true

  await assert.rejects(
    s.createSurvey({ actorId: 1, survey: input() }),

    /audit failed/,
  )

  assert.equal(f.state().surveys.length, 0)

  assert.equal(f.state().questions.length, 0)
})

test("repository transaction keeps the same client and rolls back a failed write", async () => {
  const calls = [],
    client = {
      query: async (sql) => {
        calls.push(sql)

        return { rows: [] }
      },

      release: () => calls.push("RELEASE"),
    }

  const repository = new SurveysRepository({ connect: async () => client })

  await assert.rejects(
    repository.withTransaction(async (scoped) => {
      assert.equal(scoped.databasePool, client)

      await scoped.updateStatus(4, "ACTIVE")

      throw Error("failure")
    }),

    /failure/,
  )

  assert.deepEqual(calls, [
    "BEGIN",

    "UPDATE surveys SET status=$2 WHERE id=$1",

    "ROLLBACK",

    "RELEASE",
  ])
})

test("standard router validates IDs, query/body contracts, auth, cache headers and all public paths", async () => {
  const f = fixture(),
    app = express()

  app.use(express.json())

  app.use(
    "/api/surveys",

    createSurveysRouter({
      surveysController: new SurveysController(f.service),

      authenticate: (req, res, next) => {
        if (!req.headers.authorization)
          return res.status(401).json({ message: "Login required" })

        req.auth = { userId: req.headers.authorization === "Bearer HR" ? 1 : 2 }

        next()
      },
    }),
  )

  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ message: error.message }),
  )

  const server = app.listen(0, "127.0.0.1")

  await new Promise((resolve) => server.once("listening", resolve))

  const request = (url, method = "GET", body, auth = "HR") =>
    fetch("http://127.0.0.1:" + server.address().port + "/api/surveys" + url, {
      method,

      headers: {
        ...(auth ? { Authorization: "Bearer " + auth } : {}),

        ...(body ? { "Content-Type": "application/json" } : {}),
      },

      ...(body ? { body: JSON.stringify(body) } : {}),
    })

  try {
    assert.equal((await request("/", "GET", null, null)).status, 401)

    assert.equal((await request("/", "GET", null, "EMPLOYEE")).status, 403)

    assert.equal((await request("/categories")).status, 200)

    assert.equal(
      (await request("/available", "GET", null, "EMPLOYEE")).status,

      200,
    )

    for (const url of [
      "/?unknown=1",

      "/0",

      "/bad",

      "/2147483648",

      "/1/questions/bad",

      "/1/responses/bad",

      "/1/participants/bad",
    ])
      assert.equal(
        (await request(url, url.includes("/questions/") ? "DELETE" : "GET"))
          .status,

        400,

        url,
      )

    assert.equal(
      (await request("/", "POST", { title: "Missing categories" })).status,

      400,
    )

    const created = await request("/", "POST", input())

    assert.equal(created.status, 201)

    assert.match(created.headers.get("cache-control"), /no-store/)

    const id = (await created.json()).data.id

    assert.equal((await request("/" + id)).status, 200)

    assert.equal(
      (await request("/" + id, "PATCH", { title: "Renamed" })).status,

      200,
    )

    const added = await request("/" + id + "/questions", "POST", {
      questionText: "Text",

      categoryId: 1,

      questionType: "TEXT",
    })

    assert.equal(added.status, 201)

    const qid = (await added.json()).data.id

    assert.equal(
      (
        await request("/" + id + "/questions/" + qid, "PATCH", {
          questionText: "New text",

          categoryId: 1,

          questionType: "TEXT",
        })
      ).status,

      200,
    )

    assert.equal(
      (await request("/" + id + "/questions/" + qid, "DELETE")).status,

      200,
    )

    assert.equal((await request("/" + id + "/publish", "POST")).status, 200)

    const qs = await f.repository.findQuestions(id)

    const submitted = await request(
      "/" + id + "/responses",

      "POST",

      bodyFor(qs),

      "EMPLOYEE",
    )

    assert.equal(submitted.status, 201)

    const rid = (await submitted.json()).data.responseId

    for (const url of [
      `/${id}/responses`,

      `/${id}/responses/${rid}`,

      `/${id}/participants`,

      `/${id}/participants/10`,

      `/${id}/results`,
    ])
      assert.equal((await request(url)).status, 200, url)

    assert.equal(
      (await request("/" + id + "/my-response", "GET", null, "EMPLOYEE"))
        .status,

      200,
    )

    assert.equal((await request("/" + id + "/close", "POST")).status, 200)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("surveys uses the departments six-file module structure with SQL confined to repository", () => {
  const fs = require("node:fs"),
    path = require("node:path"),
    directory = path.join(__dirname, "../src/modules/surveys")

  const expected = [
    "controller",
    "repository",
    "routes",
    "service",
    "swagger",
    "validation",
  ]
    .map((kind) => "surveys." + kind + ".js")
    .sort()

  assert.deepEqual(
    fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".js"))
      .sort(),
    expected,
  )

  for (const name of ["routes", "controller", "service", "validation"]) {
    const content = fs.readFileSync(
      path.join(directory, "surveys." + name + ".js"),
      "utf8",
    )

    assert.doesNotMatch(content, /\.query\s*\(/, name + " must not issue SQL")
  }

  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8")

  assert.match(
    app,
    /createSurveysRouter\(\{ surveysController, authenticate \}\)/,
  )

  assert.doesNotMatch(app, /surveys\.dynamic/)
})
