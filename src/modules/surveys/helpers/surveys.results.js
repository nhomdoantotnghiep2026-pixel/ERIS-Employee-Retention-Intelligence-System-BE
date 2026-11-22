const { score } = require("./surveys.scoring")

function formatResponseAnswers(rows) {
  return rows.map(({ responseId, ...answer }) => {
    const value = answer.answerValue
    let displayAnswer = null,
      selectedOptions = []

    if (typeof value === "string") displayAnswer = value
    else if (typeof value === "number")
      displayAnswer =
        value +
        "/5" +
        (answer.answerConfig?.labels?.[value - 1]
          ? " · " + answer.answerConfig.labels[value - 1]
          : "")
    else if (Array.isArray(value?.selectedCodes)) {
      selectedOptions = value.selectedCodes.map((code) => ({
        code,
        label:
          answer.answerConfig?.options?.find((option) => option.code === code)
            ?.label || code,
      }))
      displayAnswer = selectedOptions.map((option) => option.label).join("; ")
    }

    return { ...answer, selectedOptions, displayAnswer }
  })
}

function summarizeResults(survey, questions, responses, answers, categories) {
  const submitted = responses.filter((r) => r.submitted_at),
    usedIds = new Set(questions.map((q) => q.categoryId))

  const categoryScores = categories
    .filter((category) => usedIds.has(category.id))
    .map((category) => {
      const defaults = questions.filter(
        (q) => q.categoryId === category.id && q.isSatisfactionCore,
      )

      const values = submitted
        .map((response) =>
          score(
            defaults,
            answers.filter((a) => a.responseId === response.id),
          ),
        )
        .filter((value) => value !== null)

      return {
        categoryId: category.id,
        name: category.name,
        description: category.description,
        responseCount: values.length,
        satisfactionScore: values.length
          ? Number(
              (values.reduce((x, y) => x + y, 0) / values.length).toFixed(2),
            )
          : null,
      }
    })

  return {
    categoryScores,
    survey,
    invitedCount: responses.length,
    responseCount: submitted.length,
    completionRate: responses.length
      ? Number(((submitted.length / responses.length) * 100).toFixed(2))
      : null,
    questions: questions.map((question) => {
      const selected = answers.filter((a) => a.questionId === question.id)

      const options = (
        question.questionType === "RATING"
          ? [1, 2, 3, 4, 5].map((value) => ({
              code: String(value),
              label: question.answerConfig.labels[value - 1],
            }))
          : question.answerConfig?.options || []
      ).map((option) => ({
        ...option,
        count: selected.filter((answer) =>
          question.questionType === "RATING"
            ? answer.answerValue === Number(option.code)
            : answer.answerValue?.selectedCodes?.includes(option.code),
        ).length,
      }))

      const points =
        question.questionType === "RATING"
          ? selected.map((a) => a.answerValue).filter(Number.isInteger)
          : []

      return {
        ...question,
        answerCount: selected.length,
        averageScore: points.length
          ? Number(
              (points.reduce((a, b) => a + b, 0) / points.length).toFixed(2),
            )
          : null,
        options,
        answers: question.questionType === "TEXT" ? selected : undefined,
      }
    }),
  }
}

module.exports = { formatResponseAnswers, summarizeResults }
