const { AppError } = require("../../common/errors/app-error")

const {
  validateSurveyQuestionInput,
  validateAnswersForQuestions,
} = require("./surveys.validation")

const { score } = require("./helpers/surveys.scoring")

const {
  formatResponseAnswers,
  summarizeResults,
} = require("./helpers/surveys.results")

const isOpen = (survey) =>
  survey.status === "ACTIVE" &&
  survey.startDate &&
  survey.endDate &&
  new Date(survey.startDate) <= new Date() &&
  new Date(survey.endDate) > new Date()

class SurveysService {
  constructor({ surveysRepository }) {
    this.surveysRepository = surveysRepository
  }

  run(actorId, roles, work) {
    return this.surveysRepository.withTransaction(async (repository) => {
      const actor = await repository.findActorById(actorId)

      if (!actor || !roles.includes(actor.role))
        throw new AppError(403, "Role or account status not allowed.")

      if (
        actor.role === "EMPLOYEE" &&
        !(await repository.findActiveEmployeeById(actor.employeeId))
      )
        throw new AppError(403, "An ACTIVE employee profile is required.")

      return work(repository, actor)
    })
  }

  async requireSurvey(repository, surveyId, lock = false) {
    const survey = await repository.findById(surveyId, lock)

    if (!survey) throw new AppError(404, "Survey not found.")

    return survey
  }

  assertDraft(survey) {
    if (survey.status !== "DRAFT")
      throw new AppError(409, "Only DRAFT content can be changed.")
  }

  listSurveys(actorId) {
    return this.run(actorId, ["HR"], (repository) => repository.findAll())
  }

  listAvailableSurveys(actorId) {
    return this.run(actorId, ["EMPLOYEE"], (repository, actor) =>
      repository.findAll(actor.employeeId),
    )
  }

  listCategories(actorId) {
    return this.run(actorId, ["HR"], (repository) =>
      repository.findCategoryCatalog(),
    )
  }

  listMySurveyHistory(actorId) {
    return this.run(actorId, ["EMPLOYEE"], (repository, actor) =>
      repository.findSubmittedSurveys(actor.employeeId),
    )
  }

  async createDefaults(repository, surveyId, categoryIds) {
    const available = await repository.findCategoryCatalog(),
      categories = available.filter((category) =>
        categoryIds.includes(category.id),
      )

    if (categories.length !== categoryIds.length)
      throw new AppError(400, "Unknown category.")

    let order = 0

    for (const category of categories)
      for (const question of category.defaultQuestions)
        await repository.saveQuestion(surveyId, {
          ...question,
          questionType: "RATING",
          answerConfig: {
            ...question.answerConfig,
            templateCode: question.templateCode,
          },
          displayOrder: ++order,
        })

    return categories
  }

  createSurvey({ actorId, survey }) {
    return this.run(actorId, ["HR"], async (repository) => {
      const { id } = await repository.create(survey, actorId)

      await this.createDefaults(repository, id, survey.categoryIds)

      const selected = new Set(survey.categoryIds),
        existing = await repository.findQuestions(id)

      if (existing.length + survey.questions.length > 200)
        throw new AppError(400, "Maximum 200 questions including defaults.")

      const seen = new Set()
      let order = existing.length

      for (const question of survey.questions) {
        if (!selected.has(question.categoryId))
          throw new AppError(
            400,
            "Question topic must be included in categoryIds.",
          )

        const key =
          question.categoryId + ":" + question.questionText.toLocaleLowerCase()

        if (seen.has(key))
          throw new AppError(400, "Duplicate question in the same topic.")

        seen.add(key)
        await repository.saveQuestion(id, {
          ...question,
          displayOrder: ++order,
        })
      }

      const saved = await this.requireSurvey(repository, id),
        usedIds = new Set(
          (await repository.findQuestions(id)).map((q) => q.categoryId),
        )

      if (survey.categoryIds.some((categoryId) => !usedIds.has(categoryId)))
        throw new AppError(
          400,
          "A category without default questions must include at least one custom or bank question.",
        )

      await repository.audit(actorId, id, "CREATE", null, saved)
      return saved
    })
  }

