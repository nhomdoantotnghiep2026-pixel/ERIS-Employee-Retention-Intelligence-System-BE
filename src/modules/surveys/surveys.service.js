const { AppError } = require('../../common/errors/app-error');

class SurveysService {
  constructor({ surveysRepository }) {
    this.surveysRepository = surveysRepository;
  }

  async createSurvey({ actorId, survey }) {
    const actor = await this.surveysRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can create surveys.');
    }

    return this.surveysRepository.create({ survey, createdBy: actorId });
  }

  async listSurveys(actorId) {
    const actor = await this.surveysRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can view surveys.');
    }

    return this.surveysRepository.findAll();
  }

  async listAvailableSurveys(actorId) {
    const employee = await this.surveysRepository.findActiveEmployeeByUserId(actorId);
    if (!employee) {
      throw new AppError(403, 'Only active employees who have completed at least 3 months of employment can view available surveys.');
    }

    return this.surveysRepository.findAvailableForEmployee(employee.id);
  }

  async submitSurveyResponse({ actorId, surveyId, answers }) {
    const employee = await this.surveysRepository.findActiveEmployeeByUserId(actorId);
    if (!employee) {
      throw new AppError(403, 'Only active employees who have completed at least 3 months of employment can submit survey responses.');
    }

    const survey = await this.surveysRepository.findById(surveyId);
    if (!survey) {
      throw new AppError(404, 'Survey not found.');
    }

    const now = new Date();
    if (
      survey.status !== 'ACTIVE'
      || !survey.startDate
      || !survey.endDate
      || new Date(survey.startDate) > now
      || new Date(survey.endDate) < now
    ) {
      throw new AppError(409, 'Survey is not currently available for responses.');
    }

    const questions = await this.surveysRepository.findQuestionsBySurveyId(surveyId);
    const questionIds = new Set(questions.map((question) => question.id));
    if (questions.length === 0) {
      throw new AppError(409, 'Survey has no questions.');
    }

    if (answers.some((answer) => !questionIds.has(answer.questionId))) {
      throw new AppError(400, 'Every answer must belong to this survey.');
    }

    const answeredQuestionIds = new Set(answers.map((answer) => answer.questionId));
    const requiredQuestionIds = questions
      .filter((question) => question.required)
      .map((question) => question.id);
    if (requiredQuestionIds.some((questionId) => !answeredQuestionIds.has(questionId))) {
      throw new AppError(400, 'All required survey questions must be answered.');
    }

    return this.surveysRepository.submitResponse({ surveyId, employeeId: employee.id, answers });
  }

  async getMySurveyResponse({ actorId, surveyId }) {
    const employee = await this.surveysRepository.findEmployeeByActiveUserId(actorId);
    if (!employee) {
      throw new AppError(403, 'An active employee profile is required to view survey responses.');
    }

    const survey = await this.surveysRepository.findById(surveyId);
    if (!survey) {
      throw new AppError(404, 'Survey not found.');
    }

    const response = await this.surveysRepository.findMyResponse({
      surveyId,
      employeeId: employee.employeeId
    });
    if (!response) {
      throw new AppError(404, 'You have not started this survey.');
    }

    const answers = await this.surveysRepository.findMyResponseAnswers({
      surveyId,
      responseId: response.id
    });

    return {
      survey: {
        id: surveyId,
        title: response.surveyTitle
      },
      response: {
        id: response.id,
        status: response.submittedAt ? 'SUBMITTED' : 'DRAFT',
        submittedAt: response.submittedAt
      },
      answers: answers.map((answer) => ({
        questionId: answer.questionId,
        questionText: answer.questionText,
        dimensionCode: answer.dimensionCode,
        required: answer.required,
        displayOrder: answer.displayOrder,
        score: answer.score,
        comment: answer.comment
      }))
    };
  }

  async getSurveyForEmployee({ actorId, surveyId }) {
    const employee = await this.surveysRepository.findActiveEmployeeByUserId(actorId);
    if (!employee) {
      throw new AppError(403, 'Only active employees who have completed at least 3 months of employment can view surveys.');
    }

    const survey = await this.surveysRepository.findDetailById(surveyId);
    if (!survey) {
      throw new AppError(404, 'Survey not found.');
    }

    const now = new Date();
    if (
      survey.status !== 'ACTIVE'
      || !survey.startDate
      || !survey.endDate
      || new Date(survey.startDate) > now
      || new Date(survey.endDate) < now
    ) {
      throw new AppError(409, 'Survey is not currently available.');
    }

    const hasSubmittedResponse = await this.surveysRepository.hasSubmittedResponse({
      surveyId,
      employeeId: employee.id
    });
    if (hasSubmittedResponse) {
      throw new AppError(409, 'You have already submitted this survey. Use the my-response endpoint to view it.');
    }

    const questions = await this.surveysRepository.findQuestionsBySurveyId(surveyId);
    if (questions.length === 0) {
      throw new AppError(409, 'Survey has no questions.');
    }

    return {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      startDate: survey.startDate,
      endDate: survey.endDate,
      questions: questions.map((question) => ({
        id: question.id,
        questionText: question.questionText,
        dimensionCode: question.dimensionCode,
        required: question.required,
        displayOrder: question.displayOrder
      }))
    };
  }

  async publishSurvey({ actorId, surveyId }) {
    const actor = await this.surveysRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can publish surveys.');
    }

    const survey = await this.surveysRepository.findById(surveyId);
    if (!survey) {
      throw new AppError(404, 'Survey not found.');
    }

    if (survey.status !== 'DRAFT') {
      throw new AppError(409, 'Only draft surveys can be published.');
    }

    if (survey.endDate && new Date(survey.endDate) < new Date()) {
      throw new AppError(400, 'An expired survey cannot be published.');
    }

    const publishedSurvey = await this.surveysRepository.publish(surveyId);
    if (!publishedSurvey) {
      throw new AppError(409, 'Survey status changed; reload and try again.');
    }

    return publishedSurvey;
  }

  async getSurveyResults({ actorId, surveyId }) {
    const actor = await this.surveysRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can view survey results.');
    }

    const summary = await this.surveysRepository.findResultsSummary(surveyId);
    if (!summary) {
      throw new AppError(404, 'Survey not found.');
    }

    const questionRows = await this.surveysRepository.findQuestionResults(surveyId);
    return {
      ...summary,
      responseCount: Number(summary.responseCount),
      questions: questionRows.map((question) => ({
        id: question.id,
        questionText: question.questionText,
        dimensionCode: question.dimensionCode,
        displayOrder: question.displayOrder,
        answerCount: Number(question.answerCount),
        averageScore: question.averageScore === null ? null : Number(question.averageScore),
        scoreDistribution: {
          1: Number(question.score1),
          2: Number(question.score2),
          3: Number(question.score3),
          4: Number(question.score4)
        }
      }))
    };
  }
}

module.exports = { SurveysService };
