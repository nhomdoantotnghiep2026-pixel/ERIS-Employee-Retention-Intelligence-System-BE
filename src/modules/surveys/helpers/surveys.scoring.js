const ratingConfig = () => ({
  min: 1,
  max: 5,
  labels: [
    "Rất không hài lòng",
    "Không hài lòng",
    "Không hài lòng cũng không bất mãn",
    "Hài lòng",
    "Rất hài lòng",
  ],
})

function score(qs, aa) {
  const core = qs.filter(
    (q) => q.isSatisfactionCore && q.questionType === "RATING",
  )

  if (!core.length) return null

  const values = core.map(
    (q) => aa.find((a) => a.questionId === q.id)?.answerValue,
  )

  if (values.some((x) => !Number.isInteger(x) || x < 1 || x > 5)) return null

  return Number(
    (values.reduce((sum, x) => sum + x, 0) / values.length).toFixed(2),
  )
}

module.exports = { ratingConfig, score }
