// Shared questions are seeded once in the database, never per survey.
const idParameter = name => ({ name, in: 'path', required: true,
  schema: { type: 'integer', minimum: 1, maximum: 2147483647 } });
const surveyProperties = {
  title: { type: 'string', minLength: 1, maxLength: 255 },
  description: { type: 'string', nullable: true },
  startDate: { type: 'string', format: 'date-time', nullable: true },
  endDate: { type: 'string', format: 'date-time', nullable: true }
};
const body = schema => ({ required: true, content: { 'application/json': { schema } } });
const operation = (summary, description, parameters = [], success = 200) => ({
  tags: ['Surveys'], summary, description, security: [{ bearerAuth: [] }], parameters,
  responses: {
    [success]: { description: 'Success; payload is wrapped in data.' },
    400: { description: 'Invalid input.' }, 401: { description: 'Authentication required.' },
    403: { description: 'Actor is not eligible.' }, 404: { description: 'Survey or response not found.' },
    409: { description: 'Survey state conflicts with the operation, or response already submitted.' }
  }
});
const surveyId = [idParameter('id')];
const surveysPaths = {
  '/api/surveys': {
    get: operation('List surveys (HR)', 'All surveys, newest first. Shared questionCount and submitted responseCount. No pagination.'),
    post: { ...operation('Create draft survey (HR)', 'Creates metadata only. Returns the existing shared questions; never inserts duplicate questions.', [], 201),
      requestBody: body({ type: 'object', additionalProperties: false, required: ['title'], properties: surveyProperties }) }
  },
  '/api/surveys/available': {
    get: operation('List available surveys (Employee or HR with employee profile)',
      'Active user and employee, HR or EMPLOYEE role, at least three months of employment. ACTIVE, startDate <= now < endDate, and not yet submitted. Returns NOT_STARTED or IN_PROGRESS.')
  },
  '/api/surveys/{id}': {
    get: operation('Survey details (HR or Employee)', 'HR can view any state without an employee profile. Employees must be eligible and the survey open; already submitted employees use my-response. Returns shared questions: id, questionText, displayOrder.', surveyId),
    patch: { ...operation('Edit draft metadata (HR)', 'DRAFT only. Partial update of title, description, startDate and endDate; questions are shared and cannot be edited here.', surveyId),
      requestBody: body({ type: 'object', minProperties: 1, additionalProperties: false, properties: surveyProperties }) }
  },
  '/api/surveys/{id}/publish': {
    post: operation('Publish survey (HR)', 'DRAFT -> ACTIVE. Requires shared questions, both dates, endDate > startDate and endDate in the future. A future startDate schedules participation.', surveyId)
  },
  '/api/surveys/{id}/close': {
    post: operation('Close survey (HR)', 'ACTIVE -> CLOSED. Existing CLOSED returns success. Preserves dates and responses; writes audit.', surveyId)
  },
  '/api/surveys/{id}/responses': {
    post: { ...operation('Submit complete survey (Employee or HR with employee profile)', 'Requires active eligible employee with at least three months of employment. Answer every shared question exactly once. Integer scores 1..5, optional comments. One submission per employee per survey. Returns responseId, surveyId, submittedAt, satisfactionScore (mean rounded to four decimal places).', surveyId, 201),
      requestBody: body({ type: 'object', additionalProperties: false, required: ['answers'], properties: {
        answers: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false,
          required: ['questionId', 'score'], properties: {
            questionId: { type: 'integer', minimum: 1 },
            score: { type: 'integer', minimum: 1, maximum: 5 },
            comment: { type: 'string', nullable: true, maxLength: 1000 }
          } } }
      } }) },
    get: operation('List submitted responses (HR)', 'Returns survey, responseCount and participants with employee identity, submittedAt and nested answers. Drafts excluded; inactive employee historical responses retained. No pagination.', surveyId)
  },
  '/api/surveys/{id}/my-response': {
    get: operation('View own submitted response', 'Active account linked to the response employee. Available after survey closure and employment deactivation. Returns survey, response with satisfactionScore, and answers. Drafts return 404.', surveyId)
  },
  '/api/surveys/{id}/results': {
    get: operation('Survey results (HR)', 'Submitted responses only, isolated by survey_responses.survey_id. Returns responseCount and questions with answerCount, averageScore (two decimals), scoreDistribution keys 1..5 and answers containing score/comment. No respondents means averageScore null and counts zero.', surveyId)
  },
  '/api/surveys/{id}/responses/{responseId}': {
    get: operation('Submitted response detail (HR)', 'Returns survey and response with employee identity, answers and satisfactionScore. Response must belong to the requested survey; drafts and mismatched survey return 404.', [...surveyId, idParameter('responseId')])
  }
};
module.exports = { surveysPaths };
