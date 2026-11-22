const { transaction, writeAudit } = require("../audit_logs/repositories/audit.repository")

const { AppError } = require("../../common/errors/app-error")

const validation = require("./surveys.validation")

const { score } = require("./helpers/surveys.scoring")

const SOURCE = "ERIS_SURVEY_CATALOG"

const SURVEY_COLUMNS = `s.id,s.title,s.description,s.start_date AS "startDate",s.end_date AS "endDate",s.status,s.created_by AS "createdBy",s.created_at AS "createdAt",s.updated_at AS "updatedAt"`

const QUESTION_COLUMNS = `id,survey_id AS "surveyId",question_text AS "questionText",category_id AS "categoryId",question_type AS "questionType",answer_config AS "answerConfig",display_order AS "displayOrder",true AS "isRequired",(COALESCE(answer_config->>'templateCode','')<>'') AS "isSatisfactionCore"`

class SurveysRepository {
  constructor(databasePool) {
    this.databasePool = databasePool
  }

  withTransaction(work) {
    return transaction(this.databasePool, (client) =>
      work(new SurveysRepository(client)),
    )
  }

  async findActorById(actorId) {
    return (
      (
        await this.databasePool.query(
          `SELECT u.id,u.employee_id AS "employeeId",r.name AS role FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 AND u.status='ACTIVE' FOR SHARE OF u`,

          [actorId],
        )
      ).rows[0] || null
    )
  }

  async findActiveEmployeeById(employeeId) {
    return (
      (
        await this.databasePool.query(
          "SELECT id FROM employees WHERE id=$1 AND employment_status='ACTIVE' FOR SHARE",

          [employeeId],
        )
      ).rows[0] || null
    )
  }

  async findById(surveyId, lock = false) {
    if (lock)
      await this.databasePool.query(
        "SELECT c.id FROM survey_categories c WHERE EXISTS(SELECT 1 FROM survey_questions q WHERE q.survey_id=$1 AND q.category_id=c.id) ORDER BY c.id FOR SHARE OF c",

        [surveyId],
      )

    return (
      (
        await this.databasePool.query(
          `SELECT ${SURVEY_COLUMNS} FROM surveys s WHERE s.id=$1${
            lock ? " FOR UPDATE" : ""
          }`,

          [surveyId],
        )
      ).rows[0] || null
    )
  }

  async findAll(employeeId = null) {
    return (
      await this.databasePool.query(
        `SELECT ${SURVEY_COLUMNS},(SELECT count(*)::int FROM survey_questions q WHERE q.survey_id=s.id) AS "questionCount",(SELECT count(*)::int FROM survey_responses r WHERE r.survey_id=s.id AND r.submitted_at IS NOT NULL) AS "responseCount" FROM surveys s ${
          employeeId === null
            ? ""
            : `WHERE status='ACTIVE' AND start_date<=CURRENT_TIMESTAMP AND end_date>CURRENT_TIMESTAMP AND EXISTS(SELECT 1 FROM survey_questions q WHERE q.survey_id=s.id) AND EXISTS(SELECT 1 FROM survey_responses r WHERE r.survey_id=s.id AND r.employee_id=$1) AND NOT EXISTS(SELECT 1 FROM survey_responses r WHERE r.survey_id=s.id AND r.employee_id=$1 AND r.submitted_at IS NOT NULL)`
        } ORDER BY s.created_at DESC`,

        employeeId === null ? [] : [employeeId],
      )
    ).rows
  }

  async create(survey, actorId) {
    return (
      await this.databasePool.query(
        `INSERT INTO surveys(title,description,start_date,end_date,status,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5) RETURNING id`,

        [
          survey.title,

          survey.description,

          survey.startDate,

          survey.endDate,

          actorId,
        ],
      )
    ).rows[0]
  }

  async update(surveyId, survey) {
    await this.databasePool.query(
      "UPDATE surveys SET title=$2,description=$3,start_date=$4,end_date=$5 WHERE id=$1",

      [
        surveyId,

        survey.title,

        survey.description,

        survey.startDate,

        survey.endDate,
      ],
    )
  }

  async updateStatus(surveyId, status) {
    await this.databasePool.query("UPDATE surveys SET status=$2 WHERE id=$1", [
      surveyId,

      status,
    ])
  }

  async findQuestions(surveyId) {
    return (
      await this.databasePool.query(
        `SELECT ${QUESTION_COLUMNS} FROM survey_questions WHERE survey_id=$1 ORDER BY display_order,id`,

        [surveyId],
      )
    ).rows
  }

  async findQuestionById(surveyId, questionId) {
    return (
      (
        await this.databasePool.query(
          `SELECT ${QUESTION_COLUMNS} FROM survey_questions WHERE id=$1 AND survey_id=$2 FOR UPDATE`,

          [questionId, surveyId],
        )
      ).rows[0] || null
    )
  }

