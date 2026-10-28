const { validateCreateSurveyInput, validateSurveyId, validateSubmitSurveyResponseInput } = require('./surveys.validation');

class SurveysController {
  constructor(surveysService) {
    this.surveysService = surveysService;
    this.createSurvey = this.createSurvey.bind(this);
    this.listSurveys = this.listSurveys.bind(this);
    this.listAvailableSurveys = this.listAvailableSurveys.bind(this);
    this.submitSurveyResponse = this.submitSurveyResponse.bind(this);
    this.getMySurveyResponse = this.getMySurveyResponse.bind(this);
    this.getSurveyForEmployee = this.getSurveyForEmployee.bind(this);
    this.publishSurvey = this.publishSurvey.bind(this);
    this.getSurveyParticipants = this.getSurveyParticipants.bind(this);
    this.getSurveyResults = this.getSurveyResults.bind(this);
  }

  async createSurvey(request, response, next) {
    try {
      const survey = validateCreateSurveyInput(request.body);
      const data = await this.surveysService.createSurvey({
        actorId: request.auth.userId,
        survey
      });

      return response.status(201).json({
        message: 'Survey created successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async listSurveys(request, response, next) {
    try {
      const data = await this.surveysService.listSurveys(request.auth.userId);
      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }

  async listAvailableSurveys(request, response, next) {
    try {
      const data = await this.surveysService.listAvailableSurveys(request.auth.userId);
      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }

  async submitSurveyResponse(request, response, next) {
    try {
      const surveyId = validateSurveyId(request.params.id);
      const { answers } = validateSubmitSurveyResponseInput(request.body);
      const data = await this.surveysService.submitSurveyResponse({
        actorId: request.auth.userId,
        surveyId,
        answers
      });

      return response.status(201).json({
        message: 'Survey response submitted successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async getMySurveyResponse(request, response, next) {
    try {
      const surveyId = validateSurveyId(request.params.id);
      const data = await this.surveysService.getMySurveyResponse({
        actorId: request.auth.userId,
        surveyId
      });

      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }

  async getSurveyForEmployee(request, response, next) {
    try {
      const surveyId = validateSurveyId(request.params.id);
      const data = await this.surveysService.getSurveyForEmployee({
        actorId: request.auth.userId,
        surveyId
      });

      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }

  async publishSurvey(request, response, next) {
    try {
      const surveyId = validateSurveyId(request.params.id);
      const data = await this.surveysService.publishSurvey({
        actorId: request.auth.userId,
        surveyId
      });

      return response.status(200).json({
        message: 'Survey published successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async getSurveyParticipants(request, response, next) {
    try {
      const rawId = request.params.id;
      if (!/^[1-9]\d{0,9}$/.test(rawId) || Number(rawId) > 2147483647) {
        const { AppError } = require('../../common/errors/app-error');
        throw new AppError(400, 'ID khảo sát phải là số nguyên dương, tối đa 2147483647.');
      }
      const data = await this.surveysService.getSurveyParticipants({
        actorId: request.auth.userId, surveyId: Number(rawId)
      });
      response.set('Cache-Control', 'no-store, private');
      response.vary('Authorization');
      return response.status(200).json({ data });
    } catch (error) { return next(error); }
  }

  async getSurveyResults(request, response, next) {
    try {
      const surveyId = validateSurveyId(request.params.id);
      const data = await this.surveysService.getSurveyResults({
        actorId: request.auth.userId,
        surveyId
      });

      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = { SurveysController };
