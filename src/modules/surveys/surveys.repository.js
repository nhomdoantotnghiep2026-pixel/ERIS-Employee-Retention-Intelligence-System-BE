const { snapshot, writeAudit, auditMutation, transaction } = require('../audit_logs/audit.repository');
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
      const questions = await new SurveysRepository(client).findQuestions();

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
         (SELECT COUNT(*)::integer FROM survey_questions) AS "questionCount",
         COUNT(DISTINCT survey_responses.id) FILTER (WHERE survey_responses.submitted_at IS NOT NULL)::integer AS "responseCount"
       FROM surveys
       LEFT JOIN users ON users.id = surveys.created_by
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

  async findQuestions() {
    const { rows } = await this.databasePool.query(
      `SELECT
         id,
         question_text AS "questionText",
         display_order AS "displayOrder"
       FROM survey_questions
       ORDER BY display_order ASC, id ASC`
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
         survey_questions.display_order AS "displayOrder",
         survey_answers.score,
         survey_answers.comment
       FROM survey_questions
       LEFT JOIN survey_answers
         ON survey_answers.question_id = survey_questions.id
        AND survey_answers.response_id = $1
       ORDER BY survey_questions.display_order ASC`,
      [responseId]
    );

    return rows;
  }

  async submitResponse({ surveyId, employeeId, answers }) {
    const client = await this.databasePool.connect();

    try {
      await client.query('BEGIN');
      const { rows: surveys } = await client.query('SELECT * FROM surveys WHERE id=$1 FOR UPDATE', [surveyId]);
      const survey = surveys[0];
      const now = Date.now();
      if (!survey || survey.status !== 'ACTIVE' || !survey.start_date || !survey.end_date
          || new Date(survey.start_date).getTime() > now || new Date(survey.end_date).getTime() <= now) {
        throw new AppError(409, 'Survey is not currently available.');
      }
      await client.query('LOCK TABLE survey_questions IN SHARE MODE');
      const questions = await new SurveysRepository(client).findQuestions();
      const ids = new Set(answers.map(answer => answer.questionId));
      if (!questions.length || answers.length !== questions.length || ids.size !== questions.length
          || questions.some(question => !ids.has(question.id))
          || answers.some(answer => !Number.isInteger(answer.score) || answer.score < 1 || answer.score > 5)) {
        throw new AppError(400, 'Answer every shared question once with an integer score from 1 to 5.');
      }
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
           SET submitted_at = NULL
           WHERE id = $1
           RETURNING id, survey_id AS "surveyId", submitted_at AS "submittedAt"`,
          [existingResponse.id]
        );
        response = rows[0];
      } else {
        const { rows } = await client.query(
          `INSERT INTO survey_responses (survey_id, employee_id, submitted_at)
           VALUES ($1, $2, NULL)
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

      const { rows: submitted } = await client.query(
        'UPDATE survey_responses SET submitted_at=clock_timestamp() WHERE id=$1 RETURNING submitted_at AS "submittedAt"', [response.id]);
      response.submittedAt = submitted[0].submittedAt;
      await client.query('COMMIT');
      return {
        satisfactionScore: Number((answers.reduce((sum, answer) => sum + answer.score, 0) / answers.length).toFixed(4)),
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
       INNER JOIN role ON role.id = users.role_id
       WHERE users.id = $1
         AND users.status = 'ACTIVE'
         AND role.name IN ('HR', 'EMPLOYEE')
         AND employees.employment_status = 'ACTIVE'
         AND employees.hire_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - INTERVAL '3 months'
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
       ) AS question_totals
       LEFT JOIN survey_responses
         ON survey_responses.survey_id = surveys.id
        AND survey_responses.employee_id = $1
       WHERE surveys.status = 'ACTIVE'
         AND surveys.start_date <= CURRENT_TIMESTAMP
         AND surveys.end_date > CURRENT_TIMESTAMP
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
         AND start_date IS NOT NULL AND end_date > clock_timestamp()
         AND end_date > start_date
         AND EXISTS (SELECT 1 FROM survey_questions)
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

  async findSubmittedParticipants(surveyId) {
    const { rows } = await this.databasePool.query(
      `SELECT r.id AS "responseId", r.submitted_at AS "submittedAt",
         jsonb_build_object('id', e.id, 'employeeCode', e.employee_code, 'fullName', e.full_name) AS employee,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'questionId', q.id, 'questionText', q.question_text,
             'displayOrder', q.display_order,
             'score', a.score, 'comment', a.comment
           ) ORDER BY q.display_order, q.id)
           FROM survey_questions q
           LEFT JOIN survey_answers a ON a.question_id=q.id AND a.response_id=r.id
         ), '[]'::jsonb) AS answers
       FROM survey_responses r
       JOIN employees e ON e.id=r.employee_id
       WHERE r.survey_id=$1 AND r.submitted_at IS NOT NULL
       ORDER BY r.submitted_at DESC, r.id DESC`,
      [surveyId]
    );
    return rows;
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

  async findSubmittedResponse(surveyId, responseId) {
    const { rows } = await this.databasePool.query(
      `SELECT r.id AS "responseId", r.submitted_at AS "submittedAt",
        jsonb_build_object('id', e.id, 'employeeCode', e.employee_code, 'fullName', e.full_name) AS employee
       FROM survey_responses r JOIN employees e ON e.id=r.employee_id
       WHERE r.survey_id=$1 AND r.id=$2 AND r.submitted_at IS NOT NULL`, [surveyId, responseId]);
    if (!rows[0]) return null;
    const answers = await this.findMyResponseAnswers({ responseId });
    return { ...rows[0], answers,
      satisfactionScore: answers.length ? Number((answers.reduce((sum, answer) => sum + Number(answer.score), 0) / answers.length).toFixed(4)) : null };
  }

  async updateDraft(id, changes, actorId) {
    return transaction(this.databasePool, async client => {
      const before = await snapshot(client, 'surveys', id, true);
      if (!before) throw new AppError(404, 'Survey not found.');
      if (before.status !== 'DRAFT') throw new AppError(409, 'Only draft surveys can be edited.');
      const merged = { title: before.title, description: before.description,
        startDate: before.start_date, endDate: before.end_date, ...changes };
      if (merged.startDate && merged.endDate && new Date(merged.endDate) <= new Date(merged.startDate)) {
        throw new AppError(400, 'endDate must be after startDate.');
      }
      return auditMutation(client, { actorId, table: 'surveys', id, action: 'UPDATE' }, async () => {
        await client.query('UPDATE surveys SET title=$2, description=$3, start_date=$4, end_date=$5 WHERE id=$1',
          [id, merged.title, merged.description, merged.startDate, merged.endDate]);
        return new SurveysRepository(client).findDetailById(id);
      });
    });
  }

  async close(id, actorId) {
    return transaction(this.databasePool, async client => {
      const before = await snapshot(client, 'surveys', id, true);
      if (!before) throw new AppError(404, 'Survey not found.');
      if (before.status === 'CLOSED') return new SurveysRepository(client).findDetailById(id);
      if (before.status !== 'ACTIVE') throw new AppError(409, 'Only active surveys can be closed.');
      return auditMutation(client, { actorId, table: 'surveys', id, action: 'CLOSE' }, async () => {
        await client.query("UPDATE surveys SET status='CLOSED' WHERE id=$1", [id]);
        return new SurveysRepository(client).findDetailById(id);
      });
    });
  }

  async findQuestionResults(surveyId) {
    const { rows } = await this.databasePool.query(
      `SELECT
         survey_questions.id,
         survey_questions.question_text AS "questionText",
         survey_questions.display_order AS "displayOrder",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
             AND survey_answers.score IS NOT NULL
         )::integer AS "answerCount",
         ROUND(
           AVG(survey_answers.score) FILTER (
             WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
               AND survey_answers.score IS NOT NULL
           )::numeric,
           2
         ) AS "averageScore",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
             AND survey_answers.score = 1
         )::integer AS "score1",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
             AND survey_answers.score = 2
         )::integer AS "score2",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
             AND survey_answers.score = 3
         )::integer AS "score3",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
             AND survey_answers.score = 4
          )::integer AS "score4",
         COUNT(survey_answers.id) FILTER (
           WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
             AND survey_answers.score = 5
         )::integer AS "score5",
         COALESCE(
           jsonb_agg(
             jsonb_build_object('score', survey_answers.score, 'comment', survey_answers.comment)
             ORDER BY survey_answers.id
           ) FILTER (
             WHERE survey_responses.submitted_at IS NOT NULL AND survey_responses.survey_id = $1
               AND survey_answers.id IS NOT NULL
           ), '[]'::jsonb
         ) AS answers
       FROM survey_questions
       LEFT JOIN survey_answers ON survey_answers.question_id = survey_questions.id
       LEFT JOIN survey_responses ON survey_responses.id = survey_answers.response_id
       GROUP BY survey_questions.id
       ORDER BY survey_questions.display_order ASC`,
      [surveyId]
    );

    return rows;
  }
}

module.exports = { SurveysRepository };
