const {
  validateSurveyId,
  validateCreateSurveyInput,
  validateUpdateSurveyInput,

  validateSurveyQuestionInput,
  validateNoQueryParameters,
} = require("./surveys.validation")

class SurveysController {
  constructor(surveysService) {
    this.surveysService = surveysService

    for (const method of [
      "listCategories",
      "listSurveys",
      "listAvailableSurveys",
      "listMySurveyHistory",
      "createSurvey",
      "getSurvey",
      "updateSurvey",
      "createQuestion",
      "updateQuestion",
      "deleteQuestion",
      "publishSurvey",
      "closeSurvey",
      "submitSurveyResponse",
      "getMySurveyResponse",
      "getSurveyResponses",
      "getSurveyResponse",
      "getSurveyParticipants",
      "getSurveyParticipant",
      "getSurveyResults",
    ])
      this[method] = this[method].bind(this)
  }

  async respond(request, response, next, operation, status = 200) {
    try {
      validateNoQueryParameters(request.query)
      const data = await operation()
      return response.status(status).json({ data })
    } catch (error) {
      return next(error)
    }
  }

  listCategories(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.listCategories(request.auth.userId),
    )
  }

  listSurveys(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.listSurveys(request.auth.userId),
    )
  }

  listAvailableSurveys(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.listAvailableSurveys(request.auth.userId),
    )
  }

  listMySurveyHistory(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.listMySurveyHistory(request.auth.userId),
    )
  }

  createSurvey(request, response, next) {
    return this.respond(
      request,
      response,
      next,
      () =>
        this.surveysService.createSurvey({
          actorId: request.auth.userId,
          survey: validateCreateSurveyInput(request.body),
        }),
      201,
    )
  }

  getSurvey(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.getSurvey({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
      }),
    )
  }

  updateSurvey(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.updateSurvey({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
        survey: validateUpdateSurveyInput(request.body),
      }),
    )
  }

  createQuestion(request, response, next) {
    return this.respond(
      request,
      response,
      next,
      () =>
        this.surveysService.saveQuestion({
          actorId: request.auth.userId,
          surveyId: validateSurveyId(request.params.id),
          question: validateSurveyQuestionInput(request.body),
        }),
      201,
    )
  }

  updateQuestion(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.saveQuestion({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
        questionId: validateSurveyId(request.params.questionId),
        question: validateSurveyQuestionInput(request.body),
      }),
    )
  }

  deleteQuestion(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.saveQuestion({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
        questionId: validateSurveyId(request.params.questionId),
        remove: true,
      }),
    )
  }

  publishSurvey(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.publishSurvey({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
      }),
    )
  }

  closeSurvey(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.closeSurvey({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
      }),
    )
  }

  submitSurveyResponse(request, response, next) {
    return this.respond(
      request,
      response,
      next,
      () =>
        this.surveysService.submitSurveyResponse({
          actorId: request.auth.userId,
          surveyId: validateSurveyId(request.params.id),
          response: request.body,
        }),
      201,
    )
  }

  getMySurveyResponse(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.getSurveyResponses({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
        own: true,
      }),
    )
  }

  getSurveyResponses(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.getSurveyResponses({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
      }),
    )
  }

  getSurveyResponse(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.getSurveyResponses({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
        responseId: validateSurveyId(request.params.responseId),
      }),
    )
  }

  getSurveyParticipants(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.getSurveyParticipants({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
      }),
    )
  }

  getSurveyParticipant(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.getSurveyParticipants({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
        employeeId: validateSurveyId(request.params.employeeId),
      }),
    )
  }

  getSurveyResults(request, response, next) {
    return this.respond(request, response, next, () =>
      this.surveysService.getSurveyResults({
        actorId: request.auth.userId,
        surveyId: validateSurveyId(request.params.id),
      }),
    )
  }
}

module.exports = { SurveysController }