  async saveQuestion(surveyId, question, questionId = null) {
    const args = [
      surveyId,

      question.questionText,

      question.categoryId,

      question.questionType,

      JSON.stringify(question.answerConfig),

      question.displayOrder,
    ]

    return (
      await this.databasePool.query(
        questionId
          ? `UPDATE survey_questions SET question_text=$2,category_id=$3,question_type=$4,answer_config=$5::jsonb,display_order=$6 WHERE survey_id=$1 AND id=$7 RETURNING ${QUESTION_COLUMNS}`
          : `INSERT INTO survey_questions(survey_id,question_text,category_id,question_type,answer_config,display_order) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING ${QUESTION_COLUMNS}`,

        questionId ? [...args, questionId] : args,
      )
    ).rows[0]
  }

  async deleteQuestion(questionId) {
    await this.databasePool.query("DELETE FROM survey_questions WHERE id=$1", [
      questionId,
    ])
  }

  async findResponseCounts(surveyId) {
    return (
      await this.databasePool.query(
        'SELECT count(*)::int AS "invitedCount",count(*) FILTER(WHERE submitted_at IS NOT NULL)::int AS "participantCount" FROM survey_responses WHERE survey_id=$1',

        [surveyId],
      )
    ).rows[0]
  }

  async inviteActiveEmployees(surveyId) {
    await this.databasePool.query(
      `INSERT INTO survey_responses(survey_id,employee_id) SELECT $1,e.id FROM employees e WHERE e.employment_status='ACTIVE' AND EXISTS(SELECT 1 FROM users u JOIN role r ON r.id=u.role_id WHERE u.employee_id=e.id AND u.status='ACTIVE' AND r.name='EMPLOYEE') ON CONFLICT(survey_id,employee_id) DO NOTHING`,

      [surveyId],
    )
  }

  async findAssignedResponse(surveyId, employeeId) {
    return (
      (
        await this.databasePool.query(
          'SELECT id,submitted_at AS "submittedAt" FROM survey_responses WHERE survey_id=$1 AND employee_id=$2 FOR UPDATE',

          [surveyId, employeeId],
        )
      ).rows[0] || null
    )
  }

  async replaceAnswers(responseId, answers) {
    await this.databasePool.query(
      "DELETE FROM survey_answers WHERE response_id=$1",

      [responseId],
    )

    for (const answer of answers)
      await this.databasePool.query(
        "INSERT INTO survey_answers(response_id,question_id,answer_value,comment) VALUES($1,$2,$3::jsonb,$4)",

        [
          responseId,

          answer.questionId,

          JSON.stringify(answer.answerValue),

          answer.comment,
        ],
      )
  }

  async markResponseSubmitted(responseId) {
    return (
      await this.databasePool.query(
        'UPDATE survey_responses SET submitted_at=clock_timestamp() WHERE id=$1 RETURNING submitted_at AS "submittedAt"',

        [responseId],
      )
    ).rows[0].submittedAt
  }

  async findResponses(
    surveyId,

    { employeeId = null, responseId = null, submittedOnly = false } = {},
  ) {
    const args = [surveyId]

    let where = "r.survey_id=$1"

    if (responseId) {
      args.push(responseId)

      where += " AND r.id=$2"
    } else if (employeeId) {
      args.push(employeeId)

      where += " AND r.employee_id=$2"
    }

    if (submittedOnly) where += " AND r.submitted_at IS NOT NULL"

    return (
      await this.databasePool.query(
        `SELECT r.id AS "responseId",r.employee_id AS "employeeId",r.submitted_at AS "submittedAt",e.employee_code AS "employeeCode",e.full_name AS "fullName" FROM survey_responses r JOIN employees e ON e.id=r.employee_id WHERE ${where} ORDER BY r.submitted_at DESC NULLS LAST,r.id DESC`,

        args,
      )
    ).rows
  }

  async findAnswers(surveyId, responseIds) {
    if (!responseIds.length) return []

    return (
      await this.databasePool.query(
        `SELECT a.response_id AS "responseId",a.question_id AS "questionId",a.answer_value AS "answerValue",a.comment,q.question_text AS "questionText",q.question_type AS "questionType",q.display_order AS "displayOrder",q.category_id AS "categoryId",cat.name AS "categoryName",q.answer_config AS "answerConfig",(COALESCE(q.answer_config->>'templateCode','')<>'') AS "isSatisfactionCore" FROM survey_answers a JOIN survey_responses r ON r.id=a.response_id JOIN survey_questions q ON q.id=a.question_id LEFT JOIN survey_categories cat ON cat.id=q.category_id WHERE r.survey_id=$1 AND r.id=ANY($2::integer[]) ORDER BY q.display_order,q.id`,

        [surveyId, responseIds],
      )
    ).rows
  }

  async findResultResponses(surveyId) {
    return (
      await this.databasePool.query(
        "SELECT id,submitted_at FROM survey_responses WHERE survey_id=$1",

        [surveyId],
      )
    ).rows
  }

