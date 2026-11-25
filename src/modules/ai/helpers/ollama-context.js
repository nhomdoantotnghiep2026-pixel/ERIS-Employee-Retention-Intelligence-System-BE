const { evidenceText } = require('../providers/ai-e5.provider');

function excerpt(value, limit) {
  if (typeof value !== 'string') return value;
  return value.length > limit ? value.slice(0, limit).trimEnd() + '…' : value;
}

function compactOllamaContext({ policies, candidates, evidence, model, period }) {
  const policiesById = new Map(policies.map(policy => [String(policy.id), policy]));
  const evidenceById = new Map(evidence.map(item => [String(item.id), item]));
  const shortlist = candidates.slice(0, 2).flatMap(({ policyId, evidenceIds }) => {
    const policy = policiesById.get(String(policyId));
    if (!policy) return [];
    return [{
      id: String(policy.id),
      name: excerpt(policy.name, 100),
      description: excerpt(policy.description, 220),
      matchedEvidenceIds: evidenceIds.map(String)
    }];
  });
  const selected = [...new Set(shortlist.flatMap(policy => policy.matchedEvidenceIds))]
    .map(id => evidenceById.get(id))
    .filter(Boolean)
    .slice(0, 2);
  const selectedIds = new Set(selected.map(item => String(item.id)));
  for (const policy of shortlist) {
    policy.matchedEvidenceIds = policy.matchedEvidenceIds.filter(id => selectedIds.has(id));
  }

  // Keep the SHAP factor only when selected evidence covers the same topic.
  const overtime = model.contributions?.Overtime_Hours;
  const shap = Number.isFinite(overtime) && overtime !== 0 &&
    selected.some(item => item.source === 'ATTENDANCE' && item.overtimeMinutes > 0)
    ? [{ feature: 'Overtime_Hours', impact: Number(overtime.toPrecision(3)), period: model.period }]
    : undefined;

  return {
    model: { riskLevel: model.riskLevel, shap },
    evidencePeriod: period,
    policies: shortlist,
    evidence: selected.map(item => ({
      id: item.id,
      source: item.source,
      period: item.month ?? item.submitted_at ?? period,
      fact: item.source === 'SURVEY'
        ? evidenceText({ ...item, question_text: excerpt(item.question_text, 100),
          answer_value: excerpt(item.answer_value, 150), comment: excerpt(item.comment, 150) })
        : evidenceText(item)
    }))
  };
}

module.exports = { compactOllamaContext };
