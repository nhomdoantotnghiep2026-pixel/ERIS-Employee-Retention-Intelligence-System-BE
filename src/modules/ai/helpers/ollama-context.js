// Remove only known transport/diagnostic metadata, never summarize source text.
const technicalModelFields = new Set([
  'snapshotId', 'employee_id', 'model_id', 'schema_version', 'positive_class',
  'additivity_error', 'explainer', 'startedAt', 'completedAt'
]);

function compactOllamaContext(context) {
  const result = structuredClone(context);
  if (result.model) {
    for (const key of technicalModelFields) delete result.model[key];
  }
  if (result.retrieval) {
    delete result.retrieval.model;
    // Candidate IDs are repeated in candidates[].policyId and policies[].id.
    delete result.retrieval.candidatePolicyIds;
    if (result.retrieval.noRecommendationReason == null) delete result.retrieval.noRecommendationReason;
  }
  for (const evidence of result.evidence || []) {
    // SURVEY:<response_id>:<question_id> remains as the exact source reference.
    if (evidence.source === 'SURVEY') {
      delete evidence.response_id;
      delete evidence.question_id;
    }
  }
  return result;
}

module.exports = { compactOllamaContext };
