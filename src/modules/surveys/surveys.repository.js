const { snapshot, writeAudit, auditMutation, transaction } = require('../audit_logs/audit.repository');
const { DEFAULT_SURVEY_QUESTIONS } = require('./surveys.constants');
const { AppError } = require('../../common/errors/app-error');

class SurveysRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async findUserRoleById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT role.name AS role
       FROM users
       INNER JOIN role ON role.id = users.role_id
       WHERE users.id = $1
         AND users.status = 'ACTIVE'
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async create({ survey, createdBy }) {
    const client = await this.databasePool.connect();

    try {
      await client.query('BEGIN');
      const { rows: surveyRows } = await client.query(
        `INSERT INTO surveys (title, description, start_date, end_date, status, created_by)
         VALUES ($1, $2, $3, $4, 'DRAFT', $5)
         RETURNING
           id,
           title,
           description,
           start_date AS "startDate",
           end_date AS "endDate",
           status,
           created_by AS "createdBy",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [survey.title, survey.description, survey.startDate, survey.endDate, createdBy]
      );
      const savedSurvey = surveyRows[0];
      const questions = [];

      for (const question of DEFAULT_SURVEY_QUESTIONS) {
        const { rows } = await client.query(
          `INSERT INTO survey_questions (
             survey_id,
             question_text,
             dimension_code,
             required,
             display_order
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING
             id,
             question_text AS "questionText",
             dimension_code AS "dimensionCode",
             required,
             display_order AS "displayOrder"`,
          [savedSurvey.id, question.questionText, question.dimensionCode, question.required, question.displayOrder]
        );
        questions.push(rows[0]);
      }

      await writeAudit(client, { actorId: createdBy, entityType: 'surveys', entityId: savedSurvey.id, action: 'CREATE',
        newValue: { ...await snapshot(client, 'surveys', savedSurvey.id), questions } });
      await client.query('COMMIT');
      return { ...savedSurvey, questions };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findAll() {
    const { rows } = await this.databasePool.query(
      `SELECT
         surveys.id,
         surveys.title,
         surveys.description,
         surveys.start_date AS "startDate",
         surveys.end_date AS "endDate",
         surveys.status,
         surveys.created_at AS "createdAt",
         surveys.updated_at AS "updatedAt",
         users.id AS "createdBy",
         users.full_name AS "createdByName",
         COUNT(DISTINCT survey_questions.id)::integer AS "questionCount",
         COUNT(DISTINCT survey_responses.id)::integer AS "responseCount"
       FROM surveys
       LEFT JOIN users ON users.id = surveys.created_by
       LEFT JOIN survey_questions ON survey_questions.survey_id = surveys.id
       LEFT JOIN survey_responses ON survey_responses.survey_id = surveys.id
       GROUP BY surveys.id, users.id
       ORDER BY surveys.created_at DESC`
    );

    return rows;
  }

  async findById(id) {
    const { rows } = await this.databasePool.query(
      `SELECT
         id,
         status,
         start_date AS "startDate",
         end_date AS "endDate"
       FROM surveys
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  }

  async findQuestionsBySurveyId(surveyId) {
    const { rows } = await this.databasePool.query(
      `SELECT
         id,
         question_text AS "questionText",
         dimension_code AS "dimensionCode",
         required,
         display_order AS "displayOrder"
       FROM survey_questions
       WHERE survey_id = $1
       ORDER BY display_order ASC`,
      [surveyId]
    );

    return rows;
  }

  async findDetailById(surveyId) {
    const { rows } = await this.databasePool.query(
      `SELECT
         id,
         title,
         description,
         status,
         start_date AS "startDate",
         end_date AS "endDate"
       FROM surveys
       WHERE id = $1
       LIMIT 1`,
      [surveyId]
    );

    return rows[0] || null;
  }

  async hasSubmittedResponse({ surveyId, employeeId }) {
    const { rows } = await this.databasePool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM survey_responses
         WHERE survey_id = $1
           AND employee_id = $2
           AND submitted_at IS NOT NULL
       ) AS "hasSubmittedResponse"`,
      [surveyId, employeeId]
    );

    return rows[0].hasSubmittedResponse;
  }

  async findEmployeeByActiveUserId(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT users.employee_id AS "employeeId"
       FROM users
       WHERE users.id = $1
         AND users.status = 'ACTIVE'
         AND users.employee_id IS NOT NULL
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async findMyResponse({ surveyId, employeeId }) {
    const { rows } = await this.databasePool.query(
      `SELECT
         survey_responses.id,
         surveys.title AS "surveyTitle",
         survey_responses.submitted_at AS "submittedAt"
       FROM survey_responses
       INNER JOIN surveys ON surveys.id = survey_responses.survey_id
       WHERE survey_responses.survey_id = $1
         AND survey_responses.employee_id = $2
       LIMIT 1`,
      [surveyId, employeeId]
    );

    return rows[0] || null;
  }

  async findMyResponseAnswers({ surveyId, responseId }) {
    const { rows } = await this.databasePool.query(
      `SELECT
         survey_questions.id AS "questionId",
         survey_questions.question_text AS "questionText",
         survey_questions.dimension_code AS "dimensionCode",
         survey_questions.required,
         survey_questions.display_order AS "displayOrder",
         survey_answers.score,
         survey_answers.comment
       FROM survey_questions
       LEFT JOIN survey_answers
         ON survey_answers.question_id = survey_questions.id
        AND survey_answers.response_id = $2
       WHERE survey_questions.survey_id = $1
       ORDER BY survey_questions.display_order ASC`,
      [surveyId, responseId]
    );

    return rows;
  }

  async submitResponse({ surveyId, employeeId, answers }) {
    const client = await this.databasePool.connect();

    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        `SELECT id, submitted_at AS "submittedAt"
         FROM survey_responses
         WHERE survey_id = $1
           AND employee_id = $2
         FOR UPDATE`,
        [surveyId, employeeId]
      );
      const existingResponse = existingRows[0];

      if (existingResponse?.submittedAt) {
        throw new AppError(409, 'You have already submitted a response for this survey.');
      }

      let response;
      if (existingResponse) {
        await client.query('DELETE FROM survey_answers WHERE response_id = $1', [existingResponse.id]);
        const { rows } = await client.query(
          `UPDATE survey_responses
           SET submitted_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, survey_id AS "surveyId", submitted_at AS "submittedAt"`,
          [existingResponse.id]
        );
        response = rows[0];
      } else {
        const { rows } = await client.query(
          `INSERT INTO survey_responses (survey_id, employee_id, submitted_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           RETURNING id, survey_id AS "surveyId", submitted_at AS "submittedAt"`,
          [surveyId, employeeId]
        );
        response = rows[0];
      }

      for (const answer of answers) {
        await client.query(
          `INSERT INTO survey_answers (response_id, question_id, score, comment)
           VALUES ($1, $2, $3, $4)`,
          [response.id, answer.questionId, answer.score, answer.comment]
        );
      }

      await client.query('COMMIT');
      return {
        responseId: response.id,
        surveyId: response.surveyId,
        submittedAt: response.submittedAt
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        throw new AppError(409, 'You have already submitted a response for this survey.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveEmployeeByUserId(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT employees.id
       FROM users
       INNER JOIN employees ON employees.id = users.employee_id
       WHERE users.id = $1
         AND users.status = 'ACTIVE'
         AND employees.employment_status = 'ACTIVE'
         AND employees.hire_date <= CURRENT_DATE - INTERVAL '3 months'
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async findAvailableForEmployee(employeeId) {
    const { rows } = await this.databasePool.query(
      `SELECT
         surveys.id,
         surveys.title,
         surveys.description,
         surveys.start_date AS "startDate",
         surveys.end_date AS "endDate",
         question_totals."questionCount",
         CASE
           WHEN survey_responses.id IS NULL THEN 'NOT_STARTED'
           ELSE 'IN_PROGRESS'
         END AS "responseStatus"
       FROM surveys
       CROSS JOIN LATERAL (
         SELECT COUNT(*)::integer AS "questionCount"
         FROM survey_questions
         WHERE survey_questions.survey_id = surveys.id
       ) AS question_totals
       LEFT JOIN survey_responses
         ON survey_responses.survey_id = surveys.id
        AND survey_responses.employee_id = $1
       WHERE surveys.status = 'ACTIVE'
         AND surveys.start_date <= CURRENT_TIMESTAMP
         AND surveys.end_date >= CURRENT_TIMESTAMP
         AND question_totals."questionCount" > 0
         AND (survey_responses.id IS NULL OR survey_responses.submitted_at IS NULL)
       ORDER BY surveys.end_date ASC, surveys.id DESC`,
      [employeeId]
    );

    return rows;
  }

  async publish(id, actorId) {
    return transaction(this.databasePool, client => auditMutation(client,
      { actorId, table: 'surveys', id, action: 'PUBLISH' },
      () => new SurveysRepository(client)._publish(id)));
  }
  async _publish(id) {
    const { rows } = await this.databasePool.query(
      `UPDATE surveys
       SET status = 'ACTIVE',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND status = 'DRAFT'
       RETURNING
         id,
         title,
         status,
         start_date AS "startDate",
         end_date AS "endDate",
         updated_at AS "updatedAt"`,
      [id]
    );

    return rows[0] || null;
  }

  async findResultsSummary(id) {
    const { rows } = await this.databasePool.query(
      `SELECT
         surveys.id,
         surveys.title,
         surveys.status,
         COUNT(survey_responses.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL
         )::integer AS "responseCount"
       FROM surveys
       LEFT JOIN survey_responses ON survey_responses.survey_id = surveys.id
       WHERE surveys.id = $1
       GROUP BY surveys.id`,
      [id]
    );

    return rows[0] || null;
  }

  async findQuestionResults(surveyId) {
    const { rows } = await this.databasePool.query(
      `SELECT
         survey_questions.id,
         survey_questions.question_text AS "questionText",
         survey_questions.dimension_code AS "dimensionCode",
         survey_questions.display_order AS "displayOrder",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL
             AND survey_answers.score IS NOT NULL
         )::integer AS "answerCount",
         ROUND(
           AVG(survey_answers.score) FILTER (
             WHERE survey_responses.submitted_at IS NOT NULL
               AND survey_answers.score IS NOT NULL
           )::numeric,
           2
         ) AS "averageScore",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL
             AND survey_answers.score = 1
         )::integer AS "score1",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL
             AND survey_answers.score = 2
         )::integer AS "score2",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL
             AND survey_answers.score = 3
         )::integer AS "score3",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL
             AND survey_answers.score = 4
         )::integer AS "score4"
       FROM survey_questions
       LEFT JOIN survey_answers ON survey_answers.question_id = survey_questions.id
       LEFT JOIN survey_responses ON survey_responses.id = survey_answers.response_id
       WHERE survey_questions.survey_id = $1
       GROUP BY survey_questions.id
       ORDER BY survey_questions.display_order ASC`,
      [surveyId]
    );

    return rows;
  }
}

module.exports = { SurveysRepository };