  getSurvey({ actorId, surveyId }) {
    return this.run(actorId, ["HR", "EMPLOYEE"], async (repository, actor) => {
      const survey = await this.requireSurvey(repository, surveyId)

      if (actor.role === "EMPLOYEE" && !isOpen(survey))
        throw new AppError(409, "Survey is not open.")

      const counts =
        actor.role === "HR" ? await repository.findResponseCounts(surveyId) : {}

      return {
        ...survey,
        ...counts,
        questions: await repository.findQuestions(surveyId),
      }
    })
  }

  updateSurvey({ actorId, surveyId, survey }) {
    return this.run(actorId, ["HR"], async (repository) => {
      const before = await this.requireSurvey(repository, surveyId, true)
      this.assertDraft(before)

      const merged = { ...before, ...survey }

      if (
        merged.startDate &&
        merged.endDate &&
        new Date(merged.startDate) >= new Date(merged.endDate)
      )
        throw new AppError(400, "Invalid date range.")

      await repository.update(surveyId, merged)
      const after = await this.requireSurvey(repository, surveyId)

      await repository.audit(actorId, surveyId, "UPDATE", before, after)
      return after
    })
  }

  saveQuestion({
    actorId,
    surveyId,
    questionId = null,
    question = null,
    remove = false,
  }) {
    return this.run(actorId, ["HR"], async (repository) => {
      this.assertDraft(await this.requireSurvey(repository, surveyId, true))
      let before = null

      if (questionId) {
        before = await repository.findQuestionById(surveyId, questionId)
        if (!before) throw new AppError(404, "Question not found in survey.")
        if (before.isSatisfactionCore)
          throw new AppError(
            409,
            "Default satisfaction questions cannot be edited or deleted.",
          )
      }

      if (!remove) {
        const available = await repository.findCategoryCatalog()

        if (!available.some((category) => category.id === question.categoryId))
          throw new AppError(400, "Unknown category.")

        const questions = await repository.findQuestions(surveyId),
          selectedIds = new Set(questions.map((q) => q.categoryId))

        if (!selectedIds.has(question.categoryId))
          throw new AppError(
            400,
            "Choose a category already included in this survey.",
          )

        if (!questionId && questions.length >= 200)
          throw new AppError(400, "Maximum 200 questions.")
      }

      let after = null

      if (remove) await repository.deleteQuestion(questionId)
      else after = await repository.saveQuestion(surveyId, question, questionId)

      await repository.audit(
        actorId,
        surveyId,
        "UPDATE",
        { question: before },
        { question: after },
      )
      return after
    })
  }

  publishSurvey(input) {
    return this.transition(input, false)
  }

  closeSurvey(input) {
    return this.transition(input, true)
  }

  transition({ actorId, surveyId }, close) {
    return this.run(actorId, ["HR"], async (repository) => {
      const before = await this.requireSurvey(repository, surveyId, true)

      if (close) {
        if (before.status === "CLOSED") return before

        if (before.status !== "ACTIVE")
          throw new AppError(409, "Only ACTIVE surveys can close.")

        await repository.updateStatus(surveyId, "CLOSED")
      } else {
        this.assertDraft(before)

        if (
          !before.startDate ||
          !before.endDate ||
          new Date(before.endDate) <= new Date() ||
          new Date(before.startDate) >= new Date(before.endDate)
        )
          throw new AppError(400, "Provide a valid non-expired time window.")

        const questions = await repository.findQuestions(surveyId)

        if (!questions.length)
          throw new AppError(409, "Add questions before publishing.")

        const categories = await repository.findCategoryCatalog(),
          ids = new Set(categories.map((c) => c.id))

        if (questions.some((q) => !ids.has(q.categoryId)))
          throw new AppError(409, "A question category no longer exists.")

        // Defaults are frozen question snapshots; later library edits do not change older surveys.

        for (const question of questions) {
          if (question.isSatisfactionCore) {
            if (
              question.questionType !== "RATING" ||
              question.answerConfig.min !== 1 ||
              question.answerConfig.max !== 5 ||
              !Array.isArray(question.answerConfig.labels) ||
              question.answerConfig.labels.length !== 5
            )
              throw new AppError(409, "Invalid default satisfaction scale.")
          } else
            validateSurveyQuestionInput({
              questionText: question.questionText,
              categoryId: question.categoryId,
              questionType: question.questionType,
              answerConfig: question.answerConfig,
              displayOrder: question.displayOrder,
            })
        }

        await repository.updateStatus(surveyId, "ACTIVE")
        await repository.inviteActiveEmployees(surveyId)
      }

      const after = await this.requireSurvey(repository, surveyId)
      await repository.audit(
        actorId,
        surveyId,
        close ? "CLOSE" : "PUBLISH",
        before,
        after,
      )
      return after
    })
  }