  async findSubmittedAnswers(surveyId) {
    return (
      await this.databasePool.query(
        `SELECT a.response_id AS "responseId",a.question_id AS "questionId",a.answer_value AS "answerValue",a.comment FROM survey_answers a JOIN survey_responses r ON r.id=a.response_id WHERE r.survey_id=$1 AND r.submitted_at IS NOT NULL`,

        [surveyId],
      )
    ).rows
  }

  findCategoryCatalog() {
    return readCatalog(this.databasePool)
  }

  audit(actorId, surveyId, action, oldValue, newValue) {
    return writeAudit(this.databasePool, {
      actorId,

      entityType: "surveys",

      entityId: surveyId,

      action,

      oldValue,

      newValue,
    })
  }

  auditResponse(actorId, responseId, newValue) {
    return writeAudit(this.databasePool, {
      actorId,

      entityType: "survey_responses",

      entityId: responseId,

      action: "CREATE",

      newValue,
    })
  }
}

// Catalog SQL and period-satisfaction queries are appended here by the refactor.

function decode(row) {
  const metadata = row.answer_config?.erisCatalog

  const question = validation.question({
    questionText: row.question_text,

    categoryId: row.category_id,

    questionType: row.question_type,

    answerConfig: row.answer_config?.answerConfig ?? null,

    displayOrder: row.display_order,
  })

  if (metadata.kind === "SATISFACTION") {
    if (question.questionType !== "RATING")
      throw new AppError(409, "A catalog satisfaction item must use RATING.")

    return {
      ...question,

      templateCode: metadata.code,

      catalogQuestionId: row.id,
    }
  }

  if (metadata.kind === "BANK")
    return { ...question, bankCode: metadata.code, catalogQuestionId: row.id }

  throw new AppError(409, "Unsupported catalog item kind.")
}

async function readCatalog(client) {
  const categories = (
    await client.query(
      "SELECT id,name,description FROM survey_categories ORDER BY id",
    )
  ).rows

  const rows = (
    await client.query(
      `SELECT id,category_id,question_text,question_type,answer_config,display_order
 FROM survey_questions WHERE survey_id IS NULL AND answer_config->'erisCatalog'->>'source'=$1
 ORDER BY display_order,id`,

      [SOURCE],
    )
  ).rows

  const keys = new Set()

  for (const row of rows) {
    const meta = row.answer_config.erisCatalog

    if (typeof meta.code !== "string" || !meta.code)
      throw new AppError(409, "Catalog question code is missing.")

    const key = row.category_id + "|" + meta.kind + "|" + meta.code

    if (keys.has(key))
      throw new AppError(409, "Duplicate catalog question code.")

    keys.add(key)
  }

  return categories.map((category) => {
    const items = rows.filter((row) => row.category_id === category.id),
      defaults = items.filter(
        (row) => row.answer_config.erisCatalog.kind === "SATISFACTION",
      ),
      bank = items.filter(
        (row) => row.answer_config.erisCatalog.kind === "BANK",
      )

    if (defaults.length !== 4 || bank.length !== 10)
      throw new AppError(
        409,
        `Survey question catalog is incomplete for ${category.name}: expected 4 SATISFACTION and 10 BANK questions.`,
      )

    return {
      ...category,

      defaultQuestions: defaults.map(decode),

      questionBank: bank.map(decode),
    }
  })
}

// Reuses the same application scoring as survey submission; no DB function required.

async function periodSatisfaction(client, employeeId, capturedAt, periodStart) {
  const { rows } = await client.query(
    `
 SELECT r.id AS "responseId",q.id AS "questionId",q.category_id AS "categoryId",
        q.question_type AS "questionType",a.answer_value AS "answerValue"
 FROM survey_responses r
 JOIN survey_questions q ON q.survey_id=r.survey_id
 LEFT JOIN survey_answers a ON a.response_id=r.id AND a.question_id=q.id
 WHERE r.employee_id=$1 AND r.submitted_at IS NOT NULL
   AND r.submitted_at>=($3::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
   AND r.submitted_at<=$2::timestamptz AND q.question_type='RATING'
   AND COALESCE(q.answer_config->>'templateCode','')<>''
 ORDER BY r.submitted_at DESC,r.id DESC,q.id`,

    [employeeId, capturedAt, periodStart],
  )

  const groups = new Map()

  for (const row of rows) {
    if (!groups.has(row.responseId))
      groups.set(row.responseId, { questions: [], answers: [] })

    const group = groups.get(row.responseId)

    group.questions.push({
      id: row.questionId,

      categoryId: row.categoryId,

      questionType: row.questionType,

      isSatisfactionCore: true,
    })

    group.answers.push({
      questionId: row.questionId,

      answerValue: row.answerValue,
    })
  }

  let total = 0,
    count = 0

  for (const group of groups.values()) {
    const value = score(group.questions, group.answers)

    if (value !== null) {
      total += value

      count++
    }
  }

  return count ? Number((total / count).toFixed(2)) : null
}

module.exports = {
  SurveysRepository,

  SOURCE,

  readCatalog,

  periodSatisfaction,
}
