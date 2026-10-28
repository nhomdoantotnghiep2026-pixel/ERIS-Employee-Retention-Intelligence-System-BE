const express = require('express');

function createSurveysRouter({ surveysController, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, surveysController.listSurveys);
  router.post('/', authenticate, surveysController.createSurvey);
  router.get('/available', authenticate, surveysController.listAvailableSurveys);
  router.get('/:id/responses', authenticate, surveysController.getSurveyParticipants);
  router.post('/:id/responses', authenticate, surveysController.submitSurveyResponse);
  router.get('/:id/my-response', authenticate, surveysController.getMySurveyResponse);
  router.post('/:id/publish', authenticate, surveysController.publishSurvey);
  router.get('/:id/results', authenticate, surveysController.getSurveyResults);
  router.get('/:id', authenticate, surveysController.getSurveyForEmployee);

  return router;
}

module.exports = { createSurveysRouter };
