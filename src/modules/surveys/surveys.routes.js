const express = require("express")

function createSurveysRouter({ surveysController, authenticate }) {
  const router = express.Router()

  router.use(authenticate, (_request, response, next) => {
    response.set("Cache-Control", "no-store, private")
    next()
  })

  router.get("/categories", surveysController.listCategories)

  router.get("/available", surveysController.listAvailableSurveys)
  router.get("/my-history", surveysController.listMySurveyHistory)

  router.get("/", surveysController.listSurveys)

  router.post("/", surveysController.createSurvey)

  router.get("/:id", surveysController.getSurvey)

  router.patch("/:id", surveysController.updateSurvey)

  router.post("/:id/questions", surveysController.createQuestion)

  router.patch("/:id/questions/:questionId", surveysController.updateQuestion)

  router.delete("/:id/questions/:questionId", surveysController.deleteQuestion)

  router.post("/:id/publish", surveysController.publishSurvey)

  router.post("/:id/close", surveysController.closeSurvey)

  router.post("/:id/responses", surveysController.submitSurveyResponse)

  router.get("/:id/my-response", surveysController.getMySurveyResponse)

  router.get("/:id/responses", surveysController.getSurveyResponses)

  router.get("/:id/responses/:responseId", surveysController.getSurveyResponse)

  router.get("/:id/participants", surveysController.getSurveyParticipants)

  router.get(
    "/:id/participants/:employeeId",
    surveysController.getSurveyParticipant,
  )

  router.get("/:id/results", surveysController.getSurveyResults)

  return router
}

module.exports = { createSurveysRouter }
