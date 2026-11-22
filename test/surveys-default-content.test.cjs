const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const {
  readCatalog,
  SOURCE,
} = require("../src/modules/surveys/surveys.repository")
const { ratingConfig, score } = require("../src/modules/surveys/surveys.validation")

const category = {
  id: 1,
  name: "COMPENSATION_BENEFITS",
  description: "Pay",
}

const catalogRow = (kind, index) => {
  const code =
    kind === "SATISFACTION"
      ? `ERIS_COMPENSATION_BENEFITS_${index}_V2`
      : `ERIS_BANK_COMPENSATION_BENEFITS_${index}_V1`

  return {
    id: index + (kind === "BANK" ? 100 : 0),
    category_id: category.id,
    question_text: `${kind} question ${index}?`,
    question_type: kind === "SATISFACTION" ? "RATING" : "TEXT",
    answer_config: {
      erisCatalog: { source: SOURCE, kind, code, version: 1 },
      answerConfig: kind === "SATISFACTION" ? ratingConfig() : null,
    },
    display_order: index,
  }
}

const clientWith = (rows) => ({
  async query(sql) {
    if (sql.includes("FROM survey_categories")) return { rows: [category] }
    return { rows }
  },
})

test("runtime reads four scoring defaults and ten bank questions only from database", async () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) =>
      catalogRow("SATISFACTION", index + 1),
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      catalogRow("BANK", index + 1),
    ),
  ]

  const [stored] = await readCatalog(clientWith(rows))

  assert.equal(stored.defaultQuestions.length, 4)
  assert.equal(stored.questionBank.length, 10)
  assert.equal(
    stored.defaultQuestions[0].templateCode,
    rows[0].answer_config.erisCatalog.code,
  )

  const questions = stored.defaultQuestions.map((question, index) => ({
    ...question,
    id: index + 1,
    isSatisfactionCore: true,
  }))
  const answers = [1, 3, 4, 5].map((answerValue, index) => ({
    questionId: index + 1,
    answerValue,
  }))

  assert.equal(score(questions, answers), 3.25)
})

test("an incomplete database catalog fails instead of falling back to source code", async () => {
  const incomplete = [
    ...Array.from({ length: 3 }, (_, index) =>
      catalogRow("SATISFACTION", index + 1),
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      catalogRow("BANK", index + 1),
    ),
  ]

  await assert.rejects(
    readCatalog(clientWith(incomplete)),
    (error) => error.statusCode === 409 && /incomplete/.test(error.message),
  )
})

test("manual SQL seed contains the complete versioned catalog", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../scripts/sql/seed-survey-question-catalog.sql"),
    "utf8",
  )
  const satisfactionCodes = new Set(
    sql.match(/ERIS_[A-Z_]+_[1-4]_V2/g) || [],
  )
  const bankCodes = new Set(
    sql.match(/ERIS_BANK_[A-Z_]+_(?:[1-9]|10)_V1/g) || [],
  )

  assert.equal(satisfactionCodes.size, 40)
  assert.equal(bankCodes.size, 100)
  assert.doesNotMatch(sql, /Nhìn chung/iu)

  const repository = fs.readFileSync(
    path.join(__dirname, "../src/modules/surveys/surveys.repository.js"),
    "utf8",
  )
  assert.doesNotMatch(repository, /surveys\.questions/)
  assert.doesNotMatch(repository, /authored\.(?:templates|bank)/)
})
