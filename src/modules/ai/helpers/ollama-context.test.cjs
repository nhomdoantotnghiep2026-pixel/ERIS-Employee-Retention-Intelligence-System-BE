const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compactOllamaContext } = require('./ollama-context');

test('Ollama receives three E5 policies with at least one source per candidate', () => {
  const period = { start: '2025-01-01', end: '2025-01-31' };
  const submittedAt = '2025-01-15T08:00:00.000Z';
  const input = {
    period,
    model: { riskLevel: 'HIGH', period, contributions: { Age: 0.9, Overtime_Hours: 0.1 } },
    policies: [1, 2, 3].map(id => ({ id, name: 'Policy ' + id, description: 'x'.repeat(400) })),
    candidates: [
      { policyId: 2, evidenceIds: ['attendance'] },
      { policyId: 1, evidenceIds: ['survey'] },
      { policyId: 3, evidenceIds: ['other'] }
    ],
    evidence: [
      { id: 'other', source: 'SURVEY', comment: 'Other response' },
      { id: 'survey', source: 'SURVEY', submitted_at: submittedAt, question_text: 'How is the workload?', comment: 'Weekend overtime' },
      { id: 'attendance', source: 'ATTENDANCE', month: '2025-01', recordedDays: 10, overtimeMinutes: 300 }
    ]
  };
  const result = compactOllamaContext(input);
  assert.deepEqual(result.policies.map(policy => policy.id), ['2', '1', '3']);
  assert.deepEqual(result.evidence.map(item => [item.id, item.period]), [
    ['attendance', '2025-01'], ['survey', submittedAt], ['other', period]
  ]);
  assert.match(result.evidence[0].fact, /300 phút/);
  assert.match(result.evidence[1].fact, /Weekend overtime/);
  assert.equal(result.model.riskLevel, 'HIGH');
  assert.deepEqual(result.model.shap, [{ feature: 'Overtime_Hours', impact: 0.1, period }]);
  assert.ok(result.policies[0].description.length < input.policies[1].description.length);

  input.candidates[0].evidenceIds = ['attendance', 'other'];
  const balanced = compactOllamaContext(input);
  assert.deepEqual(balanced.policies.map(policy => policy.matchedEvidenceIds), [['attendance', 'other'], ['survey'], ['other']]);

  input.candidates[0].evidenceIds = ['survey'];
  const deduplicated = compactOllamaContext(input);
  assert.deepEqual(deduplicated.evidence.map(item => item.id), ['survey', 'other']);
  assert.equal(deduplicated.model.shap, undefined);
});
