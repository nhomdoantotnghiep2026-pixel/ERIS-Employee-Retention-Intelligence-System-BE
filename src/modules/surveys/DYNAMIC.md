# Surveys: three cycles and category defaults

HR creates a survey with title, description (including its purpose), cycleNumber (1..3), startDate and endDate. No objective, cycleYear, publishedAt or editable scoring flags are required. The selected cycle is inferred through survey_questions.category_id -> survey_categories.cycle_number. No surveys.cycle_number is read or written. Creation and default insertion share one transaction; a failed inference rolls back the draft. Legacy surveys without owned questions return a NULL cycle. Change to another cycle by creating a new draft.

GET /api/surveys/categories?cycleNumber=1 returns only categories whose survey_categories.cycle_number equals 1. NULL categories are not available. Backend enforces this restriction when adding/editing questions and again at publication. Category allocation changes never rewrite published questions or answers.

HR must choose at least one category through categoryIds on creation. Only those categories are included; duplicate, unknown or out-of-cycle IDs are rejected. Defaults are previewed before creation. The additional question editor is restricted to selected categories. Selected topics are inferred from the default questions, without a new table or column. Category selection is fixed after draft creation in this version; create a new draft to change scope. Their default RATING questions are copied from surveys.satisfaction-templates.js into survey_questions. HR can add diagnostic questions but cannot modify/delete defaults. There is no automatic keyword matching. No is_satisfaction_core column is required: a server-owned templateCode in answer_config identifies the copied default. Public question requests reject this property. Templates and labels are snapshots, retained with the survey.

Question request fields: questionText, categoryId, questionType, answerConfig, displayOrder. All questions must be answered; backend enforces completeness.

- TEXT: answerConfig=null; answerValue is a nonempty string.
- SINGLE_CHOICE/MULTIPLE_CHOICE: answerConfig={options:[{code,label},...]}; answerValue={selectedCodes:[...]}. Only allowed, distinct codes may be submitted.
- RATING: answerConfig={min:1,max:5,labels:[five labels]}; answerValue is a JSON integer 1..5. A custom RATING is reported separately and never automatically contributes to satisfaction.

Satisfaction = mean of category means over default questions only, rounded to two decimals after aggregation. Missing defaults or incomplete answers produce NULL / prevent submission. Ordinary RATING questions, choices and text are excluded. AI latestSatisfaction and survey submission reuse the same application scoring function; no SQL function is required.

These Vietnamese questions are ERIS adaptations of facet-based satisfaction concepts, not validated translations. A cycle-specific score is not proof of compatibility with the model's original training feature. Scores of different subject scopes should not be interpreted as like-for-like trends.

Assigned categories (confirmed by user):
1: COMPENSATION_BENEFITS, JOB_FIT.
2: WORKING_TIME, WORK_ENVIRONMENT, MANAGEMENT, WORK_LIFE_BALANCE, COMMUNICATION_CULTURE.
3: CAREER_DEVELOPMENT, EMPLOYEE_ENGAGEMENT.
OTHER: NULL.

No migration is required for the current schema (survey_id, answer_config, RATING and category cycle_number already exist). Legacy survey triggers have been removed by the database owner. All API content freeze, answer validation, cross-survey ownership and completeness checks run in backend transactions. Direct SQL writes do not have the removed trigger protections. Do not run the superseded 20261116-dynamic-surveys.sql file.

Category assignments must not be reassigned after publication without considering historical reports: inferred cycles follow the category data. Missing or mixed cycles prevent publication.

Demo: /survey-demo. HR chooses cycle and dates, creates draft (defaults appear automatically), adds questions, publishes; EMPLOYEE answers once; HR views results and responses. Publication snapshots ACTIVE employee accounts as survey_responses with NULL submitted_at. Submissions are transactional, audited, immutable and limited to the published time window. Closing preserves history.

Verification: node test/surveys-dynamic.test.cjs exercises validation and lifecycle using TEMP tables on PostgreSQL; public business tables are not modified by tests. The staged ui-test.cjs uses mocked HTTP responses and checks numeric rating submission in Edge.

Results include categoryScores: per-category mean satisfaction from defaults, with response counts. Custom questions remain in the detailed report.


Creation screen: inline question builder before saving. Category dropdown shows the chosen cycle plus OTHER for every cycle. Selecting a category previews defaults only. Add question appends a local custom question and includes that topic's default set once. Add default set supports a defaults-only topic. Save draft sends categoryIds plus questions, validated and inserted with defaults in one transaction. OTHER has no defaults and does not change the inferred cycle or satisfaction score; at least one main topic is needed for these satisfaction surveys. Changing cycle clears staged questions after confirmation. Nothing is persisted by the local Add button.
