# Flexible employee surveys

No cycles: the runtime never reads cycle_number or requires a cycleNumber request. HR chooses any combination of the fixed database categories. Category creation is not exposed; unmatched questions belong in OTHER, as agreed with the user on 2026-11-17.

Each of the 10 current categories has 4 default satisfaction questions and 10 optional bank questions. The authored module is the seed source; the runtime reads stored catalog rows from survey_questions through surveys.catalog.js, with an authored fallback for an unseeded category/kind. OTHER also has four provisional satisfaction items, scoped to the contents HR places in OTHER. This is ERIS-authored content, not a validated scale or translation. OTHER mixes potentially unrelated concerns and its score must be interpreted in the context of the actual questions in that survey.

GET /api/surveys/categories returns id, name, description, defaultQuestions and questionBank for all categories. It accepts no cycle query. No bank or category management API is provided. No database migration or category insertion is needed. The 140 authored items have been inserted into survey_questions with survey_id=NULL. answer_config.erisCatalog identifies source ERIS_SURVEY_CATALOG, kind SATISFACTION or BANK, stable code and version; answer_config.answerConfig contains the actual response configuration. Historic untagged shared questions are ignored by the catalog reader.

Creation request: title, description, categoryIds, questions, startDate, endDate. At least one category is required. Questions is the array of bank/custom questions HR staged locally. On creation the server adds every selected category's default questions once, then inserts staged questions in the same transaction. The total including defaults is limited to 200. Default configuration is generated server-side and cannot be forged in a custom question payload. Unknown categories, cross-category payloads and duplicate custom questions are rejected. An unconfigured future category requires at least one custom question and produces no invented default score.

Screen /survey-demo: select a category in the question builder; inspect the default set; add bank questions directly or copy one into the composer; alternatively write a custom question. Add appends one preview to the local draft. HR can edit/remove staged questions and continue composing before Save draft persists everything. A bank item is not automatically a satisfaction item, including when a custom/bank item uses RATING.

Saved draft metadata and custom questions can be edited. Default questions cannot be edited/deleted through the API. Library wording is copied to each survey; the V2 catalog does not rewrite prior V1 surveys or invalidate an old draft only because the catalog changed. Questions freeze on publication. Publication snapshots ACTIVE employee accounts in survey_responses. Employees submit all answers once within the time window; writes are transactional and audited. Closing stops submissions and retains history. These controls run in backend code; direct SQL writes do not have the legacy trigger protections removed by the database owner.

Question request: questionText, categoryId, questionType, answerConfig, displayOrder.
- TEXT: answerConfig=null; answerValue is a nonempty string.
- SINGLE_CHOICE / MULTIPLE_CHOICE: answerConfig={options:[{code,label}]}; answerValue={selectedCodes:[...]}. Allowed, unique codes are required.
- RATING: answerConfig={min:1,max:5,labels:[five labels]}; answerValue is a JSON integer 1..5.

Only server-created default RATING questions, identified by their snapshotted templateCode, contribute to satisfaction. Per-category score = mean of that category's default responses. Survey score = mean of category scores, giving each scored category equal weight regardless of its number of custom questions. Scores are rounded to two decimals. Bank/custom answers have their own distributions and averages. A missing compatible response produces NULL, not a fabricated score. AI latestSatisfaction reuses the application scorer and needs no SQL function.

Different category selections measure different scopes. An equal numeric range does not establish comparability across surveys or compatibility with the model training feature; model feature mapping still requires its own review.

Tests: node test/surveys-dynamic.test.cjs uses TEMP tables with no cycle column; public business data is not modified. It checks catalog counts, arbitrary category combinations, OTHER-only surveys, bank and custom answers, default spoofing, freeze, audit rollback, reports and V1 snapshots. The staged ui-test.cjs uses mocked HTTP in Edge. live-smoke.cjs reads the actual database/API only.


HR participation APIs:
- GET /api/surveys/:id/participants returns only employees with submitted_at set, including responseId, employeeId, employeeCode, fullName, submittedAt, satisfactionScore and answerCount. Invitees who have not submitted are excluded.
- GET /api/surveys/:id/participants/:employeeId returns that employee's submitted response in this survey, or 404. Requires ACTIVE HR, as does the participant list.
- Existing GET /api/surveys/:id/responses/:responseId now includes questionText, questionType, categoryId/categoryName, snapshotted answerConfig, raw answerValue, selectedOptions labels, displayAnswer and comment. Existing raw-answer fields remain available.
- HR survey detail includes invitedCount and participantCount. /survey-demo has a participant list and per-employee answer viewer.

List/detail reads share the survey lock used by submit, so submission status and answers cannot change halfway through these API reads. Answer metadata comes from questions stored with the survey, not the current question bank. No new database columns or migration.


Automatic defaults in local draft: the first Add for a category (bank or custom) snapshots its defaults into the visible draft. A Map keyed by categoryId + templateCode deduplicates defaults when returning to that category. Merely changing the dropdown has no effect. Preview shows all defaults plus custom/bank questions and counts toward the same 200-question limit. Removing a custom question leaves that topic's defaults; Remove topic explicitly removes the entire set. Save sends categoryIds and only custom/bank questions, so the server creates defaults exactly once rather than accepting client-authored scoring flags. Save/clear/logout resets staged defaults. No database changes.

Bank expansion: 10 questions per category (100 total). Existing bank codes 1–6 and all default scoring questions retain their definitions. New items 7–10 cover frequency, preferred support, concrete examples and follow-up. Frequency and support responses have no satisfaction scores.

Seeding uses a transaction and advisory lock. Existing matching catalog codes are skipped; differing content is rejected for review rather than overwritten. No existing survey questions or answers are updated. Catalog items are copied into a survey when it is created, retaining question wording and response configuration as a snapshot. The TEMP lifecycle test also verifies repeat seeding, DB priority and refusal to overwrite changed catalog content.