  submitSurveyResponse({ actorId, surveyId, response }) {
    return this.run(actorId, ["EMPLOYEE"], async (repository, actor) => {
      const survey = await this.requireSurvey(repository, surveyId, true)

      if (!isOpen(survey)) throw new AppError(409, "Survey is not open.")

      const questions = await repository.findQuestions(surveyId)
      if (!questions.length) throw new AppError(409, "No questions.")

      const answers = validateAnswersForQuestions(response, questions),
        assigned = await repository.findAssignedResponse(
          surveyId,
          actor.employeeId,
        )

      if (assigned?.submittedAt) throw new AppError(409, "Already submitted.")

      if (!assigned)
        throw new AppError(
          403,
          "Employee was not included when this survey was published.",
        )

      await repository.replaceAnswers(assigned.id, answers)
      const submittedAt = await repository.markResponseSubmitted(assigned.id)

      await repository.auditResponse(actorId, assigned.id, {
        surveyId,
        employeeId: actor.employeeId,
        submittedAt,
      })

      return {
        responseId: assigned.id,
        surveyId,
        submittedAt,
        satisfactionScore: score(questions, answers),
      }
    })
  }

  getSurveyResponses({
    actorId,
    surveyId,
    responseId = null,
    own = false,
    submittedOnly = false,
    employeeId = null,
  }) {
    return this.run(
      actorId,
      own ? ["EMPLOYEE"] : ["HR"],
      async (repository, actor) => {
        const survey = await this.requireSurvey(repository, surveyId, true)

        const rows = await repository.findResponses(surveyId, {
          employeeId: own ? actor.employeeId : employeeId,
          responseId,
          submittedOnly,
        })

        const questions = await repository.findQuestions(surveyId),
          answers = await repository.findAnswers(
            surveyId,
            rows.map((r) => r.responseId),
          )

        const data = rows.map((row) => {
          const nested = formatResponseAnswers(
            answers.filter((a) => a.responseId === row.responseId),
          )
          return {
            ...row,
            surveyId,
            surveyTitle: survey.title,
            status: row.submittedAt ? "SUBMITTED" : "NOT_SUBMITTED",
            satisfactionScore: row.submittedAt
              ? score(questions, nested)
              : null,
            answers: nested,
          }
        })

        if (own || responseId || employeeId) {
          if (!data.length || (own && !data[0].submittedAt))
            throw new AppError(
              404,
              "Submitted response not found in this survey.",
            )
          return data[0]
        }

        return data
      },
    )
  }

  async getSurveyParticipants({ actorId, surveyId, employeeId = null }) {
    const data = await this.getSurveyResponses({
      actorId,
      surveyId,
      employeeId,
      submittedOnly: true,
    })

    return employeeId
      ? data
      : data.map(({ answers, ...participant }) => ({
          ...participant,
          answerCount: answers.length,
        }))
  }

  getSurveyResults({ actorId, surveyId }) {
    return this.run(actorId, ["HR"], async (repository) => {
      const survey = await this.requireSurvey(repository, surveyId, true),
        questions = await repository.findQuestions(surveyId)

      return summarizeResults(
        survey,
        questions,
        await repository.findResultResponses(surveyId),
        await repository.findSubmittedAnswers(surveyId),
        await repository.findCategoryCatalog(),
      )
    })
  }
}

module.exports = { SurveysService }
